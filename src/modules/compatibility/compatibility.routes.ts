import "regenerator-runtime/runtime";
import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { AuthService } from "../auth/auth.service";
import bcrypt from "bcryptjs";
import { ApplicationsService } from "../applications/applications.service";
import { SchemesService } from "../schemes/schemes.service";
import { MayraService } from "../mayra/mayra.service";
import { PaymentsService } from "../payments/payments.service";
import { AgentsService } from "../agents/agents.service";
import { DashboardService } from "../dashboard/dashboard.service";
import { verifyAccessToken } from "../../utils/jwt";
import { prisma } from "../../config/db";
import { saveImagePayload } from "../../utils/file-upload";
// drawDevanagariText imported via dynamic require where needed
import { NotFoundError, BadRequestError, ConflictError } from "../../utils/errors";
import { findAadharOwner, AadharSourceModel } from "../../utils/aadhar-uniqueness";
import {
  applyPartialUpdate,
  buildUpdateData,
  isValidUuid,
  mapGeneralApplicationList,
  mapGeneralApplicationRecord,
  mapDisabilityCycleList,
  mapDisabilityCycleRecord,
  mapSewingMachineCampList,
  mapSewingMachineCampRecord,
  mapPensionYojanaList,
  mapPensionYojanaRecord,
  mapLoanApplicationList,
  mapLoanApplicationRecord,
  mapFinancialHelpList,
  mapFinancialHelpRecord,
  mapAgentList,
  mapAgentRecord,
  mapInsuranceApplicationList,
  mapInsuranceApplicationRecord,
  mapMayraApplicationList,
  mapMayraApplicationRecord,
  mapMayraCongratulationsList,
  mapMayraCongratulationsRecord,
  mapSurakshaBimaList,
  mapSurakshaBimaRecord,
  resolvePayerApplicationWhere,
  mapMarriageCongratulationsList,
  mapMarriageCongratulationsRecord,
} from "../../utils/compat-helpers";
import {
  normalizeListFilters,
  applyAddressContains,
  applyDateRangeToField,
  paginateByFormNumberSeq,
} from "../../utils/list-filters";
import { parseDateInput, parseOptionalDateInput } from "../../utils/parse-date";
import { softDeleteRecord, softDeleteWithChildren } from "../../utils/soft-delete";
import { normalizePaymentMode } from "../../utils/normalize";
import { recordLegacyPaymentEntry, formatCashFlowName, formatEmiContributionName } from "../../utils/legacy-payment-entry";

const router = Router();

// In-memory cache for expensive agent reports (10-minute TTL)
// const pendingEmiCache = new Map<string, { data: any; expiresAt: number }>();
const bulkDataCache   = new Map<string, { data: any; expiresAt: number }>();
bulkDataCache.clear();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Fixed per-member EMI for Suraksha Bima Yojana. NOTE: SurakshaBimaYojana.rate200
// is NOT a rate — despite the name, it stores the pool's member count (see
// suraksha-bima-yojana add form: "rate200 = memberCount"). It must never be
// read as the per-installment EMI amount.
const SURAKSHA_BIMA_EMI_AMOUNT = 200;

// Fixed per-member EMI by category for Marriage Congratulations. Same
// footgun as SURAKSHA_BIMA_EMI_AMOUNT above: MarriageCongratulations.rate100/
// rate200/rate300 are NOT rates — despite the names, they store category
// member counts (see marriage-congratulations add form, where these fields
// are populated from category counts, not from the 100/200/300 rate table).
// They must never be read as the per-installment EMI amount.
const MARRIAGE_CATEGORY_EMI_AMOUNTS: Record<string, number> = { A: 100, B: 200, C: 300 };

// Same footgun as MARRIAGE_CATEGORY_EMI_AMOUNTS above, for Mayra
// Congratulations: MayraCongratulations.rate200/rate300 store category
// member counts, not the per-installment EMI amount. Mayra only pays out
// for categories B and C (legacy behaviour — category A gets 0).
const MAYRA_CATEGORY_EMI_AMOUNTS: Record<string, number> = { B: 200, C: 300 };

