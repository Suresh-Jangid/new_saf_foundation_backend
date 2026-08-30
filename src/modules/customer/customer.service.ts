import { randomInt } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../../config/db";
import { BadRequestError, NotFoundError, UnauthorizedError } from "../../utils/errors";
import { generateCustomerAccessToken } from "../../utils/jwt";
import { mapGeneralApplicationRecord, isValidUuid } from "../../utils/compat-helpers";
import { WhatsAppService } from "../../utils/whatsapp";
import { ApplicationsService } from "../applications/applications.service";
import { MayraService } from "../mayra/mayra.service";
import { SchemesService } from "../schemes/schemes.service";
import { PaymentsService } from "../payments/payments.service";

const applicationsService = new ApplicationsService();
const mayraService = new MayraService();
const schemesService = new SchemesService();
const paymentsService = new PaymentsService();

// Attribution for every online (Razorpay) EMI payment a customer makes
// themselves through this module — a dedicated system user (see
// backend/scripts/create-customer-payment-system-user.js), never a real
// agent, so self-service payments don't inflate any agent's commission
// report. isActive:false on that user, so it can never log into the panel.
const SYSTEM_CUSTOMER_PAYMENT_USER_ID = "a1a486a6-1c0d-4cb5-903d-75980e29185e";

const OTP_EXPIRY_SECONDS = 300;
const OTP_VERIFIED_WINDOW_MS = 15 * 60 * 1000;

// Same fixed per-category/per-pool EMI amounts already established as the
// source of truth in compatibility.routes.ts (admin bulk EMI collection
// screens) — duplicated here (not imported) because that file exports
// routes, not shared constants. Keep in sync if those ever change.
const MARRIAGE_CATEGORY_EMI_AMOUNTS: Record<string, number> = { A: 100, B: 200, C: 300 };
const MAYRA_CATEGORY_EMI_AMOUNTS: Record<string, number> = { B: 200, C: 300 };
const SURAKSHA_BIMA_EMI_AMOUNT = 200;

function normalizeMobile(mobile: unknown): string {
  const raw = String(mobile || "").replace(/\D/g, "");
  if (raw.length < 10) {
    throw new BadRequestError("A valid mobile number is required");
  }
  return raw.slice(-10);
}

export class CustomerService {
  // ── OTP / PASSWORD / SESSION ────────────────────────

  public async requestOtp(mobileInput: unknown) {
    const mobile = normalizeMobile(mobileInput);
    const otpCode = String(randomInt(100000, 1000000));
    const otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000);

    await prisma.customerAuth.upsert({
      where: { mobile },
      create: { mobile, otpCode, otpExpiresAt },
      update: { otpCode, otpExpiresAt, otpVerifiedAt: null },
    });

    await WhatsAppService.sendTemplateMessage(mobile, "otp_verification", "en", [
      { type: "text", text: otpCode },
    ]);