// Setup multer disk storage for file uploads
const uploadsDir = path.join(__dirname, "../../../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

const authService = new AuthService();
const appsService = new ApplicationsService();
const schemesService = new SchemesService();
const mayraService = new MayraService();
const paymentsService = new PaymentsService();
const agentsService = new AgentsService();
const dashboardService = new DashboardService();

// Server-side re-check of an agent's module permission, mirroring
// middlewares/rbac.ts's checkPermission but usable inline inside this
// file's single apicall switch (which isn't per-route Express middleware).
// Admins always pass; agents must have the matching AgentPermission row.
async function hasAgentPermission(
  user: { userId?: string; role?: string } | null,
  moduleName: string,
  action: "view" | "create" | "update" | "delete"
): Promise<boolean> {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  const permission = await prisma.agentPermission.findUnique({
    where: { userId_module: { userId: user.userId as string, module: moduleName } },
  });
  if (!permission) return false;
  if (action === "view") return permission.canView;
  if (action === "create") return permission.canCreate;
  if (action === "update") return permission.canUpdate;
  return permission.canDelete;
}

router.all("/", upload.any(), async (req: Request, res: Response) => {
  const apicall = req.query.apicall || req.body.apicall;
  
  if (!apicall) {
    return res.status(400).json({ error: true, message: "Missing apicall parameter" });
  }

  // Handle file fields by updating req.body with the local upload relative URL
  if (req.files && Array.isArray(req.files)) {
    req.files.forEach((file: any) => {
      req.body[file.fieldname] = `/uploads/${file.filename}`;
    });
  }

  // Convert base64 image strings in req.body into static file URLs in /uploads
  for (const key of ["passportPhoto", "passport_photo", "photo", "affidavit", "affidavitUrl", "passportPhotoUrl", "existingPhotoUrl", "existingPassportPhoto"]) {
    if (req.body[key] && typeof req.body[key] === "string" && (req.body[key].startsWith("data:image/") || req.body[key].length > 500)) {
      const saved = saveImagePayload(req.body[key]);
      if (saved) {
        req.body[key] = saved;
      }
    }
  }

  const payload = { ...req.query, ...req.body };
  delete payload.apicall;

  // Conditional Authentication Check
  let user: any = null;
  const publicActions = ["login", "agentLogin", "register"];
  if (!publicActions.includes(apicall as string)) {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || typeof authHeader !== "string") {
      return res.status(200).json({ error: true, message: "Unauthorized - Token missing" });
    }
    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(200).json({ error: true, message: "Unauthorized - Token malformed" });
    }
    try {
      const decoded = verifyAccessToken(token);
      user = decoded;
    } catch (err: any) {
      return res.status(200).json({ error: true, message: `Unauthorized - Invalid token: ${err.message}` });
    }
  }

  const addedById = user?.userId || "";

  try {
    switch (apicall) {
      // ── MAYRA FEE LOOKUP ──
      case "calculateMayraFees": {
        try {
          const { dob } = payload;
          if (!dob) return res.status(400).json({ error: true, message: "Date of Birth is required" });

          const birthDate = new Date(dob);
          if (isNaN(birthDate.getTime())) return res.status(400).json({ error: true, message: "Invalid Date of Birth" });

          let age = new Date().getFullYear() - birthDate.getFullYear();
          const m = new Date().getMonth() - birthDate.getMonth();
          if (m < 0 || (m === 0 && new Date().getDate() < birthDate.getDate())) {
            age--;
          }

          if (age < 10) {
            return res.status(400).json({ error: true, message: "Age must be at least 10 years for Mayra Registration" });
          }

          const activeSlabs = await prisma.schemeAgeSlab.findMany({
            where: { schemeType: 'MAYRA', status: 'Active' },
          });

          const matchedSlab = activeSlabs.find(slab => age >= slab.minAge && (slab.maxAge === null || age <= slab.maxAge));

          if (!matchedSlab) {
            return res.status(400).json({ error: true, message: "No active age slab found for the provided Date of Birth" });
          }

          return res.json({
            status: true,
            error: false,
            data: {
              age,
              slabCode: matchedSlab.slabCode,
              slabName: matchedSlab.slabName,
              resolvedMinAge: matchedSlab.minAge,
              resolvedMaxAge: matchedSlab.maxAge,
              joiningFee: Number(matchedSlab.joiningFee),
              mayraInstallment: Number(matchedSlab.installment)
            }
          });
        } catch (error: any) {
          return res.status(500).json({ error: true, message: error.message });
        }
      }

      // ── AUTHENTICATION ──
      case "login": {
        const { mobile, password } = payload;
        const result = await authService.loginAdmin(mobile, password);
        return res.json({
          status: true,
          error: false,
          message: "Login successful",
          user: {
            id: result.user.id,
            name: result.user.name,
            email: result.user.email,
            mobile: result.user.mobile,
            token: result.accessToken,
          }
        });
      }

      case "agentLogin": {
        const { mobile, password } = payload;
        const result = await authService.loginAgent(mobile, password);
        return res.json({
          status: true,
          error: false,
          message: "Agent login successful",
          agent: {
            ...result.agent,
            token: result.accessToken,
          }
        });
      }

      case "logout": {
        return res.json({ status: true, error: false, message: "Logged out successfully" });
      }

      case "getDashboardCounts": {
        const dashboard = await dashboardService.getCounts({
          userId: user?.userId,
          role: user?.role,
        });

        return res.json({
          success: true,
          status: true,
          error: false,
          dashboard,
        });
      }

      case "getAgentPermissions": {
        const agentId = payload.agent_id || payload.agentId;
        const permissions = await agentsService.getAgentPermissions(agentId);
        const formatted = permissions.map((perm: any) => {
          const actions: string[] = [];
          if (perm.canView) actions.push("view");
          if (perm.canCreate) actions.push("create");
          if (perm.canUpdate) actions.push("update");
          if (perm.canDelete) actions.push("delete");
          return { module: perm.module, actions };
        });
        return res.json({ status: true, error: false, permissions: formatted });
      }

      case "setAgentPermissions": {
        const agentId = payload.agent_id || payload.agentId;
        const rawPermissions = Array.isArray(payload.permissions) ? payload.permissions : [];
        const mapped = rawPermissions.map((perm: any) => {
          const actions: string[] = Array.isArray(perm.actions) ? perm.actions : [];
          return {
            module: perm.module,
            canView: actions.includes("view"),
            canCreate: actions.includes("create"),
            canUpdate: actions.includes("update"),
            canDelete: actions.includes("delete"),
          };
        });
        const result = await agentsService.updateAgentPermissions(agentId, mapped);
        return res.json({ status: true, error: false, message: "Permissions updated successfully", data: result });
      }

      case "getAllBulkData": {
        const agentId = payload.addedby_id || payload.agentId;
        const startDate = new Date(payload.startDate || "2000-01-01");
        const endDate = new Date(payload.endDate || new Date());
        const gender = payload.gender;

        const cacheKey = `${agentId}_${startDate.getTime()}_${endDate.getTime()}_${gender || "all"}`;
        const cached = bulkDataCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          return res.json(cached.data);
        }

        const result = await paymentsService.getAgentCommissionReport(
          agentId,
          startDate,
          endDate,
          gender
        );
        const mapItems = (items: any[]) =>
          items.map((item, index) => ({
            id: String(index + 1),
            date: item.date || payload.endDate || new Date().toISOString().slice(0, 10),
            formNo: item.form_number || item.formNumber || "",
            name: item.name || "",
            amount: Number(item.amount || 0),
            payment_mode: item.payment_mode || "N/A",
            feeType: item.fee_type || "",
          }));

        const responseData = {
          success: true,
          status: true,
          error: false,
          applications: mapItems(result.applications || []),
          application_installments: mapItems(result.application_installments || []),
          insurances: mapItems(result.insurances || []),
          insurance_installments: mapItems(result.insurance_installments || []),
          suraksha_bima_yojana: mapItems(result.suraksha_bima_yojana || []),
          suraksha_bima_emi: mapItems(result.suraksha_bima_emi || []),
          marriage_congratulations: mapItems(result.marriage_congratulations || []),
          marriage_congratulations_emi: mapItems(result.marriage_congratulations_emi || []),
          mayra_applications: mapItems(result.mayra_applications || []),
          mayra_installments: mapItems(result.mayra_installments || []),
          mayra_congratulations: mapItems(result.mayra_congratulations || []),
          mayra_congratulations_emi: mapItems(result.mayra_congratulations_emi || []),
          loan_repayments: mapItems(result.loan_repayments || []),
          financial_helps: mapItems(result.financial_helps || []),
          financial_help_installments: mapItems(result.financial_help_installments || []),
          pension_payments: mapItems(result.pension_payments || []),
        };

        bulkDataCache.set(cacheKey, {
          data: responseData,
          expiresAt: Date.now() + CACHE_TTL_MS
        });

        return res.json(responseData);
      }

      case "addAgentPaymentForDetails": {
        const result = await paymentsService.payAgentCommission(
          payload.agentId,
          Number(payload.amount),
          new Date(payload.startDate || "2000-01-01"),
          new Date(payload.endDate || new Date()),
          addedById || user?.userId || ""
        );
        return res.json({
          success: true,
          status: true,
          error: false,
          message: "Agent payment recorded successfully",
          data: result,
        });
      }

      // ── GENERAL APPLICATIONS ──
      // Aadhaar numbers must be unique across every scheme in the app, not just within
      // one form. The frontend calls this on blur so a duplicate is caught before the
      // user finishes filling out the rest of the form, ahead of the create-time check
      // every createX/updateX case below also enforces server-side.
      case "checkAadharAvailability": {
        const aadharNumber = String(payload.aadharNumber || "").replace(/\D/g, "");
        if (aadharNumber.length !== 12) {
          return res.json({ status: true, error: false, available: false, message: "Aadhaar must be exactly 12 digits" });
        }
        const sourceModel = payload.sourceModel as AadharSourceModel | undefined;
        const excludeModel = payload.excludeModel as AadharSourceModel | undefined;
        const excludeId = payload.excludeId ? String(payload.excludeId) : undefined;
        const owner = await findAadharOwner(
          prisma,
          aadharNumber,
          excludeModel && excludeId ? { model: excludeModel, id: excludeId } : undefined,
          sourceModel
        );
        return res.json({
          status: true,
          error: false,
          available: !owner,
          scheme: owner ? owner.label : null,
        });
      }

      case "createApplication": {
        const result = await appsService.createGeneralApplication(payload, addedById, user?.role);
        return res.json({
          status: true,
          error: false,
          message: "Application created successfully",
          data: result,
          id: result.id,
          formNumber: result.formNumber,
          applicationNumber: result.formNumber,
        });
      }

      case "getApplications": {
        if (payload.id) {
          const result = await appsService.getGeneralApplicationById(payload.id);
          return res.json({
            status: true,
            error: false,
            data: mapGeneralApplicationRecord(result as Record<string, any>),
          });
        }

        const result = await appsService.getAllGeneralApplications(payload);
        if (result && typeof result === "object" && "data" in result) {
          return res.json({
            status: true,
            error: false,
            data: mapGeneralApplicationList((result as any).data),
            pagination: (result as any).meta,
          });
        }
        return res.json({
          status: true,
          error: false,
          data: mapGeneralApplicationList(result),
        });
      }

      case "updateApplication": {
        const result = await appsService.updateGeneralApplication(payload.id, payload);
        return res.json({ status: true, error: false, message: "Application updated successfully", data: result });
      }

      case "deleteApplication": {
        const result = await appsService.softDeleteGeneralApplication(payload.id);
        return res.json({ status: true, error: false, message: "Application deleted successfully", data: result });
      }

      case "updateApplicationActiveStatus": {
        const currentStatus = payload.is_active === "1" || payload.is_active === 1;
        const result = await prisma.generalApplication.update({
          where: { id: payload.id },
          data: { isActive: currentStatus }
        });
        return res.json({ status: true, error: false, message: "Status updated successfully", data: result });
      }

      // ── INSURANCE APPLICATIONS ──
      case "createInsuranceApplication": {
        const result = await appsService.createInsuranceApplication(payload, addedById, user?.role);
        return res.json({ status: true, error: false, message: "Insurance application created successfully", data: result });
      }

      case "getInsuranceApplication": {
        if (payload.id) {
          const result = await appsService.getInsuranceApplicationById(payload.id);
          return res.json({
            status: true,
            error: false,
            data: mapInsuranceApplicationRecord(result as Record<string, any>),
          });
        } else {
          const result = await appsService.getAllInsuranceApplications(payload);
          if (result && typeof result === "object" && "data" in result) {
            return res.json({
              status: true,
              error: false,
              data: mapInsuranceApplicationList((result as any).data),
              pagination: (result as any).meta,
            });
          }
          return res.json({
            status: true,
            error: false,
            data: mapInsuranceApplicationList(result),
          });
        }
      }

      case "editInsuranceApplication": {
        const result = await appsService.updateInsuranceApplication(payload.id, payload);
        return res.json({ status: true, error: false, message: "Insurance application updated successfully", data: result });
      }

      case "deleteInsuranceApplication": {
        const result = await appsService.softDeleteInsuranceApplication(payload.id);
        return res.json({ status: true, error: false, message: "Insurance application deleted successfully", data: result });
      }

      case "updateInsuranceApplicationActiveStatus": {
        const currentStatus = payload.is_active === "1" || payload.is_active === 1;
        const result = await prisma.insuranceApplication.update({
          where: { id: payload.id },
          data: { isActive: currentStatus }
        });
        return res.json({ status: true, error: false, message: "Status updated successfully", data: result });
      }

      // ── INSURANCE INSTALLMENTS ──
      case "getApplicationInsuranceInstallments": {
        const result = await prisma.insuranceApplicationInstallment.findMany({
          where: { applicationInsuranceId: payload.application_insurance_id, deletedAt: null },
          orderBy: { date: "asc" }
        });
        return res.json({ status: true, error: false, data: result });
      }

      case "addApplicationInsuranceInstallment": {
        const result = await appsService.addInsuranceInstallment(payload.application_insurance_id, payload, addedById);
        return res.json({ status: true, error: false, message: "Installment added successfully", data: result });
      }

      // ── LOANS ──
      case "addLoanApplication": {
        const result = await schemesService.createLoan(payload, addedById, user?.role);
        return res.json({
          status: true,
          error: false,
          message: "Loan application created successfully",
          data: mapLoanApplicationRecord(result as Record<string, any>),
        });
      }

      case "getLoanApplications": {
        if (payload.id && isValidUuid(payload.id)) {
          const result = await schemesService.getLoanById(payload.id);
          return res.json({
            status: true,
            error: false,
            data: mapLoanApplicationRecord(result as Record<string, any>),
          });
        }
        const result = await schemesService.getAllLoans(payload);
        if (result && typeof result === "object" && "data" in result) {
          return res.json({
            status: true,
            error: false,
            data: mapLoanApplicationList((result as any).data),
            pagination: (result as any).meta,
          });
        }
        return res.json({
          status: true,
          error: false,
          data: mapLoanApplicationList(result),
        });
      }

      case "getLoanApplicationInstallments": {
        const result = await prisma.loanApplicationInstallment.findMany({
          where: { loanApplicationId: payload.loan_application_id, deletedAt: null },
          orderBy: { date: "asc" }
        });
        const userRepayment = result.filter((row) => row.type === "USER_REPAYMENT");
        const wePaid = result.filter((row) => row.type === "WE_PAID");
        return res.json({
          status: true,
          error: false,
          data: result,
          userRepayment,
          wePaid,
        });
      }

      case "addLoanApplicationInstallment": {
        const result = await schemesService.addLoanInstallment(payload.loan_application_id, payload, addedById);
        return res.json({ status: true, error: false, message: "Installment added successfully", data: result });
      }

      // ── FINANCIAL HELP ──
      case "addFinancialHelp": {
        const result = await schemesService.createFinancialHelp(payload, addedById, user?.role);
        return res.json({
          status: true,
          error: false,
          message: "Financial help record created successfully",
          data: mapFinancialHelpRecord(result as Record<string, any>),
        });
      }

      case "getFinancialHelps": {
        if (payload.id && isValidUuid(payload.id)) {
          const result = await schemesService.getFinancialHelpById(payload.id);
          return res.json({
            status: true,
            error: false,
            data: mapFinancialHelpRecord(result as Record<string, any>),
          });
        }
        const result = await schemesService.getAllFinancialHelps(payload);
        if (result && typeof result === "object" && "data" in result) {
          return res.json({
            status: true,
            error: false,
            data: mapFinancialHelpList((result as any).data),
            pagination: (result as any).meta,
          });
        }
        return res.json({
          status: true,
          error: false,
          data: mapFinancialHelpList(result),
        });
      }

      case "getFinancialHelpInstallments": {
        if (!isValidUuid(payload.financial_help_id)) {
          return res.status(200).json({ error: true, message: "Record not found" });
        }
        const result = await prisma.$queryRaw`
          SELECT id, financial_help_id, amount, date, note, created_at
          FROM financial_help_installments
          WHERE financial_help_id = ${String(payload.financial_help_id)}::uuid
            AND deleted_at IS NULL
          ORDER BY date ASC`;
        return res.json({ status: true, error: false, data: result });
      }

      case "addFinancialHelpInstallment": {
        if (!isValidUuid(payload.financial_help_id)) {
          return res.status(200).json({ error: true, message: "Record not found" });
        }
        const exists = await prisma.financialHelp.findUnique({
          where: { id: payload.financial_help_id }
        });
        if (!exists) {
          return res.status(200).json({ error: true, message: "Record not found" });
        }
        const rows = await prisma.$queryRaw`
          INSERT INTO financial_help_installments (id, financial_help_id, amount, date, note, added_by_id, created_at, updated_at)
          VALUES (
            gen_random_uuid(),
            ${String(payload.financial_help_id)}::uuid,
            ${Number(payload.amount)},
            ${payload.date}::date,
            ${payload.note || null},
            ${String(addedById || payload.addedby_id || user?.userId)}::uuid,
            NOW(),
            NOW()
          )
          RETURNING id, financial_help_id, amount, date, note, created_at`;
        const result = Array.isArray(rows) ? rows[0] : rows;
        await recordLegacyPaymentEntry(prisma, {
          legacyId: result.id,
          date: result.date,
          amount: result.amount,
          name: formatCashFlowName([exists.formNumber, exists.name, exists.village]),
          source: "financial_help",
          type: "Out",
        });
        return res.json({ status: true, error: false, message: "Installment added successfully", data: result });
      }

      // ── DISABILITY CYCLE ──
      case "addDisabilityCycle": {
        const result = await schemesService.createDisabilityCycle(payload, addedById, user?.role);
        return res.json({ status: true, error: false, message: "Disability cycle created successfully", data: result });
      }

      case "getDisabilityCycles": {
        if (payload.id && isValidUuid(payload.id)) {
          const result = await schemesService.getDisabilityCycleById(payload.id);
          return res.json({
            status: true,
            error: false,
            data: mapDisabilityCycleRecord(result as Record<string, any>),
          });
        }
        const result = await schemesService.getAllDisabilityCycles(payload);
        return res.json({
          status: true,
          error: false,
          data: mapDisabilityCycleList(result),
        });
      }

      // ── AGENTS ──
      case "addAgent": {
        const result = await agentsService.createAgent(payload);
        return res.json({
          status: true,
          error: false,
          message: "Agent created successfully",
          data: mapAgentRecord(result as Record<string, any>),
        });
      }

      case "getAgents": {
        if (payload.id) {
          const result = await agentsService.getAgentById(payload.id);
          return res.json({ status: true, error: false, data: mapAgentRecord(result as Record<string, any>) });
        }
        const result = await agentsService.getAllAgents({
          gender: payload.gender,
          village: payload.village,
        });
        return res.json({ status: true, error: false, data: mapAgentList(result) });
      }

      case "getAgentWiseReport": {
        if (user?.role !== "ADMIN") {
          return res.status(200).json({ error: true, message: "Unauthorized - Admin access only" });
        }
        const startDate = new Date(payload.startDate || "2000-01-01");
        const endDate = new Date(payload.endDate || new Date());
        const result = await agentsService.getAgentRecordsReport(startDate, endDate);
        return res.json({
          success: true,
          status: true,
          error: false,
          categories: result.categories,
          agents: result.agents,
        });
      }

      case "editAgent": {
        const result = await agentsService.updateAgent(payload.id, payload);
        return res.json({
          status: true,
          error: false,
          message: "Agent updated successfully",
          data: mapAgentRecord(result as Record<string, any>),
        });
      }

      case "deleteAgent": {
        const result = await agentsService.softDeleteAgent(payload.id);
        return res.json({ status: true, error: false, message: "Agent deleted successfully", data: result });
      }

      // ── MARRIAGE CONGRATULATIONS ──
      case "addMarriageCongrats": {
        const result = await schemesService.createMarriageCongratulations(payload, addedById, user?.role);
        return res.json({ status: true, error: false, message: "Marriage congratulations created successfully", data: result });
      }

      case "getMarriageCongrats": {
        if (payload.id && isValidUuid(payload.id)) {
          const result = await schemesService.getMarriageCongratulationsById(payload.id);
          return res.json({ status: true, error: false, data: mapMarriageCongratulationsRecord(result as Record<string, any>) });
        }
        const result = await schemesService.getAllMarriageCongratulations(payload);
        if (result && typeof result === "object" && "data" in result) {
          return res.json({
            status: true,
            error: false,
            data: mapMarriageCongratulationsList((result as any).data),
            pagination: (result as any).meta,
          });
        }
        return res.json({ status: true, error: false, data: mapMarriageCongratulationsList(result) });
      }

      case "getMarriageCongratulations": {
        const marriageCongratsId = payload.marriage_congrats_id || payload.id;
        const appId = payload.application_id;
        let details: any = null;

        if (marriageCongratsId) {
          try {
            details = await schemesService.getMarriageCongratulationsById(marriageCongratsId);
          } catch (err) {
            // Ignore and fallback
          }
        }

        if (!details && appId) {
          const app = await prisma.generalApplication.findUnique({
            where: { id: appId }
          });
          if (app) {
            details = {
              id: app.id,
              applicantName: app.applicantName,
              fatherName: app.fatherName,
              gotra: app.gotra,
              address: app.address,
              applicationDate: app.applicationDate,
              gender: app.gender,
              totalAmount: app.totalAmount,
            };
          }
        }

        if (!details) {
          return res.json({ status: false, error: true, message: "Application or congratulations record not found" });
        }

        // Resolve the linked GeneralApplication id. When we started from a
        // marriageCongratsId, `details.id` is the marriageCongratulations row's
        // own id (there is no FK between the two tables) — the durable link is
        // codeNumber === generalApplication.formNumber, set at creation time.
        let linkedApplicationId = appId;
        if (!linkedApplicationId && marriageCongratsId && details?.codeNumber) {
          const linkedApp = await prisma.generalApplication.findFirst({
            where: { formNumber: details.codeNumber, deletedAt: null },
            select: { id: true },
          });
          linkedApplicationId = linkedApp?.id;
        }
        if (!linkedApplicationId) {
          linkedApplicationId = details?.id;
        }

        const targetDate = payload.date ? parseDateInput(payload.date) : new Date();

        // Members are counted per the applicant's OWN gender (legacy behaviour):
        // a girls' form counts only girls, a boys' form counts only boys. For
        // Other/unknown gender fall back to counting everyone so the total is
        // never empty.
        const memberGenderRaw = String(details?.gender || "").trim().toLowerCase();
        const memberGender =
          memberGenderRaw === "male"
            ? "Male"
            : memberGenderRaw === "female"
              ? "Female"
              : null;

        const activeMembers = await prisma.generalApplication.findMany({
          where: {
            // id: linkedApplicationId ? { not: linkedApplicationId } : undefined, // Applicant is now included
            applicationDate: { lte: targetDate },
            deletedAt: null,
            isActive: true,
            ...(memberGender ? { gender: memberGender as any } : {}),
          },
          select: {
            category: true
          }
        });

        const countsMap: Record<string, number> = { A: 0, B: 0, C: 0 };
        activeMembers.forEach(m => {
          const cat = m.category.toString().toUpperCase();
          if (cat === "A" || cat === "B" || cat === "C") {
            countsMap[cat]++;
          }
        });

        const counts = [
          { category: "A", total: countsMap.A },
          { category: "B", total: countsMap.B },
          { category: "C", total: countsMap.C }
        ];

        // Dynamic installment calculation based on date and category
        const memberApp = await prisma.generalApplication.findFirst({
          where: { id: linkedApplicationId || "", deletedAt: null },
          select: { category: true, applicationDate: true }
        });

        let rate = 300;
        if (memberApp) {
          const cat = String(memberApp.category || "").toUpperCase();
          if (cat === "A") rate = 100;
          else if (cat === "B") rate = 200;
          else if (cat === "C") rate = 300;
        }

        let otherMarriagesCount = 0;
        if (memberApp?.applicationDate) {
          const joinDateStr = memberApp.applicationDate instanceof Date
            ? memberApp.applicationDate.toISOString().split('T')[0]
            : String(memberApp.applicationDate);
          const joinDate = parseDateInput(joinDateStr);

          // Approved Foundation Business Rule for Previous Members Count
          // 1. Same Gender
          // 2. Membership Join Date >= Current Applicant Membership Join Date
          // 3. Marriage Congratulations Completed (Implicit via existence)
          // 4. Marriage Date < Current Applicant Marriage Date
          // 5. Deleted No
          otherMarriagesCount = await prisma.marriageCongratulations.count({
            where: {
              ...(memberGender ? { gender: memberGender as any } : {}),
              membershipJoinDate: {
                gte: joinDate
              },
              date: {
                lt: targetDate
              },
              id: marriageCongratsId && isValidUuid(marriageCongratsId) ? { not: marriageCongratsId } : undefined,
              deletedAt: null
            }
          });
        }

        const totalEMI = (otherMarriagesCount + 1) * rate;

        let previousTotalMembers = 0;
        let previousPaymentDate = null;
        if (memberGender) {
          const previousRecord = await prisma.marriageCongratulations.findFirst({
            where: {
              date: { lt: targetDate },
              deletedAt: null,
              gender: memberGender as any
            },
            orderBy: { date: 'desc' },
            select: { date: true, totalMembersServing: true }
          });
          
          if (previousRecord) {
            previousPaymentDate = previousRecord.date;
            previousTotalMembers = previousRecord.totalMembersServing;
          }
        }

        const currentTotalMembers = countsMap.A + countsMap.B + countsMap.C;
        const difference = currentTotalMembers - previousTotalMembers;

        return res.json({
          status: true,
          error: false,
          data: details,
          counts,
          totalEMI,
          previousPaymentDate,
          previousTotalMembers,
          currentTotalMembers,
          difference
        });
      }

      case "getPreviousApplicationsMembers": {
        const result = await schemesService.getMarriageCongratulationsMembers(payload.id);
        return res.json(result);
      }

      case "getMarriageCongratulationsPayment": {
        const marriageId = payload.marriage_congratulations_id ?? payload.id;
        const result = await schemesService.getMarriageCongratulationsPayments(marriageId);
        return res.json(result);
      }

      case "createMarriageCongratulationsPayment": {
        const marriageId =
          payload.marriage_congratulations_id ??
          payload.marriageCongratulationsId ??
          payload.id;
        const normalizedData = {
          amount: payload.amount !== undefined ? Number(payload.amount) : undefined,
          category: payload.category,
          applicationId:
            payload.application_id ?? payload.applicationId ?? null,
        };
        const result = await schemesService.addMarriageCongratulationsPayment(
          String(marriageId),
          normalizedData,
          addedById
        );
        return res.json({ status: true, error: false, message: "Payment added successfully", data: result });
      }

      case "getMarriageCongratulationsInstallments": {
        const marriageId =
          payload.marriage_congratulations_id ??
          payload.marriageCongratulationsId ??
          payload.id;
        const prefix = `MARRIAGE_PERMANENT_FEE:${marriageId}`;
        const rows = await prisma.payment.findMany({
          where: {
            deletedAt: null,
            remark: { startsWith: prefix },
          },
          orderBy: { date: "desc" },
        });
        const data = rows.map((row) => ({
          id: row.id,
          amount: Number(row.amount),
          date: row.date,
          note: row.remark?.slice(prefix.length).replace(/^\s*-\s*/, "") || "",
          created_at: row.createdAt,
        }));
        return res.json({ status: true, error: false, data });
      }

      case "addMarriageCongratulationsInstallment": {
        const marriageId =
          payload.marriage_congratulations_id ??
          payload.marriageCongratulationsId ??
          payload.id;
        const congrats = await prisma.marriageCongratulations.findFirst({
          where: { id: String(marriageId), deletedAt: null },
        });
        if (!congrats) {
          return res.status(200).json({
            status: false,
            error: true,
            message: "Marriage Congratulations record not found",
          });
        }
        const noteSuffix = payload.note ? ` - ${payload.note}` : "";
        const permanentFeeDate = parseDateInput(payload.date, "date");
        const result = await prisma.payment.create({
          data: {
            date: permanentFeeDate,
            type: "In",
            amount: payload.amount,
            remark: `MARRIAGE_PERMANENT_FEE:${marriageId}${noteSuffix}`,
            addedById,
          },
        });
        await recordLegacyPaymentEntry(prisma, {
          legacyId: result.id,
          date: permanentFeeDate,
          amount: payload.amount,
          name: formatCashFlowName([congrats.codeNumber, congrats.applicantName, congrats.address]),
          source: "marriage_congratulations_emi",
          type: "In",
        });
        return res.json({
          status: true,
          error: false,
          message: "Installment added successfully",
          data: {
            id: result.id,
            amount: Number(result.amount),
            date: result.date,
            note: payload.note || "",
            created_at: result.createdAt,
          },
        });
      }

      case "deleteMarriageCongratulationsPayment": {
        const result = await schemesService.deleteMarriageCongratulationsPayment(payload.id);
        return res.json({ status: true, error: false, message: "Payment deleted successfully", data: result });
      }

      // ── MARRIAGE SEWING MACHINE ──
      case "addMarriageSewing": {
        const result = await schemesService.addMarriageSewingMachine(payload.marriageCongratulationsId, payload, addedById);
        return res.json({ status: true, error: false, message: "Sewing machine application added successfully", data: result });
      }

      case "getMarriageSewing": {
        const result = await prisma.marriageSewingMachine.findMany({
          where: { deletedAt: null },
          include: {
            marriageCongratulations: {
              select: { marriageNumber: true }
            }
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }]
        });
        const mapped = result.map(record => ({
          ...record,
          marriageNumber: record.marriageCongratulations?.marriageNumber || ""
        }));
        return res.json({ status: true, error: false, data: mapped });
      }

      // ── PENSION YOJANA ──
      case "addPensionYojana": {
        const result = await schemesService.createPensionYojana(payload, addedById, user?.role);
        return res.json({
          status: true,
          error: false,
          message: "Pension beneficiary added successfully",
          data: mapPensionYojanaRecord(result as Record<string, any>),
        });
      }

      case "getPensionYojanas": {
        if (payload.id && isValidUuid(payload.id)) {
          const result = await schemesService.getPensionYojanaById(payload.id);
          return res.json({
            status: true,
            error: false,
            data: mapPensionYojanaRecord(result as Record<string, any>),
          });
        }
        const result = await schemesService.getAllPensionYojanas(payload);
        if (result && typeof result === "object" && "data" in result) {
          return res.json({
            status: true,
            error: false,
            data: mapPensionYojanaList((result as any).data),
            pagination: (result as any).meta,
          });
        }
        return res.json({
          status: true,
          error: false,
          data: mapPensionYojanaList(result),
        });
      }

      case "getPensionYojanaPayments": {
        const pension = await schemesService.getPensionYojanaById(payload.pension_yojana_id);
        return res.json({ status: true, error: false, data: pension.payments });
      }

      case "addPensionYojanaPayment": {
        const result = await schemesService.addPensionPayment(payload.pension_yojana_id, payload, addedById);
        return res.json({ status: true, error: false, message: "Payment added successfully", data: result });
      }

      // ── SEWING CAMP ──
      case "addSewingCamp": {
        const result = await schemesService.createSewingMachineCamp(payload, addedById, user?.role);
        return res.json({
          status: true,
          error: false,
          message: "Sewing camp registration added successfully",
          data: mapSewingMachineCampRecord(result as Record<string, any>),
        });
      }

      case "getSewingCamp": {
        if (payload.id && isValidUuid(payload.id)) {
          const result = await schemesService.getSewingMachineCampById(payload.id);
          return res.json({
            status: true,
            error: false,
            data: mapSewingMachineCampRecord(result as Record<string, any>),
          });
        }
        const result = await schemesService.getAllSewingMachineCamps(payload);
        return res.json({
          status: true,
          error: false,
          data: mapSewingMachineCampList(result),
        });
      }

      // ── SURAKSHA BIMA YOJANA ──
      case "addSurakshaBima": {
        const insuranceApplicationId =
          payload.insuranceApplicationId ||
          payload.insuranceApplication_id ||
          payload.insurance_application_id;

        if (!insuranceApplicationId) {
          return res.json({
            status: false,
            error: true,
            message: "insuranceApplication_id is required",
          });
        }

        const result = await appsService.createSurakshaBima(
          String(insuranceApplicationId),
          payload
        );
        return res.json({
          status: true,
          error: false,
          message: "Suraksha Bima added successfully",
          data: result,
        });
      }

      case "getSurakshaBimaList": {
        const f = normalizeListFilters(payload);
        const whereClause: any = {
          deletedAt: null,
          insuranceApplication: { deletedAt: null }
        };
        if (f.gender) {
          whereClause.insuranceApplication = {
            deletedAt: null,
            gender: f.gender
          };
        }
        applyAddressContains(whereClause, f.address);
        applyDateRangeToField(whereClause, "date", f.fromDate, f.toDate);
        if (f.search) {
          whereClause.OR = [
            { applicantName: { contains: f.search, mode: "insensitive" } },
            { bimaNumber: { contains: f.search, mode: "insensitive" } },
            { codeNumber: { contains: f.search, mode: "insensitive" } },
          ];
        }
        const candidates = await prisma.surakshaBimaYojana.findMany({
          where: whereClause,
          select: { id: true, bimaNumber: true, date: true, createdAt: true },
        });
        const { data: result, total } = await paginateByFormNumberSeq(candidates, f.page, f.limit, (ids) =>
          prisma.surakshaBimaYojana.findMany({
            where: { id: { in: ids } },
            include: {
              insuranceApplication: {
                select: { id: true, gender: true, formNumber: true, fatherName: true },
              },
            },
          })
        );
        if (f.page !== undefined && f.limit !== undefined) {
          return res.json({
            status: true,
            error: false,
            data: mapSurakshaBimaList(result),
            pagination: { total, page: f.page, limit: f.limit, totalPages: Math.ceil(total / f.limit) },
          });
        }
        return res.json({
          status: true,
          error: false,
          data: mapSurakshaBimaList(result),
        });
      }

      case "getSurakshaBima": {
        const result = await prisma.surakshaBimaYojana.findFirst({
          where: { id: payload.id, deletedAt: null },
          include: {
            insuranceApplication: {
              select: { id: true, gender: true, formNumber: true, fatherName: true },
            },
          },
        });
        return res.json({
          status: true,
          error: false,
          data: result ? mapSurakshaBimaRecord(result as Record<string, any>) : null,
        });
      }

      case "getSurakshaBimaData": {
        const insuranceAppId =
          payload.insuranceApplication_id ||
          payload.insuranceApplicationId ||
          payload.id;

        if (!insuranceAppId) {
          return res.json({
            status: false,
            error: true,
            message: "insuranceApplication_id is required",
          });
        }

        const appWhere: any = {
          deletedAt: null,
          OR: [{ formNumber: { equals: String(insuranceAppId), mode: "insensitive" } }],
        };
        if (isValidUuid(String(insuranceAppId))) {
          appWhere.OR.push({ id: String(insuranceAppId) });
        }

        const app = await prisma.insuranceApplication.findFirst({
          where: appWhere,
          include: {
            installments: {
              where: { deletedAt: null },
            },
            surakshaBima: true,
          },
        });

        if (!app) {
          return res.json({
            status: false,
            error: true,
            message: "Insurance application not found",
          });
        }

        const targetDate = payload.date
          ? parseOptionalDateInput(payload.date, "date") ?? new Date()
          : new Date();

        const activeMembers = await prisma.insuranceApplication.findMany({
          where: {
            applicationDate: { lte: targetDate },
            deletedAt: null,
            isActive: true,
          },
          select: { id: true },
        });

        const totalCount = activeMembers.length;
        // Exclude BIMA_PAYMENT-tagged installments: those are contributions this
        // member made toward OTHER members' payouts (bulk EMI), not their own EMI.
        const totalEmiPaid = (app.installments || [])
          .filter((inst) => !(inst.note || "").startsWith("BIMA_PAYMENT:"))
          .reduce((sum, inst) => sum + Number(inst.amount || 0), 0);

        const details = {
          id: app.id,
          formNumber: app.formNumber,
          applicantName: app.applicantName,
          fatherName: app.fatherName,
          wifeName: app.wifeName,
          gotra: app.gotra,
          address: app.address,
          applicationDate: app.applicationDate,
          gender: app.gender,
          totalAmount: app.totalAmount,
          pendingAmount: app.pendingAmount,
          category: app.category,
          mobile: app.mobile,
          deductionPercent: "10",
          surakshaBima: app.surakshaBima,
        };

        return res.json({
          status: true,
          error: false,
          data: details,
          totalCount,
          totalEmiPaid,
        });
      }

      case "getInsuranceBulkData": {
        const userId = payload.userId;
        const appOrConditions: any[] = [
          { formNumber: { equals: String(userId), mode: "insensitive" } },
          { applicantName: { contains: String(userId), mode: "insensitive" } },
        ];
        if (isValidUuid(String(userId))) {
          appOrConditions.push({ id: String(userId) });
        }

        const applications = await prisma.insuranceApplication.findMany({
          where: {
            OR: appOrConditions,
            deletedAt: null,
            isActive: true
          }
        });
        if (applications.length === 0) {
          return res.json({ success: false, status: false, message: "No member found" });
        }

        const payer = applications[0];
        // Same eligibility rule as marriage EMI: a member only owes EMI on bima records
        // that were created while they were an active contributor (from their own join
        // date onward), and never on their own bima record.
        const whereClause: any = {
          deletedAt: null,
          date: { gte: payer.applicationDate },
          insuranceApplicationId: { not: payer.id }
        };
        if (payload.fromDate) {
          const requestedFrom = new Date(payload.fromDate);
          if (requestedFrom > payer.applicationDate) {
            whereClause.date.gte = requestedFrom;
          }
        }
        if (payload.toDate) {
          const endOfDay = new Date(payload.toDate);
          endOfDay.setHours(23, 59, 59, 999);
          whereClause.date.lte = endOfDay;
        }
        if (payload.agentId && isValidUuid(payload.agentId)) {
          // SurakshaBimaYojana has no addedById of its own; scope via the
          // insurance application that owns each bima record instead.
          whereClause.insuranceApplication = { addedById: String(payload.agentId) };
        }
         const bimaRecords = await prisma.surakshaBimaYojana.findMany({
          where: whereClause,
          include: {
            insuranceApplication: {
              select: {
                fatherName: true
              }
            }
          },
          orderBy: { date: "desc" }
        });

        const bimaInstallments = await prisma.insuranceApplicationInstallment.findMany({
          where: {
            applicationInsuranceId: payer.id,
            note: { startsWith: "BIMA_PAYMENT:" },
            deletedAt: null
          }
        });
        const paymentByBimaId = new Map(
          bimaInstallments
            .map((inst) => [inst.note?.match(/^BIMA_PAYMENT:([^\s]+)/)?.[1], inst] as const)
            .filter(([bimaId]) => Boolean(bimaId))
        );

        const emiAmount = SURAKSHA_BIMA_EMI_AMOUNT;
        const mappedBimas = bimaRecords.map((bima) => {
          const payment = paymentByBimaId.get(bima.id);
          return {
            id: bima.id,
            bimaNumber: bima.bimaNumber,
            applicantName: bima.applicantName,
            fatherName: bima.fatherName || bima.insuranceApplication?.fatherName || "",
            date: bima.date,
            gender: "Female",
            emiAmount,
            insuranceApplication_id: payer.id,
            payment_status: payment ? 1 : 0,
            filter_payment_status: payment ? 1 : 0,
            filter_row_id: payment?.id || bima.id,
            pdf_created: (payment as any)?.rashidNumber ? 1 : 0,
            rashidNumber: (payment as any)?.rashidNumber || "",
            tehsil: bima.address
          };
        });

        const payerEmiAmount = SURAKSHA_BIMA_EMI_AMOUNT;

        return res.json({
          success: true,
          status: true,
          applications: [{
            id: payer.id,
            formNumber: payer.formNumber,
            applicantName: payer.applicantName,
            fatherName: payer.fatherName,
            gotra: payer.gotra,
            address: payer.address,
            category: payer.category,
            gender: payer.gender,
            mobile: payer.mobile,
            emiAmount: payerEmiAmount
          }],
          bimaEmis: mappedBimas
        });
      }

      case "getAgentPendingBimaEmi": {
        const agentId = payload.agentId;
        if (!agentId || !isValidUuid(agentId)) {
          return res.json({ success: false, status: false, message: "agentId is required" });
        }

        const members = await prisma.insuranceApplication.findMany({
          where: {
            addedById: String(agentId),
            deletedAt: null,
            isActive: true
          }
        });

        if (members.length === 0) {
          return res.json({ success: true, status: true, members: [] });
        }

        const fromDateOverride = payload.fromDate ? new Date(payload.fromDate) : null;
        const toDateOverride = payload.toDate ? new Date(payload.toDate) : null;
        if (toDateOverride) toDateOverride.setHours(23, 59, 59, 999);

        // Find the earliest application date to restrict bima query range
        const minAppDate = members.reduce((min, m) => m.applicationDate < min ? m.applicationDate : min, members[0].applicationDate);
        const bimaLowerBound = fromDateOverride && fromDateOverride > minAppDate ? fromDateOverride : minAppDate;

        const dateFilter: any = { gte: bimaLowerBound };
        if (toDateOverride) {
          dateFilter.lte = toDateOverride;
        }

        // Same batching approach as getAgentPendingEmi (marriage EMI): load
        // every bima record and every BIMA_PAYMENT installment for this
        // agent's members once, then intersect in memory per member instead
        // of a per-member query loop.
        const allBimas = await prisma.surakshaBimaYojana.findMany({
          where: {
            deletedAt: null,
            date: dateFilter
          },
          select: { id: true, date: true, insuranceApplicationId: true }
        });

        const allInstallments = await prisma.insuranceApplicationInstallment.findMany({
          where: {
            applicationInsuranceId: { in: members.map((m) => m.id) },
            note: { in: allBimas.map((b) => `BIMA_PAYMENT:${b.id}`) },
            deletedAt: null
          },
          select: { applicationInsuranceId: true, note: true }
        });
        const paidByApplication = new Map<string, Set<string>>();
        for (const inst of allInstallments) {
          const bimaId = inst.note?.match(/^BIMA_PAYMENT:([^\s]+)/)?.[1];
          if (!bimaId) continue;
          if (!paidByApplication.has(inst.applicationInsuranceId)) {
            paidByApplication.set(inst.applicationInsuranceId, new Set());
          }
          paidByApplication.get(inst.applicationInsuranceId)!.add(bimaId);
        }



        const includePaid = payload.reportType === 'all';

        // Optimize bima lookup: map bimas by insuranceApplicationId
        const bimaByApp = new Map<string, any>();
        for (const b of allBimas) {
          if (b.insuranceApplicationId) {
            bimaByApp.set(b.insuranceApplicationId, b);
          }
        }

        const results: any[] = [];
        for (const payer of members) {
          let lowerBound = payer.applicationDate;
          if (fromDateOverride && fromDateOverride > lowerBound) {
            lowerBound = fromDateOverride;
          }

          let owed: any[] = [];
          // Owe all bimas except their own
          const ownBima = bimaByApp.get(payer.id);
          if (ownBima) {
            owed = allBimas.filter((b) => {
              if (b.insuranceApplicationId === payer.id) return false;
              if (b.date < lowerBound) return false;
              if (toDateOverride && b.date > toDateOverride) return false;
              return true;
            });
          } else {
            owed = allBimas.filter((b) => {
              if (b.date < lowerBound) return false;
              if (toDateOverride && b.date > toDateOverride) return false;
              return true;
            });
          }

          if (owed.length === 0) continue;

          const paidIds = paidByApplication.get(payer.id) ?? new Set<string>();
          const pendingCount = owed.filter((b) => !paidIds.has(b.id)).length;

          const shouldInclude = includePaid ? (owed.length > 0) : (pendingCount > 0);

          if (shouldInclude) {
            results.push({
              id: payer.id,
              createdAt: payer.createdAt,
              formNumber: payer.formNumber,
              applicantName: payer.applicantName,
              fatherName: payer.fatherName,
              gender: payer.gender,
              category: payer.category,
              totalOwed: owed.length,
              pendingCount,
              emiAmount: SURAKSHA_BIMA_EMI_AMOUNT,
              pendingAmount: pendingCount * SURAKSHA_BIMA_EMI_AMOUNT
            });
          }
        }

        return res.json({
          success: true,
          status: true,
          members: results
        });
      }

      case "updateBimaPaymentStatus": {
        const insurance_id = payload.insurance_id ?? payload.insuranceId ?? payload.application_insurance_id;
        const items = Array.isArray(payload.data) ? payload.data : [];
        const orConditions = resolvePayerApplicationWhere(insurance_id);

        if (!orConditions) {
          if (items.length === 0) {
            return res.json({
              status: true,
              error: false,
              updated: 0,
              failed: 0,
              details: [],
              message: "No payment updates requested",
            });
          }
          return res.status(200).json({ error: true, message: "insurance_id is required" });
        }

        const payerApp = await prisma.insuranceApplication.findFirst({
          where: {
            OR: orConditions,
            deletedAt: null
          }
        });
        if (!payerApp) {
          return res.status(200).json({ error: true, message: "Payer application not found" });
        }

        let updated = 0;
        let failed = 0;
        const details = [];

        const defaultAdmin = await prisma.user.findFirst({ select: { id: true } });
        const fallbackUserId = defaultAdmin?.id || "";

        for (const item of items) {
          try {
            if (!isValidUuid(item.id)) {
              details.push({ bimaNumber: "", status: "failed" });
              failed++;
              continue;
            }
            const bima = await prisma.surakshaBimaYojana.findUnique({
              where: { id: item.id }
            });
            if (!bima) {
              details.push({ bimaNumber: "", status: "failed" });
              failed++;
              continue;
            }

            const emiAmount = SURAKSHA_BIMA_EMI_AMOUNT;
            const finalAddedById = isValidUuid(item.addedby_id) ? item.addedby_id : (isValidUuid(addedById) ? addedById : fallbackUserId);
            const bimaPaymentDate = new Date();

            const bimaInstallment = await prisma.insuranceApplicationInstallment.create({
              data: {
                applicationInsuranceId: payerApp.id,
                amount: emiAmount,
                date: bimaPaymentDate,
                note: `BIMA_PAYMENT:${bima.id} - ${bima.bimaNumber}`,
                paymentMode: normalizePaymentMode(payload.payment_mode),
                addedById: finalAddedById
              }
            });

            await recordLegacyPaymentEntry(prisma, {
              legacyId: bimaInstallment.id,
              date: bimaPaymentDate,
              amount: emiAmount,
              name: formatEmiContributionName(
                [payerApp.formNumber, payerApp.applicantName, payerApp.address],
                { name: bima.applicantName, code: bima.bimaNumber, scheme: "Suraksha Bima Yojana" }
              ),
              source: "suraksha_bima_emi",
              type: "In",
            });

            updated++;
            details.push({ bimaNumber: bima.bimaNumber, status: "updated" });
          } catch (err) {
            details.push({ bimaNumber: "", status: "failed" });
            failed++;
          }
        }

        bulkDataCache.clear();

        return res.json({
          status: true,
          error: false,
          bima_updated: updated,
          bima_failed: failed,
          details
        });
      }

      case "updateInsurancePdfStatus": {
        const ids = Array.isArray(payload.ids) ? payload.ids : [];
        if (ids.length === 0) {
          return res.json({ status: true, error: false, message: "No IDs provided" });
        }

        const defaultAdmin = await prisma.user.findFirst({ select: { id: true } });
        const fallbackUserId = defaultAdmin?.id || "";

        let installments = await prisma.insuranceApplicationInstallment.findMany({
          where: {
            OR: [
              { id: { in: ids } },
              ...ids.map((id: string) => ({ note: { startsWith: `BIMA_PAYMENT:${id}` } }))
            ],
            deletedAt: null
          },
          include: {
            application: true
          }
        });

        const existingBimaIds = new Set(
          installments.map(inst => inst.note?.match(/^BIMA_PAYMENT:([^\s]+)/)?.[1]).filter(Boolean)
        );
        const missingBimaIds = ids.filter((id: string) => !existingBimaIds.has(id));

        if (missingBimaIds.length > 0) {
          const bimaRecords = await prisma.surakshaBimaYojana.findMany({
            where: { id: { in: missingBimaIds }, deletedAt: null },
            include: { insuranceApplication: true }
          });

          for (const bima of bimaRecords) {
            const newInst = await prisma.insuranceApplicationInstallment.create({
              data: {
                applicationInsuranceId: bima.insuranceApplicationId,
                amount: SURAKSHA_BIMA_EMI_AMOUNT,
                date: new Date(),
                note: `BIMA_PAYMENT:${bima.id} - ${bima.bimaNumber}`,
                addedById: addedById || bima.insuranceApplication?.addedById || fallbackUserId
              },
              include: {
                application: true
              }
            });
            installments.push(newInst);
          }
        }

        if (installments.length === 0) {
          return res.json({ status: false, error: true, message: "No valid records found to update" });
        }

        const existingRashid = installments.find(i => (i as any).rashidNumber)?.rashidNumber;
        let assignedRashid = existingRashid;

        if (!assignedRashid) {
          const gender = installments[0].application?.gender || "Female";
          const isMale = gender === "Male";
          const prefix = isMale ? "SMR-" : "SFR-";

          const lastPayment = await prisma.insuranceApplicationInstallment.findFirst({
            where: {
              rashidNumber: {
                startsWith: prefix
              }
            },
            orderBy: {
              createdAt: "desc"
            }
          });

          let nextNum = 1001;
          if (lastPayment && lastPayment.rashidNumber) {
            const match = lastPayment.rashidNumber.match(/\d+/);
            if (match) {
              nextNum = parseInt(match[0], 10) + 1;
            }
          }

          assignedRashid = `${prefix}${nextNum}`;

          await prisma.insuranceApplicationInstallment.updateMany({
            where: {
              id: { in: installments.map(i => i.id) }
            },
            data: {
              rashidNumber: assignedRashid
            } as any
          });
        }

        return res.json({
          status: true,
          error: false,
          message: "PDF status updated",
          rashidNumber: assignedRashid
        });
      }

      case "getPreviousSurakshaBimaMembers": {
        const insuranceId = payload.id || payload.application_insurance_id;
        const members = await prisma.insuranceApplication.findMany({
          where: { deletedAt: null, isActive: true },
          select: {
            id: true,
            applicantName: true,
            address: true,
            category: true,
          },
        });
        const payments = await prisma.insuranceApplicationInstallment.findMany({
          where: {
            applicationInsuranceId: insuranceId,
            deletedAt: null,
            note: { startsWith: "BIMA_PAYMENT:" },
          },
          select: { note: true },
        });
        const paidIds = new Set(
          payments
            .map((p) => p.note?.split(":")[1])
            .filter(Boolean)
        );
        const data = members.map((member) => ({
          id: member.id,
          applicantName: member.applicantName,
          address: member.address,
          payment_status: paidIds.has(member.id) ? 1 : 0,
        }));
        return res.json({ status: true, error: false, data });
      }

      case "getSurakshaBimaPaymentById": {
        const insuranceId = payload.application_insurance_id || payload.id;
        const installments = await prisma.insuranceApplicationInstallment.findMany({
          where: {
            applicationInsuranceId: insuranceId,
            deletedAt: null,
            note: { startsWith: "BIMA_PAYMENT:" },
          },
          orderBy: { date: "desc" },
        });

        // The note carries the bima record this payment was recorded
        // against ("BIMA_PAYMENT:{bimaId} - {bimaNumber}") — resolve it
        // back to the member's name for the "Member Name" column.
        const bimaIds = [...new Set(
          installments
            .map((i) => i.note?.match(/^BIMA_PAYMENT:([^\s]+)/)?.[1])
            .filter((id): id is string => Boolean(id) && isValidUuid(id))
        )];
        const bimaRecords = bimaIds.length
          ? await prisma.surakshaBimaYojana.findMany({
              where: { id: { in: bimaIds } },
              select: { id: true, applicantName: true },
            })
          : [];
        const nameByBimaId = new Map(bimaRecords.map((b) => [b.id, b.applicantName]));

        const data = installments.map((i) => {
          const bimaId = i.note?.match(/^BIMA_PAYMENT:([^\s]+)/)?.[1];
          return { ...i, paymentByName: (bimaId && nameByBimaId.get(bimaId)) || null };
        });

        return res.json({ status: true, error: false, data });
      }

      case "createSurakshaBimaPayment": {
        if (!(await hasAgentPermission(user, "suraksha_bima_yojana_payment", "create"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to create Insurance Bima Payment" });
        }
        const payerId = payload.application_insurance_id;
        const payeeId = payload.paymentby_id;
        const bima = await prisma.surakshaBimaYojana.findFirst({
          where: {
            OR: [
              { id: payeeId },
              { insuranceApplicationId: payeeId },
            ],
            deletedAt: null,
          },
        });
        const payerInsuranceApp = await prisma.insuranceApplication.findFirst({
          where: { id: payerId },
          select: { formNumber: true, applicantName: true, address: true },
        });
        const emiAmount = SURAKSHA_BIMA_EMI_AMOUNT;
        const bimaPaymentDate = new Date();
        const result = await prisma.insuranceApplicationInstallment.create({
          data: {
            applicationInsuranceId: payerId,
            amount: emiAmount,
            date: bimaPaymentDate,
            note: `BIMA_PAYMENT:${bima?.id || payeeId} - ${bima?.bimaNumber || payeeId}`,
            paymentMode: "CASH",
            addedById: addedById || payload.addedby_id || user?.userId,
          },
        });
        await recordLegacyPaymentEntry(prisma, {
          legacyId: result.id,
          date: bimaPaymentDate,
          amount: emiAmount,
          name: formatEmiContributionName(
            [payerInsuranceApp?.formNumber, payerInsuranceApp?.applicantName, payerInsuranceApp?.address],
            bima ? { name: bima.applicantName, code: bima.bimaNumber, scheme: "Suraksha Bima Yojana" } : null
          ),
          source: "suraksha_bima_emi",
          type: "In",
        });
        return res.json({ status: true, error: false, message: "Payment recorded successfully", data: result });
      }

      // ── MAYRA REGISTRATION ──
      case "createmayra_Application": {
        if (!(await hasAgentPermission(user, "mayra_registration", "create"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to create Mayra Registration" });
        }
        const result = await mayraService.createMayraRegistration(payload, addedById, user?.role);
        return res.json({
          status: true,
          error: false,
          message: "Mayra registration created successfully",
          data: mapMayraApplicationRecord(result as Record<string, any>),
        });
      }

      case "getmayra_application": {
        if (!(await hasAgentPermission(user, "mayra_registration", "view"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to view Mayra Registration" });
        }
        if (payload.id && isValidUuid(payload.id)) {
          const result = await mayraService.getMayraRegistrationById(payload.id);
          return res.json({
            status: true,
            error: false,
            data: mapMayraApplicationRecord(result as Record<string, any>),
          });
        }
        const result = await mayraService.getAllMayraRegistrations(payload);
        if (result && typeof result === "object" && "data" in result) {
          return res.json({
            status: true,
            error: false,
            data: mapMayraApplicationList((result as any).data),
            pagination: (result as any).meta,
          });
        }
        return res.json({ status: true, error: false, data: mapMayraApplicationList(result) });
      }

      case "updatemayra_Application": {
        if (!(await hasAgentPermission(user, "mayra_registration", "update"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to update Mayra Registration" });
        }
        const result = await mayraService.updateMayraRegistration(payload.id, payload);
        return res.json({
          status: true,
          error: false,
          message: "Mayra registration updated successfully",
          data: mapMayraApplicationRecord(result as Record<string, any>),
        });
      }

      case "deletemayra_Application": {
        if (!(await hasAgentPermission(user, "mayra_registration", "delete"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to delete Mayra Registration" });
        }
        const result = await mayraService.softDeleteMayraRegistration(payload.id);
        return res.json({ status: true, error: false, message: "Mayra registration deleted successfully", data: result });
      }

      case "updateMayraApplicationActiveStatus": {
        const currentStatus = payload.is_active === "1" || payload.is_active === 1;
        const result = await prisma.mayraRegistration.update({
          where: { id: payload.id },
          data: { isActive: currentStatus }
        });
        return res.json({ status: true, error: false, message: "Status updated successfully", data: result });
      }

      // ── MAYRA CONGRATULATIONS ──
      case "addMayraCongrats": {
        if (!(await hasAgentPermission(user, "mayra_congratulations_payment", "create"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to create Mayra Congratulations Payment" });
        }
        const result = await mayraService.createMayraCongratulations(payload.mayra_id || payload.mayraRegistrationId, payload, addedById);
        return res.json({ status: true, error: false, message: "Mayra congratulations created successfully", data: result });
      }

      case "getMayraCongrats": {
        if (!(await hasAgentPermission(user, "mayra_congratulations_payment", "view"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to view Mayra Congratulations Payment" });
        }
        if (payload.id && isValidUuid(payload.id)) {
          const record = await prisma.mayraCongratulations.findFirst({
            where: { id: payload.id, deletedAt: null },
            include: {
              addedBy: { select: { id: true, name: true } },
              mayraRegistration: { select: { id: true, formNumber: true } },
            },
          });
          if (!record) {
            return res.json({ status: false, error: true, message: "Mayra Congratulations record not found" });
          }
          return res.json({
            status: true,
            error: false,
            data: mapMayraCongratulationsRecord(record as Record<string, any>),
          });
        }
        const f = normalizeListFilters(payload);
        const whereClause: any = { deletedAt: null };
        if (f.search) {
          whereClause.OR = [
            { applicantName: { contains: f.search, mode: "insensitive" } },
            { mayraNumber: { contains: f.search, mode: "insensitive" } },
            { codeNumber: { contains: f.search, mode: "insensitive" } },
            { mayraRegistration: { formNumber: { contains: f.search, mode: "insensitive" } } },
          ];
        }
        if (f.gender) {
          whereClause.gender = f.gender;
        }
        applyAddressContains(whereClause, f.address);
        applyDateRangeToField(whereClause, "date", f.fromDate, f.toDate);
        if (f.addedById) {
          whereClause.addedById = f.addedById;
        }
        const candidates = await prisma.mayraCongratulations.findMany({
          where: whereClause,
          select: { id: true, mayraNumber: true, date: true, createdAt: true },
        });
        const { data: result, total } = await paginateByFormNumberSeq(candidates, f.page, f.limit, (ids) =>
          prisma.mayraCongratulations.findMany({
            where: { id: { in: ids } },
            include: {
              addedBy: { select: { id: true, name: true } },
              mayraRegistration: { select: { id: true, formNumber: true } },
            },
          })
        );
        if (f.page !== undefined && f.limit !== undefined) {
          return res.json({
            status: true,
            error: false,
            data: mapMayraCongratulationsList(result),
            pagination: { total, page: f.page, limit: f.limit, totalPages: Math.ceil(total / f.limit) },
          });
        }
        return res.json({ status: true, error: false, data: mapMayraCongratulationsList(result) });
      }

      case "getMayraCongratulations": {
        const mayraId = payload.mayra_id || payload.id;
        let details: any = null;

        const isValid = isValidUuid(mayraId);
        let congrats = null;
        if (isValid) {
          congrats = await prisma.mayraCongratulations.findFirst({
            where: {
              OR: [
                { id: mayraId },
                { mayraRegistrationId: mayraId }
              ],
              deletedAt: null
            },
            include: {
              addedBy: { select: { id: true, name: true } },
              payments: { orderBy: { createdAt: "asc" } }
            }
          });
        }

        if (congrats) {
          details = congrats;
        } else {
          const reg = isValid ? await prisma.mayraRegistration.findUnique({
            where: { id: mayraId }
          }) : null;
          if (reg) {
            details = {
              id: reg.id,
              formNumber: reg.formNumber,
              applicantName: reg.applicantName,
              fatherName: reg.fatherName,
              nomineeName: reg.nomineeName,
              gotra: reg.gotra,
              address: reg.address,
              applicationDate: reg.applicationDate,
              gender: reg.gender,
              joiningFee: reg.joiningFee,
              mayraInstallment: reg.mayraInstallment,
              slabCode: reg.slabCode,
              slabName: reg.slabName,
            };
          }
        }

        if (!details) {
          return res.json({ status: false, error: true, message: "Mayra registration or congratulations record not found" });
        }

        // The frontend keys installment lookups (getMayraInstallments) off
        // `mayra_id`, which is the MayraRegistration id — not the
        // MayraCongratulations row's own id when `congrats` was found.
        details.mayra_id = congrats ? congrats.mayraRegistrationId : mayraId;

        const targetDate = payload.date ? new Date(payload.date) : new Date();

        // Filter by the applicant's gender (same as marriage congratulations):
        // a female applicant's form counts female Mayra members, male counts male.
        const memberGenderRaw = String(details?.gender || "").trim().toLowerCase();
        const memberGender =
          memberGenderRaw === "male"
            ? "Male"
            : memberGenderRaw === "female"
              ? "Female"
              : null;

        // Use groupBy+_count for an efficient single SQL GROUP BY — avoids fetching
        // all rows into JS and prevents connection pool exhaustion.
        const mayraCounts = await prisma.mayraRegistration.groupBy({
          by: ["slabCode"],
          where: {
            applicationDate: { lte: targetDate },
            deletedAt: null,
            isActive: true,
            ...(memberGender ? { gender: memberGender as any } : {}),
          },
          _count: { id: true },
        });

        const countsMap: Record<string, number> = { A: 0, B: 0, C: 0 };
        mayraCounts.forEach(row => {
          const code = (row.slabCode ?? "").toString().toUpperCase();
          const slabLetter = code.split("_").pop() ?? "";
          if (slabLetter === "A") countsMap.A += row._count.id;
          else if (slabLetter === "B") countsMap.B += row._count.id;
          else if (slabLetter === "C") countsMap.C += row._count.id;
        });

        const counts = [
          { category: "A", total: countsMap.A },
          { category: "B", total: countsMap.B },
          { category: "C", total: countsMap.C }
        ];

        const installments = await prisma.mayraInstallment.findMany({
          where: {
            mayraRegistrationId: congrats ? congrats.mayraRegistrationId : mayraId,
            deletedAt: null
          }
        });
        const totalEMI = installments.reduce((sum, inst) => sum + Number(inst.amount), 0);

        return res.json({
          status: true,
          error: false,
          data: details,
          counts,
          totalEMI
        });
      }

      case "updateMayraCongratulationsStatus": {
        if (!(await hasAgentPermission(user, "mayra_congratulations_payment", "update"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to update Mayra Congratulations Payment" });
        }
        const statusVal = parseInt(payload.payment_status);
        const result = await prisma.mayraCongratulations.update({
          where: { id: payload.id },
          data: { paymentStatus: statusVal }
        });
        return res.json({ status: true, error: false, message: "Status updated successfully", data: result });
      }

      // ── MAYRA CONGRATULATIONS PAYMENTS ──
      case "createMayraCongratulationsPayment": {
        if (!(await hasAgentPermission(user, "mayra_congratulations_payment", "create"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to create Mayra Congratulations Payment" });
        }
        const congratsId =
          payload.mayraCongratulationsId ??
          payload.mayra_congratulations_id ??
          payload.congratulations_id;
        if (!congratsId || !isValidUuid(String(congratsId))) {
          return res.status(200).json({
            status: false,
            error: true,
            message: "Mayra Congratulations record not found",
          });
        }
        const normalizedData = {
          amount: payload.amount !== undefined ? Number(payload.amount) : undefined,
          category: payload.category,
          applicationId: isValidUuid(payload.applicationId || payload.application_id)
            ? (payload.applicationId || payload.application_id)
            : null,
        };
        const result = await mayraService.addMayraCongratulationsPayment(
          String(congratsId),
          normalizedData,
          addedById
        );
        return res.json({ status: true, error: false, message: "Payment added successfully", data: result });
      }

      case "getMayraCongratulationsPayment": {
        if (!(await hasAgentPermission(user, "mayra_congratulations_payment", "view"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to view Mayra Congratulations Payment" });
        }
        const mayraId =
          payload.mayra_id ??
          payload.mayraId ??
          payload.mayra_registration_id ??
          payload.id;
        if (!mayraId || !isValidUuid(String(mayraId))) {
          return res.status(200).json({
            status: true,
            error: false,
            data: [],
            message: "Mayra Congratulations record not found",
          });
        }
        try {
          const result = await mayraService.getMayraCongratulationsPayments(String(mayraId));
          return res.json(result);
        } catch (err) {
          if (err instanceof NotFoundError) {
            return res.status(200).json({
              status: true,
              error: false,
              data: [],
              message: err.message,
            });
          }
          throw err;
        }
      }

      case "deleteMayraCongratulationsPayment": {
        if (!(await hasAgentPermission(user, "mayra_congratulations_payment", "delete"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to delete Mayra Congratulations Payment" });
        }
        const result = await mayraService.deleteMayraCongratulationsPayment(payload.id);
        return res.json({ status: true, error: false, message: "Payment deleted successfully", data: result });
      }

      // ── MAYRA INSTALLMENTS ──
      case "addMayraInstallment": {
        if (!(await hasAgentPermission(user, "mayra_general_application_payment", "create"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to create Mayra Application Payment" });
        }
        const result = await mayraService.addMayraInstallment(payload.mayra_id, payload, addedById);
        return res.json({ status: true, error: false, message: "Installment added successfully", data: result });
      }

      case "getMayraInstallments": {
        if (!(await hasAgentPermission(user, "mayra_general_application_payment", "view"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to view Mayra Application Payment" });
        }
        const installmentsMayraId =
          payload.mayra_id ??
          payload.mayraId ??
          payload.mayra_registration_id ??
          payload.id;
        if (!isValidUuid(String(installmentsMayraId))) {
          return res.json({ status: true, error: false, data: [] });
        }
        const result = await prisma.mayraInstallment.findMany({
          where: { mayraRegistrationId: String(installmentsMayraId), deletedAt: null },
          orderBy: { date: "asc" }
        });
        return res.json({ status: true, error: false, data: result });
      }

      case "editMayraCongrats": {
        if (!(await hasAgentPermission(user, "mayra_congratulations_payment", "update"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to update Mayra Congratulations Payment" });
        }
        const result = await prisma.mayraCongratulations.update({
          where: { id: payload.id },
          data: {
            date: parseOptionalDateInput(payload.date, "date"),
            codeNumber: payload.codeNumber,
            mayraNumber: payload.mayraNumber,
            applicantName: payload.applicantName,
            fatherName: payload.fatherName,
            wifeOf: payload.wifeOf || null,
            gotra: payload.gotra,
            address: payload.address,
            membershipJoinDate: parseOptionalDateInput(payload.membershipJoinDate, "membershipJoinDate"),
            associatedUntil: payload.associatedUntil,
            permanentFee: Number(payload.permanentFee || 0),
            installmentAmount: Number(payload.installmentAmount || 0),
            totalGrantAmount: Number(payload.totalGrantAmount || 0),
            totalMembersServing: Number(payload.totalMembersServing || 0),
            rate200: Number(payload.rate200 || 0),
            rate300: Number(payload.rate300 || 0),
            deductionPercent: Number(payload.deductionPercent || 0),
            deductedAmount: Number(payload.deductedAmount || 0),
            totalPaidAmount: Number(payload.totalPaidAmount || 0),
            gender: payload.gender,
          },
        });
        return res.json({ status: true, error: false, message: "Mayra congratulations updated successfully", data: result });
      }

      case "deleteMayraCongrats": {
        if (!(await hasAgentPermission(user, "mayra_congratulations_payment", "delete"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to delete Mayra Congratulations Payment" });
        }
        const result = await softDeleteWithChildren(
          prisma.mayraCongratulations,
          payload.id,
          "Mayra congratulations",
          [{ model: prisma.mayraCongratulationsPayment, fkField: "mayraCongratulationsId" }]
        );
        return res.json({ status: true, error: false, message: "Mayra congratulations deleted successfully", data: result });
      }

      case "updateMayraInstallment": {
        if (!(await hasAgentPermission(user, "mayra_general_application_payment", "update"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to update Mayra Application Payment" });
        }
        const result = await prisma.mayraInstallment.update({
          where: { id: payload.id },
          data: {
            amount: payload.amount !== undefined ? payload.amount : undefined,
            date: parseOptionalDateInput(payload.date, "date"),
            note: payload.note !== undefined ? payload.note : undefined,
          },
        });
        return res.json({ status: true, error: false, message: "Installment updated successfully", data: result });
      }

      case "deleteMayraInstallment": {
        if (!(await hasAgentPermission(user, "mayra_general_application_payment", "delete"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to delete Mayra Application Payment" });
        }
        const result = await softDeleteRecord(
          prisma.mayraInstallment,
          payload.id,
          "Installment"
        );
        return res.json({ status: true, error: false, message: "Installment deleted successfully", data: result });
      }

      case "updateMayraCongratulationsPayment": {
        if (!(await hasAgentPermission(user, "mayra_congratulations_payment", "update"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to update Mayra Congratulations Payment" });
        }
        const result = await prisma.mayraCongratulationsPayment.update({
          where: { id: payload.id },
          data: {
            amount: payload.amount !== undefined ? payload.amount : undefined,
            category: payload.category !== undefined ? payload.category : undefined,
          },
        });
        return res.json({ status: true, error: false, message: "Payment updated successfully", data: result });
      }

      // ── MAYRA OTHER ──
      case "getMayraDetailsByNumber": {
        const result = await prisma.mayraCongratulations.findFirst({
          where: { mayraNumber: payload.mayraNumber, deletedAt: null },
          include: {
            mayraRegistration: {
              include: {
                installments: { orderBy: { date: "asc" } }
              }
            }
          }
        });
        return res.json({ status: true, error: false, data: result });
      }

      case "getMayraBeforeDate": {
        if (!isValidUuid(payload.id)) {
          return res.status(200).json({ error: true, message: "Mayra Registration not found" });
        }
        const reg = await prisma.mayraRegistration.findFirst({
          where: { id: payload.id, deletedAt: null }
        });
        if (!reg) {
          return res.status(200).json({ error: true, message: "Mayra Registration not found" });
        }
        const results = await prisma.mayraRegistration.findMany({
          where: {
            applicationDate: { lte: reg.applicationDate },
            id: { not: reg.id },
            deletedAt: null,
            isActive: true
          },
          orderBy: { applicationDate: "desc" }
        });
        return res.json({ status: true, error: false, data: results });
      }

      case "updateMayraStatus": {
        if (!(await hasAgentPermission(user, "bulk_mayra_emi", "update"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to update Bulk Mayra EMI" });
        }
        const { mayra_id, data: items } = payload;
        const isValidId = isValidUuid(mayra_id);
        const orConditions: any[] = [{ formNumber: String(mayra_id) }];
        if (isValidId) {
          orConditions.push({ id: String(mayra_id) });
        }
        const payerApp = await prisma.generalApplication.findFirst({
          where: {
            OR: orConditions,
            deletedAt: null
          }
        });
        if (!payerApp) {
          return res.status(200).json({ error: true, message: "Payer application not found" });
        }

        let updated = 0;
        const details = [];

        const defaultAdmin = await prisma.user.findFirst({ select: { id: true } });
        const fallbackUserId = defaultAdmin?.id || "";

        for (const item of items) {
          try {
            if (!isValidUuid(item.id)) {
              details.push({ mayraNumber: "", status: "failed" });
              continue;
            }
            const congrats = await prisma.mayraCongratulations.findFirst({
              where: { id: item.id, deletedAt: null }
            });
            if (!congrats) {
              details.push({ mayraNumber: "", status: "failed" });
              continue;
            }

            const emiAmount = MAYRA_CATEGORY_EMI_AMOUNTS[payerApp.category] ?? 0;
            const finalAddedById = isValidUuid(item.addedby_id) ? item.addedby_id : (isValidUuid(addedById) ? addedById : fallbackUserId);

            const existingPayment = await prisma.mayraCongratulationsPayment.findFirst({
              where: {
                mayraCongratulationsId: congrats.id,
                applicationId: payerApp.id,
                deletedAt: null
              }
            });

            if (existingPayment) {
              await prisma.mayraCongratulationsPayment.update({
                where: { id: existingPayment.id },
                data: {
                  amount: emiAmount,
                  category: payerApp.category,
                  addedById: finalAddedById,
                  createdAt: new Date(),
                  updatedAt: new Date()
                }
              });
            } else {
              await prisma.mayraCongratulationsPayment.create({
                data: {
                  mayraCongratulationsId: congrats.id,
                  applicationId: payerApp.id,
                  category: payerApp.category,
                  amount: emiAmount,
                  addedById: finalAddedById,
                  createdAt: new Date()
                }
              });
            }

            await recordLegacyPaymentEntry(prisma, {
              legacyId: congrats.id,
              date: new Date(),
              amount: emiAmount,
              name: formatEmiContributionName(
                [payerApp.formNumber, payerApp.applicantName, payerApp.address],
                { name: congrats.applicantName, code: congrats.codeNumber, scheme: "Mayra congratulations" }
              ),
              source: "mayra_congratulations_emi",
              type: "In",
            });

            updated++;
            details.push({ mayraNumber: congrats.mayraNumber, status: "updated" });
          } catch (err) {
            details.push({ mayraNumber: "", status: "failed" });
          }
        }

        bulkDataCache.clear();

        return res.json({
          status: true,
          error: false,
          mayras_updated: updated,
          mayras_failed: items.length - updated,
          details
        });
      }

      case "getMayraPreviousMembers": {
        const result = await mayraService.getMayraCongratulationsMembers(payload.id);
        return res.json(result);
      }

      case "getMayraBulkData": {
        if (!(await hasAgentPermission(user, "bulk_mayra_emi", "view"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to view Bulk Mayra EMI" });
        }
        const userId = payload.userId;
        const isValidId = isValidUuid(userId);
        const orConditions: any[] = [
          { formNumber: { equals: String(userId), mode: "insensitive" } },
          { applicantName: { contains: String(userId), mode: "insensitive" } }
        ];
        if (isValidId) {
          orConditions.push({ id: String(userId) });
        }
        const applications = await prisma.generalApplication.findMany({
          where: {
            OR: orConditions,
            deletedAt: null,
            isActive: true
          }
        });
        if (applications.length === 0) {
          return res.json({ success: false, status: false, message: "No member found" });
        }

        const payer = applications[0];
        const congratsWhere: any = { deletedAt: null, gender: payer.gender };
        if (payload.fromDate || payload.toDate) {
          congratsWhere.date = {};
          if (payload.fromDate) {
            congratsWhere.date.gte = new Date(payload.fromDate);
          }
          if (payload.toDate) {
            const endOfDay = new Date(payload.toDate);
            endOfDay.setHours(23, 59, 59, 999);
            congratsWhere.date.lte = endOfDay;
          }
        }
        if (payload.agentId && isValidUuid(payload.agentId)) {
          congratsWhere.addedById = String(payload.agentId);
        }

        const congratsRecords = await prisma.mayraCongratulations.findMany({
          where: congratsWhere,
          orderBy: { date: "desc" }
        });

        const emiAmount = MAYRA_CATEGORY_EMI_AMOUNTS[payer.category] ?? 0;

        const mayraPayments = await prisma.mayraCongratulationsPayment.findMany({
          where: {
            mayraCongratulationsId: { in: congratsRecords.map((c) => c.id) },
            applicationId: payer.id,
            deletedAt: null
          }
        });
        const mayraPaymentByCongratsId = new Map(mayraPayments.map((p) => [p.mayraCongratulationsId, p]));

        const mappedMayras = congratsRecords.map((congrats) => {
          const payment = mayraPaymentByCongratsId.get(congrats.id);
          return {
            id: congrats.id,
            mayraNumber: congrats.mayraNumber,
            applicantName: congrats.applicantName,
            fatherName: congrats.fatherName,
            date: congrats.date,
            emiAmount,
            payment_status: payment ? 1 : 0,
            filter_payment_status: payment ? 1 : 0,
            filter_row_id: payment?.id || congrats.id,
            pdf_created: (payment as any)?.rashidNumber ? 1 : 0,
            rashidNumber: (payment as any)?.rashidNumber || "",
            tehsil: congrats.address
          };
        });

        const payerEmiAmount = emiAmount;

        return res.json({
          success: true,
          status: true,
          mayra_application: [{
            id: payer.id,
            formNumber: payer.formNumber,
            applicantName: payer.applicantName,
            fatherName: payer.fatherName,
            gotra: payer.gotra,
            address: payer.address,
            category: payer.category,
            gender: payer.gender,
            mobile: payer.mobile,
            emiAmount: payerEmiAmount
          }],
          mayras: mappedMayras
        });
      }

      case "getMayraUserData": {
        return res.json({ status: true, error: false, data: [] });
      }

      case "getMayraAgentPendingEmi": {
        if (!(await hasAgentPermission(user, "bulk_mayra_emi", "view"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to view Bulk Mayra EMI" });
        }
        const agentId = payload.agentId;
        if (!agentId || !isValidUuid(agentId)) {
          return res.json({ success: false, status: false, message: "agentId is required" });
        }

        const members = await prisma.generalApplication.findMany({
          where: {
            addedById: String(agentId),
            deletedAt: null,
            isActive: true
          }
        });

        if (members.length === 0) {
          return res.json({ success: true, status: true, members: [] });
        }

        // Same batched approach as getAgentPendingEmi (marriage EMI): load
        // every congrats record and every payment made by this agent's
        // members once, then intersect in memory per member.
        const fromDateOverride = payload.fromDate ? new Date(payload.fromDate) : null;
        const toDateOverride = payload.toDate ? new Date(payload.toDate) : null;
        if (toDateOverride) toDateOverride.setHours(23, 59, 59, 999);

        // Find the earliest application date to restrict congrats query range
        const minAppDate = members.reduce((min, m) => m.applicationDate < min ? m.applicationDate : min, members[0].applicationDate);
        const congratsLowerBound = fromDateOverride && fromDateOverride > minAppDate ? fromDateOverride : minAppDate;

        const congratsWhere: any = {
          deletedAt: null,
          date: { gte: congratsLowerBound }
        };
        if (toDateOverride) {
          congratsWhere.date.lte = toDateOverride;
        }

        const allCongrats = await prisma.mayraCongratulations.findMany({
          where: congratsWhere,
          orderBy: { date: "desc" },
          select: { id: true, gender: true, date: true, mayraNumber: true, applicantName: true, fatherName: true, address: true }
        });

        const allPayments = await prisma.mayraCongratulationsPayment.findMany({
          where: {
            applicationId: { in: members.map((m) => m.id) },
            mayraCongratulationsId: { in: allCongrats.map((c) => c.id) },
            deletedAt: null
          },
          select: { applicationId: true, mayraCongratulationsId: true }
        });
        const paidByApplication = new Map<string, Set<string>>();
        for (const p of allPayments) {
          if (!p.applicationId) continue;
          if (!paidByApplication.has(p.applicationId)) {
            paidByApplication.set(p.applicationId, new Set());
          }
          paidByApplication.get(p.applicationId)!.add(p.mayraCongratulationsId);
        }

        const includePaid = payload.reportType === 'all';

        // Optimize congrats lookup: group by gender
        const congratsByGender = new Map<string, any[]>();
        for (const c of allCongrats) {
          if (!congratsByGender.has(c.gender)) {
            congratsByGender.set(c.gender, []);
          }
          congratsByGender.get(c.gender)!.push(c);
        }

        const results: any[] = [];
        for (const payer of members) {
          const owed = congratsByGender.get(payer.gender) ?? [];
          if (owed.length === 0) continue;

          const paidIds = paidByApplication.get(payer.id) ?? new Set<string>();
          const pendingEvents = owed.filter((c) => !paidIds.has(c.id));
          const pendingCount = pendingEvents.length;

          const shouldInclude = includePaid ? (owed.length > 0) : (pendingCount > 0);

          if (shouldInclude) {
            const emiAmount = MAYRA_CATEGORY_EMI_AMOUNTS[payer.category] ?? 0;
            const eventsToShow = includePaid ? owed : pendingEvents;
            results.push({
              id: payer.id,
              createdAt: payer.createdAt,
              formNumber: payer.formNumber,
              applicantName: payer.applicantName,
              fatherName: payer.fatherName,
              gotra: payer.gotra,
              address: payer.address,
              gender: payer.gender,
              category: payer.category,
              totalOwed: owed.length,
              pendingCount,
              emiAmount,
              pendingAmount: pendingCount * emiAmount,
              pendingMayras: eventsToShow.map((c) => {
                const isPaid = paidIds.has(c.id);
                return {
                  id: c.id,
                  mayraNumber: isPaid ? `${c.mayraNumber} (Paid)` : `${c.mayraNumber} (Pending)`,
                  applicantName: c.applicantName,
                  fatherName: c.fatherName,
                  date: c.date,
                  village: c.address
                };
              })
            });
          }
        }

        return res.json({
          success: true,
          status: true,
          members: results
        });
      }

      case "updateMayraPdfStatus": {
        if (!(await hasAgentPermission(user, "bulk_mayra_emi", "update"))) {
          return res.status(200).json({ status: false, error: true, message: "Access Denied: You do not have permission to update Bulk Mayra EMI" });
        }
        
        const ids = Array.isArray(payload.ids) ? payload.ids : [];
        if (ids.length === 0) {
          return res.json({ status: true, error: false, message: "No IDs provided" });
        }

        let payments = await prisma.mayraCongratulationsPayment.findMany({
          where: {
            OR: [
              { id: { in: ids } },
              { mayraCongratulationsId: { in: ids } }
            ],
            deletedAt: null
          },
          include: {
            mayraCongratulations: true
          }
        });

        const existingCongratsIds = new Set(payments.map(p => p.mayraCongratulationsId));
        const missingCongratsIds = ids.filter((id: string) => !existingCongratsIds.has(id));

        if (missingCongratsIds.length > 0) {
          const congratsRecords = await prisma.mayraCongratulations.findMany({
            where: { id: { in: missingCongratsIds }, deletedAt: null }
          });

          for (const congrats of congratsRecords) {
            const orConditions: any[] = [
              { gotra: congrats.gotra, gender: congrats.gender, deletedAt: null }
            ];
            const payerApp = await prisma.generalApplication.findFirst({
              where: { OR: orConditions }
            });
            
            const emiAmount = payerApp ? (MAYRA_CATEGORY_EMI_AMOUNTS[payerApp.category] ?? 300) : 300;
            const category = payerApp ? payerApp.category : "A";
            const appId = payerApp ? payerApp.id : congrats.id;

            const newPayment = await prisma.mayraCongratulationsPayment.create({
              data: {
                mayraCongratulationsId: congrats.id,
                applicationId: appId,
                category: category,
                amount: emiAmount,
                addedById: addedById || congrats.addedById
              },
              include: {
                mayraCongratulations: true
              }
            });
            payments.push(newPayment);
          }
        }

        if (payments.length === 0) {
          return res.json({ status: false, error: true, message: "No valid records found to update" });
        }

        const existingRashid = payments.find(p => (p as any).rashidNumber)?.rashidNumber;
        let assignedRashid = existingRashid;

        if (!assignedRashid) {
          const gender = payments[0].mayraCongratulations?.gender || "Female";
          const isMale = gender === "Male";
          const prefix = isMale ? "MMR-" : "MFR-";

          const lastPayment = await prisma.mayraCongratulationsPayment.findFirst({
            where: {
              rashidNumber: {
                startsWith: prefix
              }
            },
            orderBy: {
              createdAt: "desc"
            }
          });

          let nextNum = 1001;
          if (lastPayment && lastPayment.rashidNumber) {
            const match = lastPayment.rashidNumber.match(/\d+/);
            if (match) {
              nextNum = parseInt(match[0], 10) + 1;
            }
          }

          assignedRashid = `${prefix}${nextNum}`;

          await prisma.mayraCongratulationsPayment.updateMany({
            where: {
              id: { in: payments.map(p => p.id) }
            },
            data: {
              rashidNumber: assignedRashid
            } as any
          });
        }

        return res.json({
          status: true,
          error: false,
          message: "PDF status updated",
          rashidNumber: assignedRashid
        });
      }

      // ── GENERAL CASH BOOK (CASH FLOW) ──
      case "addPayment": {
        const result = await paymentsService.createPayment(payload, addedById);
        return res.json({ status: true, error: false, message: "Payment entry added", data: result });
      }

      case "getPaymentList": {
        // Live unified cash-flow ledger across every source (manual entries +
        // collections/expenses from all modules). The `legacy_payment_entries`
        // mirror this used to read from was a one-time snapshot of the old
        // panel's own `getPaymentList`, which itself only ever lists
        // marriage_congratulations_emi / application_insurance_installment rows
        // (its own totals are computed separately from a broader query) — so it
        // could never show manual payments, loan/pension/financial-help
        // expenses, or agent payouts. PaymentsService.getUnifiedPaymentList
        // queries the real tables directly instead.
        const result = await paymentsService.getUnifiedPaymentList(payload);

        return res.json({
          status: true,
          error: false,
          message: "Fetched successfully",
          totalIncome: result.totalIncome,
          totalExpenses: result.totalExpenses,
          netBalance: result.netBalance,
          pagination: result.pagination,
          data: result.data,
        });
      }

      case "editPayment": {
        const result = await prisma.payment.update({
          where: { id: payload.id },
          data: {
            date: parseOptionalDateInput(payload.date, "date"),
            type: payload.type,
            amount: payload.amount,
            remark: payload.remark,
          }
        });
        return res.json({ status: true, error: false, message: "Payment updated successfully", data: result });
      }

      case "deletePayment": {
        const result = await softDeleteRecord(prisma.payment, payload.id, "Payment");
        return res.json({ status: true, error: false, message: "Payment deleted successfully", data: result });
      }

      // ── GENERAL APPLICATION INSTALLMENTS ──
      case "getApplicationInstallments": {
        const result = await prisma.generalApplicationInstallment.findMany({
          where: { applicationId: payload.application_id, deletedAt: null },
          orderBy: { date: "asc" }
        });
        return res.json({ status: true, error: false, data: result });
      }

      case "addApplicationInstallment": {
        const result = await appsService.addGeneralInstallment(payload.application_id, payload, addedById);
        return res.json({ status: true, error: false, message: "Installment added successfully", data: result });
      }

      // ── AGENT COMMISSION ──
      case "getAgentPaymentsForDetails": {
        const result = await paymentsService.getAgentPaymentsForDetails(payload.agentId);
        return res.json({
          success: true,
          status: true,
          error: false,
          payments: result.payments,
        });
      }

      // ── BULK MARRIAGE EMI PAYMENTS ──
      case "getUserData": {
        const userId = payload.userId;
        const isValidId = isValidUuid(userId);
        const orConditions: any[] = [
          { formNumber: { equals: String(userId), mode: "insensitive" } },
          { applicantName: { contains: String(userId), mode: "insensitive" } }
        ];
        if (isValidId) {
          orConditions.push({ id: String(userId) });
        }
        const applications = await prisma.generalApplication.findMany({
          where: {
            OR: orConditions,
            deletedAt: null,
            isActive: true
          }
        });
        if (applications.length === 0) {
          return res.json({ success: false, status: false, message: "No member found" });
        }

        const payer = applications[0];
        // A member only owes EMI on weddings that happened while they were an active
        // contributor: from their own join date onward, until (if ever) their own
        // marriage congratulations record retires them. Weddings that happened before
        // they joined are not their obligation, regardless of gender match.
        const congratsWhere: any = {
          deletedAt: null,
          gender: payer.gender,
          date: { gte: payer.applicationDate }
        };
        if (payload.fromDate) {
          const requestedFrom = new Date(payload.fromDate);
          if (requestedFrom > payer.applicationDate) {
            congratsWhere.date.gte = requestedFrom;
          }
        }
        if (payload.toDate) {
          const endOfDay = new Date(payload.toDate);
          endOfDay.setHours(23, 59, 59, 999);
          congratsWhere.date.lte = endOfDay;
        }
        if (payload.agentId && isValidUuid(payload.agentId)) {
          congratsWhere.addedById = String(payload.agentId);
        }

        const congratsRecords = await prisma.marriageCongratulations.findMany({
          where: congratsWhere,
          orderBy: [{ date: "desc" }, { createdAt: "desc" }]
        });

        const emiAmount = MARRIAGE_CATEGORY_EMI_AMOUNTS[payer.category] ?? 0;

        const payments = await prisma.marriageCongratulationsPayment.findMany({
          where: {
            marriageCongratulationsId: { in: congratsRecords.map((c) => c.id) },
            applicationId: payer.id,
            deletedAt: null
          }
        });
        const paymentByCongratsId = new Map(payments.map((p) => [p.marriageCongratulationsId, p]));

        const mappedMarriages = congratsRecords.map((congrats) => {
          const payment = paymentByCongratsId.get(congrats.id);
          return {
            id: congrats.id,
            marriageNumber: congrats.marriageNumber,
            applicantName: congrats.applicantName,
            fatherName: congrats.fatherName,
            date: congrats.date,
            gender: congrats.gender,
            village: congrats.address,
            tehsil: congrats.address,
            emiAmount,
            payment_status: payment ? 1 : 0,
            filter_payment_status: payment ? 1 : 0,
            filter_row_id: payment?.id || congrats.id,
            pdf_created: (payment as any)?.rashidNumber ? 1 : 0,
            rashidNumber: (payment as any)?.rashidNumber || ""
          };
        });

        const payerEmiAmount = emiAmount;

        return res.json({
          success: true,
          status: true,
          applications: [{
            id: payer.id,
            formNumber: payer.formNumber,
            applicantName: payer.applicantName,
            fatherName: payer.fatherName,
            gotra: payer.gotra,
            address: payer.address,
            category: payer.category,
            gender: payer.gender,
            mobile: payer.mobile,
            emiAmount: payerEmiAmount
          }],
          marriages: mappedMarriages
        });
      }

      case "getAgentPendingEmi": {
        const agentId = payload.agentId;
        if (!agentId || !isValidUuid(agentId)) {
          return res.json({ success: false, status: false, message: "agentId is required" });
        }

        const members = await prisma.generalApplication.findMany({
          where: {
            addedById: String(agentId),
            deletedAt: null,
            isActive: true
          },
          select: {
            id: true, formNumber: true, applicantName: true, fatherName: true,
            gotra: true, address: true, gender: true, category: true,
            applicationDate: true, mobile: true
          }
        });

        if (members.length === 0) {
          return res.json({ success: true, status: true, members: [] });
        }

        const fromDateOverride = payload.fromDate ? new Date(payload.fromDate) : null;
        const toDateOverride = payload.toDate ? new Date(payload.toDate) : null;
        if (toDateOverride) toDateOverride.setHours(23, 59, 59, 999);

        const includePaid = payload.reportType === 'all';

        // Lower bound for congrats = max(earliest member application date, fromDate override)
        const minAppDate = members.reduce((min, m) => m.applicationDate < min ? m.applicationDate : min, members[0].applicationDate);
        const congratsLowerBound = fromDateOverride && fromDateOverride > minAppDate ? fromDateOverride : minAppDate;

        // QUERY 1: All marriage congratulations in the date range (fast: indexed by date)
        const allCongrats = await prisma.marriageCongratulations.findMany({
          where: {
            deletedAt: null,
            date: {
              gte: congratsLowerBound,
              ...(toDateOverride ? { lte: toDateOverride } : {})
            }
          },
          select: { id: true, gender: true, date: true, marriageNumber: true, applicantName: true, fatherName: true, address: true },
          orderBy: { date: "desc" }
        });

        if (allCongrats.length === 0) {
          return res.json({ success: true, status: true, members: [] });
        }

        const congratsIds: string[] = allCongrats.map((c) => c.id);
        const memberIds: string[] = members.map((m) => m.id);

        // QUERY 2: Aggregate paid IDs per member at the DB level → returns 272 rows instead of 18,009
        // COUNT(*) showed DB executes in <1s; the bottleneck was network transfer of 18,009 rows.
        // array_agg reduces result to 1 row per member, dramatically reducing data transferred.
        type AggPaidRow = { application_id: string; paid_ids: string[]; };
        const aggPaidRows: AggPaidRow[] = await prisma.$queryRaw`
          SELECT application_id, array_agg(marriage_congratulations_id) AS paid_ids
          FROM marriage_congratulations_payments
          WHERE application_id = ANY(${memberIds}::uuid[])
            AND marriage_congratulations_id = ANY(${congratsIds}::uuid[])
            AND deleted_at IS NULL
          GROUP BY application_id
        `;

        // Build paid set: memberId → Set<congratsId>
        const paidByMember = new Map<string, Set<string>>();
        for (const row of aggPaidRows) {
          if (!row.application_id || !row.paid_ids) continue;
          paidByMember.set(row.application_id, new Set(row.paid_ids));
        }

        // Pre-group congrats by gender for fast per-member lookup
        const congratsByGender = new Map<string, typeof allCongrats>();
        for (const c of allCongrats) {
          if (!congratsByGender.has(c.gender)) congratsByGender.set(c.gender, []);
          congratsByGender.get(c.gender)!.push(c);
        }

        // MEMORY: compute per-member owed/pending (all date filtering here, no DB round-trips)
        const results: any[] = [];
        for (const payer of members) {
          let lowerBound = payer.applicationDate;
          if (fromDateOverride && fromDateOverride > lowerBound) lowerBound = fromDateOverride;

          const candidates = congratsByGender.get(payer.gender) ?? [];
          const owed = candidates.filter((c) => {
            if (c.date < lowerBound) return false;
            if (toDateOverride && c.date > toDateOverride) return false;
            return true;
          });
          if (owed.length === 0) continue;

          const paidIds = paidByMember.get(payer.id) ?? new Set<string>();
          const pendingEvents = owed.filter((c) => !paidIds.has(c.id));
          const pendingCount = pendingEvents.length;

          const shouldInclude = includePaid ? (owed.length > 0) : (pendingCount > 0);
          if (!shouldInclude) continue;

          const emiAmount = MARRIAGE_CATEGORY_EMI_AMOUNTS[payer.category] ?? 0;
          results.push({
            id: payer.id,
            formNumber: payer.formNumber,
            applicantName: payer.applicantName,
            fatherName: payer.fatherName,
            gotra: payer.gotra,
            address: payer.address,
            gender: payer.gender,
            category: payer.category,
            totalOwed: owed.length,
            pendingCount,
            emiAmount,
            pendingAmount: pendingCount * emiAmount,
            pendingMarriages: pendingEvents.map((c) => ({
              id: c.id,
              marriageNumber: c.marriageNumber,
              applicantName: c.applicantName,
              fatherName: c.fatherName,
              date: c.date,
              village: c.address
            }))
          });
        }

        return res.json({
          success: true,
          status: true,
          members: results
        });
      }

      case "generateBulkAgentPendingEmiPdf": {
        const agentId = payload.agentId;
        if (!agentId) {
          return res.status(400).json({ error: true, message: "agentId is required" });
        }

        const isAllAgents = agentId === "all";
        if (!isAllAgents && !isValidUuid(agentId)) {
          return res.status(400).json({ error: true, message: "agentId must be a valid UUID or 'all'" });
        }

        const isSuraksha = payload.scheme === 'suraksha_bima';

        const members = isSuraksha
          ? await prisma.insuranceApplication.findMany({
              where: {
                ...(isAllAgents ? {} : { addedById: String(agentId) }),
                deletedAt: null,
                isActive: true
              }
            })
          : await prisma.generalApplication.findMany({
              where: {
                ...(isAllAgents ? {} : { addedById: String(agentId) }),
                deletedAt: null,
                isActive: true
              }
            });

        if (members.length === 0) {
          return res.status(400).json({ error: true, message: "No members found for this agent" });
        }

        const fromDateOverride = payload.fromDate ? new Date(payload.fromDate) : null;
        const toDateOverride = payload.toDate ? new Date(payload.toDate) : null;
        if (toDateOverride) toDateOverride.setHours(23, 59, 59, 999);

        // Find the earliest application date to restrict the congrats query range
        const minAppDate = members.reduce((min, m) => m.applicationDate < min ? m.applicationDate : min, members[0].applicationDate);
        const congratsLowerBound = fromDateOverride ?? minAppDate;

        const allCongrats = isSuraksha
          ? await prisma.surakshaBimaYojana.findMany({
              where: {
                deletedAt: null,
                date: { gte: congratsLowerBound }
              },
              orderBy: { date: "desc" },
              select: { id: true, date: true, bimaNumber: true, applicantName: true, fatherName: true, address: true, insuranceApplicationId: true }
            })
          : await prisma.marriageCongratulations.findMany({
              where: {
                deletedAt: null,
                date: { gte: congratsLowerBound }
              },
              orderBy: { date: "desc" },
              select: { id: true, gender: true, date: true, marriageNumber: true, applicantName: true, fatherName: true, address: true }
            });

        const allPayments = isSuraksha
          ? await prisma.insuranceApplicationInstallment.findMany({
              where: isAllAgents
                ? {
                    note: { startsWith: "BIMA_PAYMENT:" },
                    deletedAt: null
                  }
                : {
                    applicationInsuranceId: { in: members.map((m) => m.id) },
                    note: { startsWith: "BIMA_PAYMENT:" },
                    deletedAt: null
                  },
              select: { applicationInsuranceId: true, note: true }
            })
          : await prisma.marriageCongratulationsPayment.findMany({
              where: isAllAgents
                ? { deletedAt: null }
                : {
                    applicationId: { in: members.map((m) => m.id) },
                    deletedAt: null
                  },
              select: { applicationId: true, marriageCongratulationsId: true }
            });

        const paidByApplication = new Map<string, Set<string>>();
        for (const p of allPayments) {
          if (isSuraksha) {
            const inst = p as any;
            const bimaId = inst.note?.match(/^BIMA_PAYMENT:([^\s]+)/)?.[1];
            if (!bimaId) continue;
            if (!paidByApplication.has(inst.applicationInsuranceId)) {
              paidByApplication.set(inst.applicationInsuranceId, new Set());
            }
            paidByApplication.get(inst.applicationInsuranceId)!.add(bimaId);
          } else {
            const pm = p as any;
            if (!pm.applicationId) continue;
            if (!paidByApplication.has(pm.applicationId)) {
              paidByApplication.set(pm.applicationId, new Set());
            }
            paidByApplication.get(pm.applicationId)!.add(pm.marriageCongratulationsId);
          }
        }

        // Optimize congrats lookup: group congrats in maps to avoid nested full scans
        const congratsByApp = new Map<string, any>();
        const congratsByGender = new Map<string, any[]>();
        for (const c of allCongrats) {
          if (isSuraksha) {
            const appId = (c as any).insuranceApplicationId;
            if (appId) {
              congratsByApp.set(appId, c);
            }
          } else {
            const cAny = c as any;
            if (!congratsByGender.has(cAny.gender)) {
              congratsByGender.set(cAny.gender, []);
            }
            congratsByGender.get(cAny.gender)!.push(c);
          }
        }

        const results: any[] = [];
        for (const payer of members) {
          let lowerBound = payer.applicationDate;
          if (fromDateOverride && fromDateOverride > lowerBound) {
            lowerBound = fromDateOverride;
          }

          let owed: any[] = [];
          if (isSuraksha) {
            const c = congratsByApp.get(payer.id);
            if (c) {
              // Suraksha Bima Yojana is owed to EVERYONE *except* the one who created it (is that correct?)
              // Wait, let's look at the original filter logic:
              // `if ((c as any).insuranceApplicationId === payer.id) return false;`
              // So they owe all congrats *except* their own.
              // Let's filter allCongrats but skip their own:
              // Since we only skip their own, we can copy allCongrats and skip the matching one!
              // Since copying is fast and skipping is just one check, let's optimize it:
              owed = allCongrats.filter((c) => {
                if ((c as any).insuranceApplicationId === payer.id) return false;
                if (c.date < lowerBound) return false;
                if (toDateOverride && c.date > toDateOverride) return false;
                return true;
              });
            } else {
              owed = allCongrats.filter((c) => {
                if (c.date < lowerBound) return false;
                if (toDateOverride && c.date > toDateOverride) return false;
                return true;
              });
            }
          } else {
            // Marriage Congrats: only match their gender
            const candidates = congratsByGender.get(payer.gender) ?? [];
            owed = candidates.filter((c) => {
              if (c.date < lowerBound) return false;
              if (toDateOverride && c.date > toDateOverride) return false;
              return true;
            });
          }

          if (owed.length === 0) continue;

          const paidIds = paidByApplication.get(payer.id) ?? new Set<string>();
          const pendingEvents = owed.filter((c) => !paidIds.has(c.id));
          const pendingCount = pendingEvents.length;

          if (pendingCount > 0) {
            const emiAmount = isSuraksha ? 200 : (MARRIAGE_CATEGORY_EMI_AMOUNTS[payer.category] ?? 0);
            results.push({
              id: payer.id,
              formNumber: payer.formNumber,
              applicantName: payer.applicantName,
              fatherName: payer.fatherName,
              gotra: payer.gotra,
              address: payer.address,
              gender: payer.gender,
              category: payer.category,
              totalOwed: owed.length,
              pendingCount,
              emiAmount,
              pendingAmount: pendingCount * emiAmount,
              mobile: payer.mobile || '',
              rashidNumber: '',
              pendingMarriages: pendingEvents.map((c) => ({
                id: c.id,
                marriageNumber: isSuraksha ? (c as any).bimaNumber : (c as any).marriageNumber,
                applicantName: c.applicantName,
                fatherName: c.fatherName,
                date: c.date,
                village: c.address
              }))
            });
          }
        }

        const genderFilter = payload.gender;
        const filteredResults = results.filter(
          (member) => !genderFilter || genderFilter === "all" || member.gender === genderFilter
        );

        if (filteredResults.length === 0) {
          return res.status(400).json({ error: true, message: "No pending records found with matching criteria" });
        }

        const lastFRPayment = isSuraksha
          ? await prisma.insuranceApplicationInstallment.findFirst({
              where: { rashidNumber: { startsWith: 'SFR-' } },
              orderBy: { createdAt: "desc" }
            })
          : await prisma.marriageCongratulationsPayment.findFirst({
              where: { rashidNumber: { startsWith: 'FR-' } },
              orderBy: { createdAt: "desc" }
            });
        const lastMRPayment = isSuraksha
          ? await prisma.insuranceApplicationInstallment.findFirst({
              where: { rashidNumber: { startsWith: 'SMR-' } },
              orderBy: { createdAt: "desc" }
            })
          : await prisma.marriageCongratulationsPayment.findFirst({
              where: { rashidNumber: { startsWith: 'MR-' } },
              orderBy: { createdAt: "desc" }
            });

        let nextFRNum = 1001;
        if (lastFRPayment && lastFRPayment.rashidNumber) {
          const match = lastFRPayment.rashidNumber.match(/\d+/);
          if (match) nextFRNum = parseInt(match[0], 10) + 1;
        }

        let nextMRNum = 1001;
        if (lastMRPayment && lastMRPayment.rashidNumber) {
          const match = lastMRPayment.rashidNumber.match(/\d+/);
          if (match) nextMRNum = parseInt(match[0], 10) + 1;
        }

        // Allocate rashidNumber sequentially in memory for each pending member page
        for (const payer of filteredResults) {
          const cleanGender = String(payer.gender).trim().toLowerCase();
          const isFemale = cleanGender === 'female' || cleanGender === 'महिला';
          if (isFemale) {
            payer.rashidNumber = isSuraksha ? `SFR-${nextFRNum++}` : `FR-${nextFRNum++}`;
          } else {
            payer.rashidNumber = isSuraksha ? `SMR-${nextMRNum++}` : `MR-${nextMRNum++}`;
          }
        }

        const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
        const pdfDoc = await PDFDocument.create();

        let fontkitAvailable = false;
        try {
          const fontkitModule = require('@pdf-lib/fontkit');
          const fontkit = fontkitModule?.default ?? fontkitModule;
          if (fontkit) {
            pdfDoc.registerFontkit(fontkit);
            fontkitAvailable = true;
          }
        } catch (e) {
          console.error("Fontkit not available:", e);
        }

        let font;
        const fontCandidates = [
          path.join(process.cwd(), '..', 'public', 'fonts', 'NotoSansDevanagari-Regular.ttf'),
          path.join(process.cwd(), 'public', 'fonts', 'NotoSansDevanagari-Regular.ttf'),
          path.join(process.cwd(), 'assets', 'fonts', 'NotoSansDevanagari-Regular.ttf'),
        ];
        const devanagariFontPath = fontCandidates.find((p) => fs.existsSync(p));
        if (devanagariFontPath) {
          if (!fontkitAvailable) {
            throw new Error('Devanagari font found but fontkit is not installed.');
          }
          const customFontBytes = fs.readFileSync(devanagariFontPath);
          font = await pdfDoc.embedFont(customFontBytes, { subset: true });
        } else {
          font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        }

        const fontSize = 9;
        const textColor = rgb(0, 0, 0);

        const formatDateToDDMMYYYY = (dVal: any) => {
          if (!dVal) return '';
          const d = new Date(dVal);
          if (isNaN(d.getTime())) return '';
          return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
        };
        const todayDate = formatDateToDDMMYYYY(new Date().toISOString());

        const fieldMappings = isSuraksha
          ? [
              { field: 'rashidNumber', x: 115, y: 220 },
              { field: 'marriageNumber', x: 115, y: 242 },
              { field: 'todayDate', x: 450, y: 240 },
              { field: 'applicantName', x: 95, y: 270 },
              { field: 'fatherName', x: 400, y: 270 },
              { field: 'gotra', x: 90, y: 300 },
              { field: 'address', x: 355, y: 300 },
              { field: 'emiAmount', x: 120, y: 330 },
              { field: 'mobile', x: 400, y: 330 },
              { field: 'amountInWords', x: 210, y: 740 },
              { field: 'totalEmiAmount', x: 70, y: 795 },
            ]
          : [
              { field: 'rashidNumber', x: 115, y: 220 },
              { field: 'marriageNumber', x: 115, y: 240 },
              { field: 'todayDate', x: 450, y: 240 },
              { field: 'applicantName', x: 95, y: 270 },
              { field: 'fatherName', x: 380, y: 270 },
              { field: 'gotra', x: 90, y: 300 },
              { field: 'address', x: 360, y: 300 },
              { field: 'emiAmount', x: 120, y: 330 },
              { field: 'mobile', x: 400, y: 330 },
              { field: 'amountInWords', x: 210, y: 740 },
              { field: 'totalEmiAmount', x: 70, y: 795 },
            ];

        const baseW = 595;
        const baseH = 842;
        const maxRowsPerPage = 10;
        const tableStartY = 405;
        const rowHeight = 34;
        const serialColumnX = 80;
        const nameColumnX = 180;
        const dateColumnX = 495;

        const DEVANAGARI_HEADER_FIELDS = new Set(['applicantName', 'fatherName', 'gotra', 'address', 'amountInWords']);
        void DEVANAGARI_HEADER_FIELDS; // retained for future use

        function getTemplatePath(gender: string): string {
          const cleanGender = String(gender).trim().toLowerCase();
          const isFemale = cleanGender === 'female' || cleanGender === 'महिला';
          if (isSuraksha) {
            const filename = 'SURAKSHA_KIST_PAYMENT_RASHID.pdf';
            const candidates = [
              path.join(process.cwd(), '..', 'public', 'pdf', 'bulk_suraksha_update', filename),
              path.join(process.cwd(), 'public', 'pdf', 'bulk_suraksha_update', filename),
            ];
            const found = candidates.find(c => fs.existsSync(c));
            if (!found) {
              throw new Error(`Bulk template file not found: ${filename}`);
            }
            return found;
          } else {
            const filename = isFemale ? 'female_emi_bulk.pdf' : 'male_emi_bulk.pdf';
            const candidates = [
              path.join(process.cwd(), '..', 'public', 'pdf', 'bulk_marriage_update', filename),
              path.join(process.cwd(), 'public', 'pdf', 'bulk_marriage_update', filename),
            ];
            const found = candidates.find(c => fs.existsSync(c));
            if (!found) {
              throw new Error(`Bulk template file not found for gender ${gender} (sought: ${filename})`);
            }
            return found;
          }
        }

        // Load templates once outside the loop
        const femalePath = getTemplatePath('female');
        const malePath = getTemplatePath('male');
        const femaleBytes = fs.readFileSync(femalePath);
        const maleBytes = fs.readFileSync(malePath);

        const femaleTemplateDoc = await PDFDocument.load(femaleBytes);
        const maleTemplateDoc = await PDFDocument.load(maleBytes);

        if (fontkitAvailable) {
          try {
            const fk = require('@pdf-lib/fontkit');
            femaleTemplateDoc.registerFontkit(fk);
            maleTemplateDoc.registerFontkit(fk);
          } catch (e) {}
        }

        const [embeddedFemalePage] = await pdfDoc.embedPdf(femaleTemplateDoc);
        const [embeddedMalePage] = await pdfDoc.embedPdf(maleTemplateDoc);

        const femaleSize = femaleTemplateDoc.getPages()[0].getSize();
        const maleSize = maleTemplateDoc.getPages()[0].getSize();

        const compareByMarriageNumberAsc = (a: any, b: any) => {
          const numA = parseInt(String(a.marriageNumber).replace(/\D/g, ""), 10);
          const numB = parseInt(String(b.marriageNumber).replace(/\D/g, ""), 10);
          if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
          return String(a.marriageNumber).localeCompare(String(b.marriageNumber));
        };

        function numberToHindiWords(num: number): string {
          if (num === 0) return "शून्य";

          const ones = [
            "", "एक", "दो", "तीन", "चार", "पाँच", "छः", "सात", "आठ", "नौ",
            "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह",
            "सत्रह", "अठारह", "उन्नीस"
          ];

          const tens = [
            "", "", "बीस", "तीस", "चालीस", "पचास",
            "साठ", "सत्तर", "अस्सी", "नब्बे"
          ];

          const scales = ["", "हज़ार", "लाख", "करोड़"];

          function chunkToWords(n: number): string {
            let str = "";
            if (n >= 100) {
              str += ones[Math.floor(n / 100)] + " सौ ";
              n %= 100;
            }
            if (n >= 20) {
              str += tens[Math.floor(n / 10)] + " ";
              n %= 10;
            }
            if (n > 0) {
              str += ones[n] + " ";
            }
            return str.trim();
          }

          let words = "";
          const parts = [];
          parts.push(num % 1000);
          num = Math.floor(num / 1000);

          while (num > 0) {
            parts.push(num % 100);
            num = Math.floor(num / 100);
          }

          for (let i = parts.length - 1; i >= 0; i--) {
            if (parts[i] > 0) {
              words += chunkToWords(parts[i]) + " " + scales[i] + " ";
            }
          }

          return words.trim();
        }

        for (const payer of filteredResults) {
          const marriages = Array.isArray(payer.pendingMarriages) ? payer.pendingMarriages : [];
          if (marriages.length === 0) continue;

          // Sort marriages low-to-high by number
          marriages.sort(compareByMarriageNumberAsc);

          const cleanGender = String(payer.gender).trim().toLowerCase();
          const isFemale = cleanGender === 'female' || cleanGender === 'महिला';
          const embeddedPage = isFemale ? embeddedFemalePage : embeddedMalePage;
          const pageSize = isFemale ? femaleSize : maleSize;

          const { width: pageWidth, height: pageHeight } = pageSize;
          const scaleX = pageWidth / baseW;
          const scaleY = pageHeight / baseH;

          const totalPagesForPayer = Math.ceil(marriages.length / maxRowsPerPage);

          for (let pageIndex = 0; pageIndex < totalPagesForPayer; pageIndex++) {
            const page = pdfDoc.addPage([pageWidth, pageHeight]);
            page.drawPage(embeddedPage, { x: 0, y: 0, xScale: 1, yScale: 1 });

            const startIndex = pageIndex * maxRowsPerPage;
            const endIndex = Math.min(startIndex + maxRowsPerPage, marriages.length);
            const pageRecords = marriages.slice(startIndex, endIndex);

            const pageTotalEmiAmount = pageRecords.length * (payer.emiAmount || 0);
            const pageAmountInWords = pageTotalEmiAmount ? numberToHindiWords(Math.floor(pageTotalEmiAmount)) : '';

            const pagePdfData: Record<string, any> = {
              rashidNumber: payer.rashidNumber || '',
              marriageNumber: payer.formNumber || '',
              applicantName: payer.applicantName || '',
              fatherName: payer.fatherName || '',
              gotra: payer.gotra || '',
              address: payer.address || '',
              todayDate,
              emiAmount: payer.emiAmount,
              mobile: payer.mobile || '',
              totalEmiAmount: `${pageTotalEmiAmount}`,
              amountInWords: pageAmountInWords,
            };

            for (const mapping of fieldMappings) {
              const value = pagePdfData[mapping.field];
              if (value === undefined || value === null) continue;

              const scaledX = mapping.x * scaleX;
              const scaledY = mapping.y * scaleY;

              page.drawText(String(value), {
                x: scaledX,
                y: pageHeight - scaledY,
                size: fontSize,
                font,
                color: textColor,
              });
            }

            for (let index = 0; index < pageRecords.length; index++) {
              const record = pageRecords[index];
              const scaledRowY = (tableStartY + index * rowHeight) * scaleY;

              if (isSuraksha) {
                // Bima Number (कोड नं.)
                page.drawText(`${record.marriageNumber}`, {
                  x: 80 * scaleX,
                  y: pageHeight - scaledRowY,
                  size: 9,
                  font,
                  color: textColor,
                });
              } else {
                // 3-column layout for Marriage: Serial column has the marriage number
                page.drawText(`${record.marriageNumber}`, {
                  x: serialColumnX * scaleX,
                  y: pageHeight - scaledRowY,
                  size: 9,
                  font,
                  color: textColor,
                });
              }

              const nameText = `${record.applicantName}/${record.fatherName} (${record.village})`;
              page.drawText(nameText, {
                x: nameColumnX * scaleX,
                y: pageHeight - scaledRowY,
                size: 9,
                font,
                color: textColor,
              });

              const dateText = formatDateToDDMMYYYY(record.date) || 'N/A';
              page.drawText(dateText, {
                x: dateColumnX * scaleX,
                y: pageHeight - scaledRowY,
                size: 9,
                font,
                color: textColor,
              });
            }
          }
        }

        const pdfBytes = await pdfDoc.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="bulk_agent_pending_emi_${Date.now()}.pdf"`);
        return res.send(Buffer.from(pdfBytes));
      }

      case "updatePaymentStatus": {
        const application_id = payload.application_id ?? payload.applicationId;
        const items = Array.isArray(payload.data) ? payload.data : [];
        const orConditions = resolvePayerApplicationWhere(application_id);

        if (!orConditions) {
          if (items.length === 0) {
            return res.json({
              status: true,
              error: false,
              marriages_updated: 0,
              marriages_failed: 0,
              details: [],
              message: "No payment updates requested",
            });
          }
          return res.status(200).json({ error: true, message: "application_id is required" });
        }

        const payerApp = await prisma.generalApplication.findFirst({
          where: {
            OR: orConditions,
            deletedAt: null
          }
        });
        if (!payerApp) {
          return res.status(200).json({ error: true, message: "Payer application not found" });
        }

        let updated = 0;
        const details = [];

        const defaultAdmin = await prisma.user.findFirst({ select: { id: true } });
        const fallbackUserId = defaultAdmin?.id || "";

        for (const item of items) {
          try {
            if (!isValidUuid(item.id)) {
              details.push({ marriageNumber: "", status: "failed" });
              continue;
            }
            const congrats = await prisma.marriageCongratulations.findFirst({
              where: { id: item.id, deletedAt: null }
            });
            if (!congrats) {
              details.push({ marriageNumber: "", status: "failed" });
              continue;
            }

            const emiAmount = MARRIAGE_CATEGORY_EMI_AMOUNTS[payerApp.category] ?? 0;
            const finalAddedById = isValidUuid(item.addedby_id) ? item.addedby_id : (isValidUuid(addedById) ? addedById : fallbackUserId);
            const paymentModeInput = normalizePaymentMode(payload.payment_mode || "CASH");

            const existingPayment = await prisma.marriageCongratulationsPayment.findFirst({
              where: {
                marriageCongratulationsId: congrats.id,
                applicationId: payerApp.id,
                deletedAt: null
              }
            });

            if (existingPayment) {
              await prisma.marriageCongratulationsPayment.update({
                where: { id: existingPayment.id },
                data: {
                  amount: emiAmount,
                  category: payerApp.category,
                  addedById: finalAddedById,
                  createdAt: new Date(),
                  updatedAt: new Date()
                }
              });
            } else {
              await prisma.marriageCongratulationsPayment.create({
                data: {
                  marriageCongratulationsId: congrats.id,
                  applicationId: payerApp.id,
                  category: payerApp.category,
                  amount: emiAmount,
                  addedById: finalAddedById,
                  createdAt: new Date()
                }
              });
            }

            // Create matching GeneralApplicationInstallment row for Payment Management & Cash Flow
            await prisma.generalApplicationInstallment.create({
              data: {
                applicationId: payerApp.id,
                amount: emiAmount,
                date: new Date(),
                paymentMode: paymentModeInput,
                note: `MARRIAGE_CONGRATS_EMI:${congrats.marriageNumber}`,
                addedById: finalAddedById,
              }
            });

            // Record cash flow entry
            await recordLegacyPaymentEntry(prisma, {
              legacyId: congrats.id,
              date: new Date(),
              amount: emiAmount,
              name: formatEmiContributionName(
                [payerApp.formNumber, payerApp.applicantName, payerApp.address],
                { name: congrats.applicantName, code: congrats.marriageNumber, scheme: "marriage congratulations" }
              ),
              source: "marriage_congratulations_emi",
              type: "In",
            });

            updated++;
            details.push({ marriageNumber: congrats.marriageNumber, status: "updated" });
          } catch (err) {
            details.push({ marriageNumber: "", status: "failed" });
          }
        }

        bulkDataCache.clear();

        return res.json({
          status: true,
          error: false,
          marriages_updated: updated,
          marriages_failed: items.length - updated,
          details
        });
      }

      case "register": {
        const { name, email, mobile, password } = payload;
        
        // Check if user already exists
        const existingUser = await prisma.user.findFirst({
          where: { mobile, deletedAt: null }
        });
        if (existingUser) {
          return res.json({ status: false, error: true, message: "Mobile number is already registered" });
        }
        
        const passwordHash = await bcrypt.hash(password, 10);
        
        const newUser = await prisma.user.create({
          data: {
            name,
            email,
            mobile,
            passwordHash,
            role: "ADMIN",
            isActive: true
          }
        });
        
        return res.json({ status: true, error: false, message: "Registration successful", data: newUser });
      }

      case "editLoanApplication": {
        if (!isValidUuid(payload.id)) {
          return res.status(200).json({ error: true, message: "Invalid ID format" });
        }
        try {
          const result = await schemesService.updateLoan(payload.id, payload);
          return res.json({
            status: true,
            error: false,
            message: "Loan application updated successfully",
            data: mapLoanApplicationRecord(result as Record<string, any>),
          });
        } catch (err: any) {
          const message = err?.message || "Failed to update loan application";
          return res.status(200).json({ error: true, message });
        }
      }

      case "deleteLoanApplication": {
        const result = await softDeleteWithChildren(
          prisma.loanApplication,
          payload.id,
          "Loan application",
          [{ model: prisma.loanApplicationInstallment, fkField: "loanApplicationId" }]
        );
        return res.json({ status: true, error: false, message: "Loan application deleted successfully", data: result });
      }

      case "editFinancialHelp": {
        if (!isValidUuid(payload.id)) {
          return res.status(200).json({ error: true, message: "Invalid ID format" });
        }
        try {
          const result = await schemesService.updateFinancialHelp(payload.id, payload);
          return res.json({
            status: true,
            error: false,
            message: "Financial help record updated successfully",
            data: mapFinancialHelpRecord(result as Record<string, any>),
          });
        } catch (err: any) {
          const message = err?.message || "Failed to update financial help record";
          return res.status(200).json({ error: true, message });
        }
      }

      case "deleteFinancialHelp": {
        if (!isValidUuid(payload.id)) {
          return res.status(200).json({ error: true, message: "Invalid ID format" });
        }
        const result = await softDeleteWithChildren(
          prisma.financialHelp,
          payload.id,
          "Financial help record",
          [{ model: prisma.financialHelpInstallment, fkField: "financialHelpId" }]
        );
        return res.json({ status: true, error: false, message: "Financial help record deleted successfully", data: result });
      }

      case "editDisabilityCycle": {
        if (!isValidUuid(payload.id)) {
          return res.status(200).json({ error: true, message: "Invalid ID format" });
        }
        try {
          const result = await schemesService.updateDisabilityCycle(payload.id, payload);
          return res.json({
            status: true,
            error: false,
            message: "Disability cycle updated successfully",
            data: mapDisabilityCycleRecord(result as Record<string, any>),
          });
        } catch (err: any) {
          const message = err?.message || "Failed to update disability cycle";
          return res.status(200).json({ error: true, message });
        }
      }

      case "deleteDisabilityCycle": {
        if (!isValidUuid(payload.id)) {
          return res.status(200).json({ error: true, message: "Invalid ID format" });
        }
        const result = await softDeleteRecord(
          prisma.disabilityCycle,
          payload.id,
          "Disability cycle"
        );
        return res.json({ status: true, error: false, message: "Disability cycle deleted successfully", data: result });
      }

      case "editMarriageCongrats": {
        const newDate = parseOptionalDateInput(payload.date, "date");
        const newJoinDate = parseOptionalDateInput(
          payload.membershipJoinDate,
          "membershipJoinDate"
        );
        if (newDate || newJoinDate) {
          const existing = await prisma.marriageCongratulations.findUnique({
            where: { id: payload.id },
            select: { date: true, membershipJoinDate: true },
          });
          const effectiveDate = newDate ?? existing?.date;
          const effectiveJoinDate = newJoinDate ?? existing?.membershipJoinDate;
          if (effectiveDate && effectiveJoinDate && effectiveDate < effectiveJoinDate) {
            return res.status(200).json({
              error: true,
              message:
                "Marriage date cannot be before the registration/membership join date",
            });
          }
        }

        const result = await prisma.marriageCongratulations.update({
          where: { id: payload.id },
          data: {
            date: newDate,
            codeNumber: payload.codeNumber,
            marriageNumber: payload.marriageNumber,
            applicantName: payload.applicantName,
            fatherName: payload.fatherName,
            wifeOf: payload.wifeOf || null,
            gotra: payload.gotra,
            address: payload.address,
            membershipJoinDate: newJoinDate,
            associatedUntil:
              payload.associatedUntil !== undefined
                ? String(payload.associatedUntil)
                : undefined,
            permanentFee: Number(payload.permanentFee || 0),
            installmentAmount: Number(payload.installmentAmount || 0),
            totalGrantAmount: Number(payload.totalGrantAmount || 0),
            totalMembersServing: Number(payload.totalMembersServing || 0),
            rate100: Number(payload.rate100 || 0),
            rate200: Number(payload.rate200 || 0),
            rate300: Number(payload.rate300 || 0),
            deductionPercent: Number(payload.deductionPercent || 0),
            deductedAmount: Number(payload.deductedAmount || 0),
            totalPaidAmount: Number(payload.totalPaidAmount || 0),
            gender: payload.gender,
          }
        });
        return res.json({ status: true, error: false, message: "Marriage congratulations updated successfully", data: result });
      }

      case "deleteMarriageCongrats": {
        const result = await softDeleteWithChildren(
          prisma.marriageCongratulations,
          payload.id,
          "Marriage congratulations",
          [
            { model: prisma.marriageCongratulationsPayment, fkField: "marriageCongratulationsId" },
            { model: prisma.marriageSewingMachine, fkField: "marriageCongratulationsId" },
          ]
        );
        return res.json({ status: true, error: false, message: "Marriage congratulations deleted successfully", data: result });
      }

      case "editMarriageSewing": {
        if (!isValidUuid(payload.id)) {
          return res.status(200).json({ error: true, message: "Invalid ID format" });
        }
        const updateData = buildUpdateData(payload, [
          { key: "formNumber" },
          { key: "applicationDate", transform: (value) => parseDateInput(value, "applicationDate") },
          { key: "applicantName" },
          { key: "fatherName" },
          { key: "motherName" },
          { key: "dateOfBirth", transform: (value) => parseDateInput(value, "dateOfBirth") },
          { key: "aadharNumber" },
          { key: "gotra" },
          {
            key: "age",
            transform: (value) => {
              const age = Number(value);
              return Number.isNaN(age) ? undefined : age;
            },
          },
          { key: "mobile" },
          { key: "address" },
          { key: "pinCode" },
          { key: "tehsil" },
          { key: "district" },
          { key: "state" },
          { key: "gender" },
        ]);
        const result = await applyPartialUpdate(
          prisma.marriageSewingMachine,
          payload.id,
          updateData,
          "Sewing machine application"
        );
        if (!result.ok) {
          return res.status(200).json({ error: true, message: result.message });
        }
        return res.json({ status: true, error: false, message: result.message, data: result.data });
      }

      case "deleteMarriageSewing": {
        if (!isValidUuid(payload.id)) {
          return res.status(200).json({ error: true, message: "Invalid ID format" });
        }
        const result = await softDeleteRecord(
          prisma.marriageSewingMachine,
          payload.id,
          "Sewing machine application"
        );
        return res.json({ status: true, error: false, message: "Sewing machine application deleted successfully", data: result });
      }

      case "editPensionYojana": {
        if (!isValidUuid(payload.id)) {
          return res.status(200).json({ error: true, message: "Invalid ID format" });
        }
        try {
          const result = await schemesService.updatePensionYojana(payload.id, payload);
          return res.json({
            status: true,
            error: false,
            message: "Pension beneficiary updated successfully",
            data: mapPensionYojanaRecord(result as Record<string, any>),
          });
        } catch (err: any) {
          const message = err?.message || "Failed to update pension beneficiary";
          return res.status(200).json({ error: true, message });
        }
      }

      case "deletePensionYojana": {
        if (!isValidUuid(payload.id)) {
          return res.status(200).json({ error: true, message: "Invalid ID format" });
        }
        const result = await softDeleteWithChildren(
          prisma.pensionYojana,
          payload.id,
          "Pension beneficiary",
          [{ model: prisma.pensionYojanaPayment, fkField: "pensionYojanaId" }]
        );
        return res.json({ status: true, error: false, message: "Pension beneficiary deleted successfully", data: result });
      }

      case "editSewingCamp": {
        if (!isValidUuid(payload.id)) {
          return res.status(200).json({ error: true, message: "Invalid ID format" });
        }
        try {
          const result = await schemesService.updateSewingMachineCamp(payload.id, payload);
          return res.json({
            status: true,
            error: false,
            message: "Sewing machine camp application updated successfully",
            data: mapSewingMachineCampRecord(result as Record<string, any>),
          });
        } catch (err: any) {
          const message = err?.message || "Failed to update sewing machine camp application";
          return res.status(200).json({ error: true, message });
        }
      }

      case "deleteSewingCamp": {
        if (!isValidUuid(payload.id)) {
          return res.status(200).json({ error: true, message: "Invalid ID format" });
        }
        const result = await softDeleteRecord(
          prisma.sewingMachineCamp,
          payload.id,
          "Sewing machine camp application"
        );
        return res.json({ status: true, error: false, message: "Sewing machine camp application deleted successfully", data: result });
      }

      case "editSurakshaBima": {
        if (!isValidUuid(payload.id)) {
          return res.status(200).json({ error: true, message: "Invalid ID format" });
        }
        try {
          const result = await appsService.updateSurakshaBima(payload.id, payload);
          return res.json({ status: true, error: false, message: "Suraksha Bima updated successfully", data: result });
        } catch (err: any) {
          const message = err?.message || "Failed to update Suraksha Bima";
          return res.status(200).json({ error: true, message });
        }
      }

      case "deleteSurakshaBima": {
        if (!isValidUuid(payload.id)) {
          return res.status(200).json({ error: true, message: "Invalid ID format" });
        }
        const result = await softDeleteRecord(
          prisma.surakshaBimaYojana,
          payload.id,
          "Suraksha Bima"
        );
        return res.json({ status: true, error: false, message: "Suraksha Bima deleted successfully", data: result });
      }

      case "getMarriageDetailsByNumber": {
        const result = await prisma.marriageCongratulations.findFirst({
          where: { marriageNumber: payload.marriageNumber, deletedAt: null },
          include: {
            sewingMachines: { orderBy: { createdAt: "asc" } }
          }
        });
        if (!result) {
          return res.json({ status: false, error: true, message: "Marriage details not found" });
        }
        
        let generalApp = null;
        if (result.codeNumber) {
          generalApp = await prisma.generalApplication.findFirst({
            where: { formNumber: result.codeNumber, deletedAt: null }
          });
        }
        
        const congratulationsData = {
          ...result,
          motherName: generalApp?.motherName || "",
          dateOfBirth: generalApp?.dateOfBirth || null,
          aadharNumber: generalApp?.aadharNumber || "",
          mobile: generalApp?.mobile || "",
          pinCode: generalApp?.pinCode || "",
          tehsil: generalApp?.tehsil || "",
          district: generalApp?.district || "",
          state: generalApp?.state || "",
        };

        return res.json({
          status: true,
          error: false,
          congratulationsData,
          sewingMachineData: result.sewingMachines?.[0] || null
        });
      }

      case "updatePdfStatus": {
        const ids = Array.isArray(payload.ids) ? payload.ids : [];
        if (ids.length === 0) {
          return res.json({ status: true, error: false, message: "No IDs provided" });
        }

        // 1. Find existing payments
        let payments = await prisma.marriageCongratulationsPayment.findMany({
          where: {
            OR: [
              { id: { in: ids } },
              { marriageCongratulationsId: { in: ids } }
            ],
            deletedAt: null
          },
          include: {
            marriageCongratulations: true
          }
        });

        // 2. If some IDs are congrats IDs and don't have payments, let's create them!
        const existingCongratsIds = new Set(payments.map(p => p.marriageCongratulationsId));
        const missingCongratsIds = ids.filter((id: string) => !existingCongratsIds.has(id));

        if (missingCongratsIds.length > 0) {
          const congratsRecords = await prisma.marriageCongratulations.findMany({
            where: { id: { in: missingCongratsIds }, deletedAt: null }
          });

          for (const congrats of congratsRecords) {
            const orConditions: any[] = [
              { gotra: congrats.gotra, gender: congrats.gender, deletedAt: null }
            ];
            const payerApp = await prisma.generalApplication.findFirst({
              where: { OR: orConditions }
            });
            
            const emiAmount = payerApp ? (MARRIAGE_CATEGORY_EMI_AMOUNTS[payerApp.category] ?? 300) : 300;
            const category = payerApp ? payerApp.category : "A";
            const appId = payerApp ? payerApp.id : congrats.id;

            const newPayment = await prisma.marriageCongratulationsPayment.create({
              data: {
                marriageCongratulationsId: congrats.id,
                applicationId: appId,
                category: category,
                amount: emiAmount,
                addedById: addedById || congrats.addedById
              },
              include: {
                marriageCongratulations: true
              }
            });
            payments.push(newPayment);
          }
        }

        if (payments.length === 0) {
          return res.json({ status: false, error: true, message: "No valid records found to update" });
        }

        // 3. Determine if they already have a rashidNumber assigned
        const existingRashid = payments.find(p => (p as any).rashidNumber)?.rashidNumber;
        let assignedRashid = existingRashid;

        if (!assignedRashid) {
          // 4. Generate next rashidNumber
          const gender = payments[0].marriageCongratulations?.gender || "Female";
          const isMale = gender === "Male";
          const prefix = isMale ? "MR-" : "FR-";

          const lastPayment = await prisma.marriageCongratulationsPayment.findFirst({
            where: {
              rashidNumber: {
                startsWith: prefix
              }
            },
            orderBy: {
              createdAt: "desc"
            }
          });

          let nextNum = 1001;
          if (lastPayment && lastPayment.rashidNumber) {
            const match = lastPayment.rashidNumber.match(/\d+/);
            if (match) {
              nextNum = parseInt(match[0], 10) + 1;
            }
          }

          assignedRashid = `${prefix}${nextNum}`;

          // 5. Save the rashidNumber to all payment records
          await prisma.marriageCongratulationsPayment.updateMany({
            where: {
              id: { in: payments.map(p => p.id) }
            },
            data: {
              rashidNumber: assignedRashid
            } as any
          });
        }

        return res.json({
          status: true,
          error: false,
          message: "PDF status updated",
          rashidNumber: assignedRashid
        });
      }

      default: {
        return res.status(200).json({ error: true, message: `Unsupported apicall: ${apicall}` });
      }
    }
  } catch (err: any) {
    console.error(`Error in compatibility handler for [${apicall}]:`, err);
    if (err instanceof NotFoundError) {
      return res.status(200).json({ status: false, error: true, message: err.message });
    }
    if (err instanceof BadRequestError) {
      return res.status(200).json({ status: false, error: true, message: err.message });
    }
    if (err instanceof ConflictError) {
      return res.status(200).json({ status: false, error: true, message: err.message });
    }
    if (
      err.code === "P2025" ||
      (err.message &&
        (err.message.includes("not found") ||
          err.message.includes("Record to update not found") ||
          err.message.includes("Record to delete not found")))
    ) {
      return res.status(200).json({ error: true, message: "Record not found" });
    }
    const msg = String(err.message || "");
    if (msg.includes("prisma") || msg.includes("validation") || msg.includes("Argument") || msg.includes("missing")) {
      // Surface which field/argument is missing instead of a generic message, so a
      // required-but-unsent field (the cause of silent "form not saved" failures)
      // is actionable. Extract the Prisma "Argument `x` is missing" hint when present.
      const argMatch = msg.match(/Argument `?(\w+)`? is missing/i);
      const detail = argMatch ? `Missing required field: ${argMatch[1]}` : "Invalid or incomplete request data";
      return res.status(200).json({ error: true, message: detail });
    }
    return res.status(200).json({ error: true, message: err.message || "Internal server error" });
  }
});

export default router;