    return {
      status: true,
      message: "OTP sent successfully on WhatsApp",
      mobile,
      expires_in_seconds: OTP_EXPIRY_SECONDS,
    };
  }

  public async verifyOtp(mobileInput: unknown, otpInput: unknown) {
    const mobile = normalizeMobile(mobileInput);
    const otp = String(otpInput || "").trim();
    if (!otp) throw new BadRequestError("OTP is required");

    const auth = await prisma.customerAuth.findUnique({ where: { mobile } });
    if (!auth || !auth.otpCode || !auth.otpExpiresAt) {
      throw new BadRequestError("Please request a new OTP");
    }
    if (auth.otpExpiresAt.getTime() < Date.now()) {
      throw new BadRequestError("OTP has expired. Please request a new one.");
    }
    if (auth.otpCode !== otp) {
      throw new BadRequestError("Invalid OTP");
    }

    await prisma.customerAuth.update({
      where: { mobile },
      data: { otpCode: null, otpExpiresAt: null, otpVerifiedAt: new Date() },
    });

    return { status: true, message: "OTP verified successfully", mobile };
  }

  public async createPassword(mobileInput: unknown, password: unknown) {
    const mobile = normalizeMobile(mobileInput);
    const passwordPlain = String(password || "");
    if (passwordPlain.length < 4) {
      throw new BadRequestError("Password must be at least 4 characters");
    }

    const auth = await prisma.customerAuth.findUnique({ where: { mobile } });
    if (!auth || !auth.otpVerifiedAt || Date.now() - auth.otpVerifiedAt.getTime() > OTP_VERIFIED_WINDOW_MS) {
      throw new BadRequestError("Please verify OTP before setting a password");
    }

    const passwordHash = await bcrypt.hash(passwordPlain, 10);
    await prisma.customerAuth.update({
      where: { mobile },
      data: { passwordHash, lastLogin: new Date() },
    });

    return this.buildAuthResponse(mobile, auth.id, "Password created successfully");
  }

  public async login(mobileInput: unknown, password: unknown) {
    const mobile = normalizeMobile(mobileInput);
    const passwordPlain = String(password || "");

    const auth = await prisma.customerAuth.findUnique({ where: { mobile } });
    if (!auth || !auth.passwordHash) {
      throw new UnauthorizedError("Invalid mobile number or password");
    }

    const matches = await bcrypt.compare(passwordPlain, auth.passwordHash);
    if (!matches) {
      throw new UnauthorizedError("Invalid mobile number or password");
    }

    await prisma.customerAuth.update({ where: { mobile }, data: { lastLogin: new Date() } });

    return this.buildAuthResponse(mobile, auth.id, "Login successful");
  }

  public async logout() {
    // Stateless JWT — nothing server-side to invalidate (matches this
    // codebase's existing convention: no refresh-token blocklist anywhere).
    return { status: true, message: "Logout successful" };
  }

  /** Resolves the mobile's "current" application and builds the token + summary payload shared by login/createPassword. */
  private async buildAuthResponse(mobile: string, customerAuthId: string, message: string) {
    const app = await this.findCurrentApplication(mobile);
    const mapped = mapGeneralApplicationRecord(app);
    // mapGeneralApplicationRecord spreads the raw Prisma row before adding its
    // computed fields, so totalAmount/pendingAmount on `mapped` are still
    // Decimal objects, not numbers — read them off `app` directly instead.
    const totalAmount = Number(app.totalAmount);
    const pendingAmount = Number(app.pendingAmount);

    const token = generateCustomerAccessToken({
      customer_auth_id: customerAuthId,
      application_id: app.id,
      mobile,
      type: "customer",
    });

    return {
      status: true,
      message,
      token,
      customer: {
        application_id: app.id,
        formNumber: app.formNumber,
        applicantName: app.applicantName,
        mobile: app.mobile,
        gender: app.gender,
        category: app.category,
        applicationDate: app.applicationDate.toISOString().slice(0, 10),
        payment_status: pendingAmount <= 0 ? 1 : 0,
        is_paid: pendingAmount <= 0 ? 1 : 0,
        paymentAmount: mapped.paymentAmount,
        totalAmount,
        pendingAmount,
      },
    };
  }

  private async findCurrentApplication(mobile: string) {
    const app =
      (await prisma.generalApplication.findFirst({
        where: { mobile, deletedAt: null, isActive: true },
        orderBy: { applicationDate: "desc" },
      })) ||
      (await prisma.generalApplication.findFirst({
        where: { mobile, deletedAt: null },
        orderBy: { applicationDate: "desc" },
      }));

    if (!app) {
      throw new NotFoundError("No application found for this mobile number");
    }
    return app;
  }

  // ── PROFILE ──────────────────────────────────────────

  public async getProfile(mobile: string, applicationId: string) {
    const app = await prisma.generalApplication.findFirst({
      where: { id: applicationId, mobile, deletedAt: null },
    });
    if (!app) throw new NotFoundError("Application not found");

    const auth = await prisma.customerAuth.findUnique({ where: { mobile } });
    const mapped = mapGeneralApplicationRecord(app);
    const totalAmount = Number(app.totalAmount);
    const pendingAmount = Number(app.pendingAmount);

    return {
      status: true,
      message: "Profile fetched successfully",
      data: {
        application_id: app.id,
        mobile,
        is_password_set: auth?.passwordHash ? 1 : 0,
        last_login: auth?.lastLogin ? auth.lastLogin.toISOString() : null,
        id: app.id,
        formNumber: app.formNumber,
        applicationDate: app.applicationDate.toISOString().slice(0, 10),
        applicantName: app.applicantName,
        fatherName: app.fatherName,
        motherName: app.motherName,
        dateOfBirth: app.dateOfBirth.toISOString().slice(0, 10),
        aadharNumber: app.aadharNumber,
        gotra: app.gotra,
        application_mobile: app.mobile,
        address: app.address,
        pinCode: app.pinCode,
        tehsil: app.tehsil,
        district: app.district,
        state: app.state,
        nomineeName: app.nomineeName,
        nomineeRelation: app.nomineeRelation,
        affidavit: app.affidavitUrl || "",
        passportPhoto: app.passportPhotoUrl || "",
        gender: app.gender,
        category: app.category,
        paymentAmount: mapped.paymentAmount,
        paymentMode: mapped.paymentMode,
        totalAmount,
        pendingAmount,
        age: mapped.age,
        payment_status: pendingAmount <= 0 ? 1 : 0,
        is_paid: pendingAmount <= 0 ? 1 : 0,
        isActive: app.isActive,
        created_at: app.createdAt.toISOString(),
        updated_at: app.updatedAt.toISOString(),
      },
    };
  }

  // ── CROSS-MODULE LOOKUPS ─────────────────────────────

  public async getAllApplicationsByMobile(mobile: string) {
    const apps = await prisma.generalApplication.findMany({
      where: { mobile, deletedAt: null },
      orderBy: { applicationDate: "desc" },
    });

    const current = await this.findCurrentApplication(mobile).catch(() => null);

    return {
      status: true,
      message: "Data fetched successfully",
      mobile,
      current_application_id: current?.id || null,
      total_records: apps.length,
      data: apps.map((app) => ({
        ...mapGeneralApplicationRecord(app),
        module_type: "normal",
        source_table: "applications",
        is_current_loggedin_application: current?.id === app.id ? 1 : 0,
      })),
    };
  }

  /**
   * Own EMI-payable records across every module this mobile is a member of.
   * Scoped to the customer's OWN registrations/entities only — does not
   * surface the wider pool of other members' marriage/mayra-congratulations
   * or suraksha-bima records a payer could optionally contribute toward
   * (that's the admin "Bulk EMI Collection" screens' job, driven by an
   * agent; a self-service customer endpoint pays down their own dues).
   */
  public async getUserBulkData(mobile: string) {
    const [generalApps, insuranceApps, mayraRegs] = await Promise.all([
      prisma.generalApplication.findMany({ where: { mobile, deletedAt: null } }),
      prisma.insuranceApplication.findMany({ where: { mobile, deletedAt: null } }),
      prisma.mayraRegistration.findMany({
        where: { mobile, deletedAt: null },
        include: { mayraCongrats: true, installments: true },
      }),
    ]);

    const applications = generalApps.map((app) => ({
      id: app.id,
      formNumber: app.formNumber,
      applicantName: app.applicantName,
      fatherName: app.fatherName,
      gotra: app.gotra,
      category: app.category,
      address: app.address,
      applicationDate: app.applicationDate.toISOString().slice(0, 10),
      gender: app.gender,
      mobile: app.mobile,
      pendingAmount: Number(app.pendingAmount),
      application_type: "normal",
      module_type: "normal",
      source_table: "applications",
    }));

    // Each active general-application member also owes a periodic
    // marriage-congratulations-pool contribution at their category's rate
    // (see MARRIAGE_CATEGORY_EMI_AMOUNTS) — surfaced here as informational
    // dues, not tied to any specific marriage entity (pick one via the admin
    // bulk screen, or pass its id straight into createPaymentOrder).
    const marriages = generalApps
      .filter((app) => app.isActive)
      .map((app) => ({
        applicantName: app.applicantName,
        fatherName: app.fatherName,
        application_id: app.id,
        formNumber: app.formNumber,
        category: app.category,
        gender: app.gender,
        emiAmount: MARRIAGE_CATEGORY_EMI_AMOUNTS[app.category] ?? 0,
        module_type: "marriage",
      }));

    const insurances = insuranceApps.map((app) => ({
      id: app.id,
      formNumber: app.formNumber,
      applicantName: app.applicantName,
      fatherName: app.fatherName,
      gotra: app.gotra,
      category: app.category,
      address: app.address,
      applicationDate: app.applicationDate.toISOString().slice(0, 10),
      gender: app.gender,
      mobile: app.mobile,
      pendingAmount: Number(app.pendingAmount),
      module_type: "insurance",
      source_table: "application_insurance",
    }));

    const surakshaBima = insuranceApps
      .filter((app) => app.isActive)
      .map((app) => ({
        applicantName: app.applicantName,
        fatherName: app.fatherName,
        insuranceApplication_id: app.id,
        formNumber: app.formNumber,
        emiAmount: SURAKSHA_BIMA_EMI_AMOUNT,
        module_type: "suraksha_bima",
      }));

    const mayras = mayraRegs.map((reg) => {
      const paid = reg.installments.reduce((sum, inst) => sum + Number(inst.amount), 0);
      const pending = Math.max(0, Number(reg.joiningFee) - paid);
      return {
        id: reg.id,
        formNumber: reg.formNumber,
        applicantName: reg.applicantName,
        fatherName: reg.fatherName,
        gotra: reg.gotra,
        applicationDate: reg.applicationDate.toISOString().slice(0, 10),
        gender: reg.gender,
        mobile: reg.mobile,
        pendingAmount: pending,
        mayraInstallment: Number(reg.mayraInstallment),
        module_type: "mayra",
        source_table: "mayra_registrations",
      };
    });

    // Like marriages above: the mayra-congratulations pool is funded by
    // active general-application members at their category's rate (see
    // getMayraPendingPayers in compatibility.routes.ts — `payer` there is a
    // GeneralApplication, not a MayraRegistration), not by mayra registrants.
    const mayraCongratulations = generalApps
      .filter((app) => app.isActive)
      .map((app) => ({
        applicantName: app.applicantName,
        fatherName: app.fatherName,
        application_id: app.id,
        formNumber: app.formNumber,
        category: app.category,
        gender: app.gender,
        emiAmount: MAYRA_CATEGORY_EMI_AMOUNTS[app.category] ?? 0,
        module_type: "mayra_congratulations",
      }));

    return {
      success: true,
      status: true,
      auth_mobile: mobile,
      applications,
      marriages,
      insurances,
      suraksha_bima: surakshaBima,
      mayras,
      mayra_congratulations: mayraCongratulations,
    };
  }

  // ── PAYMENTS ─────────────────────────────────────────

  public async createPaymentOrder(mobile: string, moduleType: unknown, entityIdInput: unknown) {
    const type = String(moduleType || "").trim();
    const entityId = String(entityIdInput || "").trim();
    if (!isValidUuid(entityId)) throw new BadRequestError("A valid entity_id is required");

    const { amount, referenceNumber, contactMobile } = await this.resolveDueAmount(mobile, type, entityId);
    if (amount <= 0) throw new BadRequestError("Nothing pending to pay for this entity");

    const order = await paymentsService.createRazorpayOrder(amount, `cust_${Date.now()}`);

    await prisma.customerPaymentTransaction.create({
      data: {
        mobile,
        moduleType: type,
        entityId,
        amount,
        razorpayOrderId: order.id,
        status: "created",
      },
    });

    return {
      status: true,
      message: "Order created successfully",
      key: process.env.RAZORPAY_KEY_ID || "",
      razorpay_order_id: order.id,
      amount: Number(order.amount),
      currency: order.currency,
      name: "Purbiya Balika Foundation",
      description: `${type}_emi_payment`,
      module_type: type,
      entity_id: entityId,
      reference_number: referenceNumber,
      prefill: { contact: contactMobile },
    };
  }

  public async verifyPaymentTransaction(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string
  ) {
    const txn = await prisma.customerPaymentTransaction.findUnique({ where: { razorpayOrderId } });
    if (!txn) throw new NotFoundError("Payment order not found");

    try {
      await paymentsService.verifyRazorpayPayment(razorpayOrderId, razorpayPaymentId, razorpaySignature);
    } catch (err: any) {
      await prisma.customerPaymentTransaction.update({
        where: { razorpayOrderId },
        data: { status: "failed", razorpayPaymentId },
      });
      return { status: false, message: err.message || "Payment signature verification failed" };
    }

    await this.recordVerifiedPayment(txn);

    await prisma.customerPaymentTransaction.update({
      where: { razorpayOrderId },
      data: { status: "paid", razorpayPaymentId },
    });

    return { status: true, message: "Payment verified successfully" };
  }

  public async getPaymentTransactionHistory(mobile: string, moduleType?: string, entityId?: string) {
    const where: any = { mobile };
    if (moduleType) where.moduleType = moduleType;
    if (entityId) where.entityId = entityId;

    const rows = await prisma.customerPaymentTransaction.findMany({ where, orderBy: { createdAt: "desc" } });

    return {
      status: true,
      message: "Payment history fetched successfully",
      mobile,
      total_records: rows.length,
      data: rows.map((row) => ({
        id: row.id,
        module_type: row.moduleType,
        entity_id: row.entityId,
        amount: Number(row.amount),
        status: row.status,
        razorpay_order_id: row.razorpayOrderId,
        razorpay_payment_id: row.razorpayPaymentId,
        date: row.createdAt.toISOString(),
      })),
    };
  }

  private async resolveDueAmount(mobile: string, moduleType: string, entityId: string) {
    if (moduleType === "normal") {
      const app = await prisma.generalApplication.findFirst({ where: { id: entityId, mobile, deletedAt: null } });
      if (!app) throw new NotFoundError("Application not found for this mobile number");
      return { amount: Number(app.pendingAmount), referenceNumber: app.formNumber, contactMobile: mobile };
    }

    if (moduleType === "insurance") {
      const app = await prisma.insuranceApplication.findFirst({ where: { id: entityId, mobile, deletedAt: null } });
      if (!app) throw new NotFoundError("Insurance application not found for this mobile number");
      return { amount: Number(app.pendingAmount), referenceNumber: app.formNumber, contactMobile: mobile };
    }

    if (moduleType === "mayra") {
      const reg = await prisma.mayraRegistration.findFirst({
        where: { id: entityId, mobile, deletedAt: null },
        include: { installments: true },
      });
      if (!reg) throw new NotFoundError("Mayra registration not found for this mobile number");
      const paid = reg.installments.reduce((sum, inst) => sum + Number(inst.amount), 0);
      return { amount: Math.max(0, Number(reg.joiningFee) - paid), referenceNumber: reg.formNumber, contactMobile: mobile };
    }

    if (moduleType === "marriage") {
      const congrats = await prisma.marriageCongratulations.findFirst({ where: { id: entityId, deletedAt: null } });
      if (!congrats) throw new NotFoundError("Marriage congratulations record not found");
      const payer = await this.requireActiveGeneralApplication(mobile);
      return {
        amount: MARRIAGE_CATEGORY_EMI_AMOUNTS[payer.category] ?? 0,
        referenceNumber: congrats.marriageNumber,
        contactMobile: mobile,
      };
    }

    if (moduleType === "mayra_congratulations") {
      const congrats = await prisma.mayraCongratulations.findFirst({ where: { id: entityId, deletedAt: null } });
      if (!congrats) throw new NotFoundError("Mayra congratulations record not found");
      const payer = await this.requireActiveGeneralApplication(mobile);
      return {
        amount: MAYRA_CATEGORY_EMI_AMOUNTS[payer.category] ?? 0,
        referenceNumber: congrats.mayraNumber,
        contactMobile: mobile,
      };
    }

    if (moduleType === "suraksha_bima") {
      const bima = await prisma.surakshaBimaYojana.findFirst({ where: { id: entityId, deletedAt: null } });
      if (!bima) throw new NotFoundError("Suraksha Bima record not found");
      await this.requireActiveInsuranceApplication(mobile);
      return { amount: SURAKSHA_BIMA_EMI_AMOUNT, referenceNumber: bima.bimaNumber, contactMobile: mobile };
    }

    throw new BadRequestError(`Unsupported module_type: ${moduleType}`);
  }

  private async recordVerifiedPayment(txn: { moduleType: string; entityId: string; amount: any; mobile: string }) {
    const today = new Date().toISOString().slice(0, 10);
    const amount = Number(txn.amount);
    const note = "Online Payment (Razorpay - Customer Self-Service)";

    if (txn.moduleType === "normal") {
      await applicationsService.addGeneralInstallment(
        txn.entityId,
        { amount, date: today, note, paymentMode: "razorpay" },
        SYSTEM_CUSTOMER_PAYMENT_USER_ID
      );
      return;
    }

    if (txn.moduleType === "insurance") {
      await applicationsService.addInsuranceInstallment(
        txn.entityId,
        { amount, date: today, note, paymentMode: "razorpay" },
        SYSTEM_CUSTOMER_PAYMENT_USER_ID
      );
      return;
    }

    if (txn.moduleType === "mayra") {
      await mayraService.addMayraInstallment(
        txn.entityId,
        { amount, date: today, note, paymentMode: "razorpay" },
        SYSTEM_CUSTOMER_PAYMENT_USER_ID
      );
      return;
    }

    if (txn.moduleType === "marriage") {
      const payer = await this.requireActiveGeneralApplication(txn.mobile);
      await schemesService.addMarriageCongratulationsPayment(
        txn.entityId,
        { amount, applicationId: payer.id, category: "EMI" },
        SYSTEM_CUSTOMER_PAYMENT_USER_ID
      );
      return;
    }

    if (txn.moduleType === "mayra_congratulations") {
      const payer = await this.requireActiveGeneralApplication(txn.mobile);
      await mayraService.addMayraCongratulationsPayment(
        txn.entityId,
        { amount, applicationId: payer.id, category: "EMI" },
        SYSTEM_CUSTOMER_PAYMENT_USER_ID
      );
      return;
    }

    if (txn.moduleType === "suraksha_bima") {
      const payer = await this.requireActiveInsuranceApplication(txn.mobile);
      await applicationsService.addInsuranceInstallment(
        payer.id,
        { amount, date: today, note: `BIMA_PAYMENT:${txn.entityId}`, paymentMode: "razorpay" },
        SYSTEM_CUSTOMER_PAYMENT_USER_ID
      );
      return;
    }

    throw new BadRequestError(`Unsupported module_type: ${txn.moduleType}`);
  }

  private async requireActiveGeneralApplication(mobile: string) {
    const app = await prisma.generalApplication.findFirst({
      where: { mobile, isActive: true, deletedAt: null },
      orderBy: { applicationDate: "desc" },
    });
    if (!app) throw new BadRequestError("No active application eligible to make this EMI contribution");
    return app;
  }

  private async requireActiveInsuranceApplication(mobile: string) {
    const app = await prisma.insuranceApplication.findFirst({
      where: { mobile, isActive: true, deletedAt: null },
      orderBy: { applicationDate: "desc" },
    });
    if (!app) throw new BadRequestError("No active insurance application eligible to make this EMI contribution");
    return app;
  }

  // ── MISC ─────────────────────────────────────────────

  public async getAllModuleMemberCounts() {
    const [normal, insurance, mayra] = await Promise.all([
      prisma.generalApplication.count({ where: { deletedAt: null } }),
      prisma.insuranceApplication.count({ where: { deletedAt: null } }),
      prisma.mayraRegistration.count({ where: { deletedAt: null } }),
    ]);

    return {
      status: true,
      message: "All module member counts fetched successfully",
      data: [
        { module_type: "normal", source_table: "applications", total_members: normal },
        { module_type: "insurance", source_table: "application_insurance", total_members: insurance },
        { module_type: "mayra", source_table: "mayra_registrations", total_members: mayra },
      ],
    };
  }

  public async getLatestAnnouncements(applicationType?: string) {
    const type = applicationType && applicationType !== "all" ? applicationType : undefined;
    const rows = await prisma.announcement.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(type ? { OR: [{ applicationType: "all" }, { applicationType: type }] } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return {
      status: true,
      message: "Announcements fetched successfully",
      application_type: applicationType || "all",
      total_records: rows.length,
      data: rows.map((row) => ({
        id: row.id,
        title: row.title,
        message: row.message,
        application_type: row.applicationType,
        created_at: row.createdAt.toISOString(),
      })),
    };
  }

  public async getAnnouncementDetails(id: unknown) {
    const announcement = id && isValidUuid(String(id))
      ? await prisma.announcement.findFirst({ where: { id: String(id), deletedAt: null } })
      : null;

    if (!announcement) {
      return { status: false, message: "Announcement not found" };
    }

    return {
      status: true,
      message: "Announcement fetched successfully",
      data: {
        id: announcement.id,
        title: announcement.title,
        message: announcement.message,
        application_type: announcement.applicationType,
        created_at: announcement.createdAt.toISOString(),
      },
    };
  }
}
