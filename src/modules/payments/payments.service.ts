import Razorpay from "razorpay";
import crypto from "crypto";
import { Gender, Prisma } from "@prisma/client";
import { prisma } from "../../config/db";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { parseDateInput } from "../../utils/parse-date";
import { normalizeListFilters } from "../../utils/list-filters";
import { recordLegacyPaymentEntry } from "../../utils/legacy-payment-entry";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "mock_key_id",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "mock_key_secret",
});

export class PaymentsService {
  // ── GENERAL CASH FLOW (CASH BOOK) ──────────────────

  public async createPayment(data: any, addedById: string) {
    const payment = await prisma.payment.create({
      data: {
        date: parseDateInput(data.date, "date"),
        type: data.type || "Out",
        amount: data.amount,
        remark: data.remark || null,
        addedById: addedById,
      },
    });

    await recordLegacyPaymentEntry(prisma, {
      legacyId: payment.id,
      date: payment.date,
      amount: payment.amount,
      name: payment.remark || "Manual Payment Entry",
      source: "payment_management",
      type: (payment.type as "In" | "Out") || "Out",
    });

    return payment;
  }

  public async getAllPayments(filters: any) {
    const whereClause: any = { deletedAt: null };

    if (filters.search) {
      whereClause.remark = { contains: filters.search, mode: "insensitive" };
    }

    if (filters.type) {
      whereClause.type = { contains: filters.type, mode: "insensitive" };
    }

    return prisma.payment.findMany({
      where: whereClause,
      include: {
        addedBy: { select: { id: true, name: true } },
      },
      orderBy: { date: "desc" },
    });
  }

  /**
   * Unified cash-flow ledger reading directly from legacy_payment_entries dataset.
   */
  public async getUnifiedPaymentList(filters: any = {}) {
    const normalized = normalizeListFilters(filters);
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = filters.limit ? Math.min(1000000, Math.max(1, Number(filters.limit))) : 50;
    const sourceFilter = filters.source && filters.source !== "all" ? String(filters.source) : null;
    const search = String(filters.search || "").trim();
    const fromDate = filters.from || filters.fromDate || (normalized.fromDate ? String(normalized.fromDate) : null);
    const toDate = filters.to || filters.toDate || (normalized.toDate ? String(normalized.toDate) : null);

    const conditions: string[] = ["deleted_at IS NULL"];
    const params: any[] = [];
    let pIndex = 1;

    if (sourceFilter) {
      conditions.push(`source = $${pIndex++}`);
      params.push(sourceFilter);
    }

    if (fromDate) {
      conditions.push(`entry_date >= $${pIndex++}`);
      params.push(String(fromDate).split("T")[0]);
    }

    if (toDate) {
      conditions.push(`entry_date <= $${pIndex++}`);
      params.push(String(toDate).split("T")[0]);
    }

    if (search) {
      conditions.push(`(name ILIKE $${pIndex} OR source ILIKE $${pIndex} OR legacy_id ILIKE $${pIndex} OR ref_id ILIKE $${pIndex})`);
      params.push(`%${search}%`);
      pIndex++;
    }

    const whereClause = conditions.join(" AND ");

    const aggResult: any = await prisma.$queryRawUnsafe(`
      SELECT 
        COUNT(*)::int as count,
        COALESCE(SUM(CASE WHEN LOWER(type) = 'in' THEN amount ELSE 0 END), 0)::numeric as income,
        COALESCE(SUM(CASE WHEN LOWER(type) = 'out' THEN amount ELSE 0 END), 0)::numeric as expense
      FROM legacy_payment_entries
      WHERE ${whereClause}
    `, ...params);

    const totalRecords = aggResult[0]?.count || 0;
    const totalIncome = Number(aggResult[0]?.income || 0);
    const totalExpenses = Number(aggResult[0]?.expense || 0);
    const netBalance = totalIncome - totalExpenses;
    const totalPages = Math.max(1, Math.ceil(totalRecords / limit));

    const offset = (page - 1) * limit;
    const dataParams = [...params, limit, offset];
    const items: any[] = await prisma.$queryRawUnsafe(`
      SELECT 
        id,
        legacy_id as "legacyId",
        entry_date as date,
        amount,
        name,
        source,
        type,
        ref_id as "refId"
      FROM legacy_payment_entries
      WHERE ${whereClause}
      ORDER BY entry_date DESC, created_at DESC
      LIMIT $${pIndex++} OFFSET $${pIndex++}
    `, ...dataParams);

    return {
      data: items.map((item) => ({
        id: item.legacyId || item.id,
        date: item.date,
        type: item.type,
        amount: Number(item.amount),
        name: item.name || undefined,
        remark: item.name || undefined,
        source: item.source,
      })),
      totalIncome,
      totalExpenses,
      netBalance,
      pagination: {
        page,
        limit,
        totalRecords,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  // ── AGENT COMMISSION REPORT & PAYOUTS ───────────────

  /**
   * Calculate commission details for a specific Agent in a date range
   */
  public async getAgentCommissionReport(
    agentId: string,
    startDate: Date,
    endDate: Date,
    gender?: string
  ) {
    // Validate agent exists
    const agent = await prisma.user.findFirst({
      where: { id: agentId, role: "AGENT", deletedAt: null },
    });

    if (!agent) {
      throw new NotFoundError("Agent not found");
    }

    // Adjust endDate to end of day to include all items on that date
    const endOfDay = new Date(endDate);
    endOfDay.setHours(23, 59, 59, 999);

    const normalizedGender: Gender | undefined =
      gender && gender !== "all"
        ? (gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase() as Gender)
        : undefined;

    // Fetch all active members registered by this agent
    const agentMembers = await prisma.generalApplication.findMany({
      where: { addedById: agentId, deletedAt: null, isActive: true },
      select: { id: true }
    });
    const agentMemberIds = agentMembers.map((m) => m.id);

    const agentMayraMembers = await prisma.mayraRegistration.findMany({
      where: { addedById: agentId, deletedAt: null, isActive: true },
      select: { id: true }
    });
    const agentMayraMemberIds = agentMayraMembers.map((m) => m.id);

    const applicationWhere: Prisma.GeneralApplicationWhereInput = {
      addedById: agentId,
      applicationDate: { gte: startDate, lte: endOfDay },
      deletedAt: null,
      ...(normalizedGender ? { gender: normalizedGender } : {}),
    };

    const insuranceWhere: Prisma.InsuranceApplicationWhereInput = {
      addedById: agentId,
      applicationDate: { gte: startDate, lte: endOfDay },
      deletedAt: null,
      ...(normalizedGender ? { gender: normalizedGender } : {}),
    };

    const generalInstallmentWhere: Prisma.GeneralApplicationInstallmentWhereInput = {
      addedById: agentId,
      date: { gte: startDate, lte: endOfDay },
      deletedAt: null,
      application: {
        deletedAt: null,
        isActive: true,
        ...(normalizedGender ? { gender: normalizedGender } : {}),
      },
    };

    const insuranceInstallmentWhere: Prisma.InsuranceApplicationInstallmentWhereInput = {
      addedById: agentId,
      date: { gte: startDate, lte: endOfDay },
      deletedAt: null,
      application: {
        deletedAt: null,
        isActive: true,
        ...(normalizedGender ? { gender: normalizedGender } : {}),
      },
    };

    // Suraksha Bima Yojana registrations have no addedById of their own —
    // attribution runs through the parent InsuranceApplication they were
    // created against (see createSurakshaBimaPayment / getInsuranceBulkData).
    const surakshaBimaWhere: Prisma.SurakshaBimaYojanaWhereInput = {
      date: { gte: startDate, lte: endOfDay },
      deletedAt: null,
      insuranceApplication: {
        addedById: agentId,
        deletedAt: null,
        isActive: true,
        ...(normalizedGender ? { gender: normalizedGender } : {}),
      },
    };

    const marriageCongratsWhere: Prisma.MarriageCongratulationsWhereInput = {
      addedById: agentId,
      date: { gte: startDate, lte: endOfDay },
      deletedAt: null,
      ...(normalizedGender ? { gender: normalizedGender } : {}),
    };

    const marriageCongratsEmiWhere: Prisma.MarriageCongratulationsPaymentWhereInput = {
      applicationId: { in: agentMemberIds },
      deletedAt: null,
      createdAt: { gte: startDate, lte: endOfDay },
      ...(normalizedGender
        ? { marriageCongratulations: { gender: normalizedGender } }
        : {}),
    };

    const mayraApplicationWhere: Prisma.MayraRegistrationWhereInput = {
      addedById: agentId,
      applicationDate: { gte: startDate, lte: endOfDay },
      deletedAt: null,
      ...(normalizedGender ? { gender: normalizedGender } : {}),
    };

    const mayraInstallmentWhere: Prisma.MayraInstallmentWhereInput = {
      addedById: agentId,
      date: { gte: startDate, lte: endOfDay },
      deletedAt: null,
      mayraRegistration: {
        deletedAt: null,
        isActive: true,
        ...(normalizedGender ? { gender: normalizedGender } : {}),
      },
    };

    const mayraCongratsWhere: Prisma.MayraCongratulationsWhereInput = {
      addedById: agentId,
      date: { gte: startDate, lte: endOfDay },
      deletedAt: null,
      ...(normalizedGender ? { gender: normalizedGender } : {}),
    };

    const mayraCongratsEmiWhere: Prisma.MayraCongratulationsPaymentWhereInput = {
      applicationId: { in: agentMayraMemberIds },
      deletedAt: null,
      createdAt: { gte: startDate, lte: endOfDay },
      ...(normalizedGender
        ? { mayraCongratulations: { gender: normalizedGender } }
        : {}),
    };

    // Loan applications have no gender field and no fee of their own — only
    // actual repayments collected from the borrower count toward commission
    // (excludes WE_PAID rows, which are the foundation paying out, not collecting).
    const loanRepaymentWhere: Prisma.LoanApplicationInstallmentWhereInput = {
      addedById: agentId,
      date: { gte: startDate, lte: endOfDay },
      deletedAt: null,
      type: "USER_REPAYMENT",
    };

    const financialHelpWhere: Prisma.FinancialHelpWhereInput = {
      addedById: agentId,
      date: { gte: startDate, lte: endOfDay },
      deletedAt: null,
      ...(normalizedGender ? { gender: normalizedGender } : {}),
    };

    const financialHelpInstallmentWhere: Prisma.FinancialHelpInstallmentWhereInput = {
      addedById: agentId,
      date: { gte: startDate, lte: endOfDay },
      deletedAt: null,
      ...(normalizedGender ? { financialHelp: { gender: normalizedGender } } : {}),
    };

    // Pension Yojana has no gender-agnostic registration fee of its own — only
    // the individual pension payments are tracked as money movements.
    const pensionPaymentWhere: Prisma.PensionYojanaPaymentWhereInput = {
      addedById: agentId,
      date: { gte: startDate, lte: endOfDay },
      deletedAt: null,
      ...(normalizedGender ? { pensionYojana: { gender: normalizedGender } } : {}),
    };

    const [
      applications,
      generalInstallments,
      insurances,
      insuranceInstallments,
      surakshaBimaRecords,
      marriageCongrats,
      marriageCongratsEmi,
      mayraApplications,
      mayraInstallments,
      mayraCongrats,
      mayraCongratsEmi,
      loanRepayments,
      financialHelps,
      financialHelpInstallments,
      pensionPayments,
    ] = await Promise.all([
      prisma.generalApplication.findMany({ where: applicationWhere }),
      prisma.generalApplicationInstallment.findMany({
        where: generalInstallmentWhere,
        include: { application: { select: { applicantName: true, formNumber: true } } },
      }),
      prisma.insuranceApplication.findMany({ where: insuranceWhere }),
      prisma.insuranceApplicationInstallment.findMany({
        where: insuranceInstallmentWhere,
        include: { application: { select: { applicantName: true, formNumber: true } } },
      }),
      prisma.surakshaBimaYojana.findMany({ where: surakshaBimaWhere }),
      prisma.marriageCongratulations.findMany({ where: marriageCongratsWhere }),
      prisma.marriageCongratulationsPayment.findMany({
        where: marriageCongratsEmiWhere,
        include: { marriageCongratulations: { select: { applicantName: true, marriageNumber: true, date: true } } },
      }),
      prisma.mayraRegistration.findMany({ where: mayraApplicationWhere }),
      prisma.mayraInstallment.findMany({
        where: mayraInstallmentWhere,
        include: { mayraRegistration: { select: { applicantName: true, formNumber: true } } },
      }),
      prisma.mayraCongratulations.findMany({ where: mayraCongratsWhere }),
      prisma.mayraCongratulationsPayment.findMany({
        where: mayraCongratsEmiWhere,
        include: { mayraCongratulations: { select: { applicantName: true, mayraNumber: true, date: true } } },
      }),
      prisma.loanApplicationInstallment.findMany({
        where: loanRepaymentWhere,
        include: { loanApplication: { select: { applicantName: true, formNumber: true } } },
      }),
      prisma.financialHelp.findMany({ where: financialHelpWhere }),
      prisma.financialHelpInstallment.findMany({
        where: financialHelpInstallmentWhere,
        include: { financialHelp: { select: { name: true, formNumber: true } } },
      }),
      prisma.pensionYojanaPayment.findMany({
        where: pensionPaymentWhere,
        include: { pensionYojana: { select: { name: true, formNumber: true } } },
      }),
    ]);

    const formatDate = (value: Date) => value.toISOString().slice(0, 10);

    // Map each dataset into identical structure for commission table rendering.
    // totalAmount is the scheme's full target fee, not cash collected — whatever
    // was actually paid at registration is already its own row in formattedInst
    // (tagged fee_type: "Registration Fee"). Summing this array on top of that
    // would double-count the initial payment and add commission on money that
    // may still be pending. Kept here only as a reference/count list — the
    // frontend must not fold its amount into the commission total.
    const formattedApps = applications.map((app) => ({
      form_number: app.formNumber,
      name: app.applicantName,
      payment_mode: "Registration",
      amount: Number(app.totalAmount),
      date: formatDate(app.applicationDate),
    }));

    // Contributions a general-application member pays toward SOMEONE ELSE's
    // marriage-congratulations fund are written into this same installment
    // table (bulk-imported legacy data, see import-legacy-cashflow*.js) tagged
    // "MARRIAGE_CONGRATS_EMI:legacy-<id>". They must not be counted as this
    // member's own General Application fee/EMI — split them out and report
    // them under Marriage Congratulations EMI instead, same treatment as
    // BIMA_PAYMENT below.
    const isMarriageCongratsEmiNote = (note: string | null) => (note || "").startsWith("MARRIAGE_CONGRATS_EMI:");
    const plainGeneralInstallments = generalInstallments.filter((inst) => !isMarriageCongratsEmiNote(inst.note));

    // A row counts as the one-time application/registration fee if it carries
    // the note the live create-flow uses ("Registration Initial Payment") or
    // "Legacy Import" — the note used by backfill-general-application-missing-fee.js
    // for applications whose fee was recorded on totalAmount/pendingAmount but
    // never had an installment row of its own (same convention as Insurance's
    // isInsuranceRegistrationFeeNote below).
    const isGeneralRegistrationFeeNote = (note: string | null) =>
      note === "Registration Initial Payment" || note === "Legacy Import";

    const formattedInst = plainGeneralInstallments.map((inst) => ({
      form_number: inst.application.formNumber,
      name: inst.application.applicantName,
      payment_mode: inst.paymentMode,
      fee_type: isGeneralRegistrationFeeNote(inst.note) ? "Registration Fee" : "EMI",
      amount: Number(inst.amount),
      date: formatDate(inst.date),
    }));

    // Same caveat as formattedApps above: totalAmount is the target fee, not
    // what's been collected — the real figure is already in formattedInsInst.
    const formattedInsurances = insurances.map((ins) => ({
      form_number: ins.formNumber,
      name: ins.applicantName,
      payment_mode: "Registration",
      amount: Number(ins.totalAmount),
      date: formatDate(ins.applicationDate),
    }));

    // Suraksha Bima Yojana EMI collections are written into this same
    // installment table (see createSurakshaBimaPayment) tagged with a
    // "BIMA_PAYMENT:{bimaId} - ..." note instead of a dedicated payments table
    // like Marriage/Mayra Congratulations use. Split them out here so they
    // report under Suraksha Bima Yojana EMI instead of being silently counted
    // as (and mislabeled) plain insurance application EMI.
    const isBimaPaymentNote = (note: string | null) => (note || "").startsWith("BIMA_PAYMENT:");
    const plainInsuranceInstallments = insuranceInstallments.filter((inst) => !isBimaPaymentNote(inst.note));
    const surakshaBimaEmiInstallments = insuranceInstallments.filter((inst) => isBimaPaymentNote(inst.note));

    // "Legacy Import" is the note the one-time migration script
    // (migrate_insurance.js) used for the amount already paid at registration
    // time — it's the same fee concept as "Registration Initial Payment" from
    // the live create-flow, just a different label from a different code path.
    // Without recognizing it, all 171 migrated applications' fee rows fall
    // through and get mislabeled as EMI.
    const isInsuranceRegistrationFeeNote = (note: string | null) =>
      note === "Registration Initial Payment" || note === "Legacy Import";

    const formattedInsInst = plainInsuranceInstallments.map((inst) => ({
      form_number: inst.application.formNumber,
      name: inst.application.applicantName,
      payment_mode: inst.paymentMode,
      fee_type: isInsuranceRegistrationFeeNote(inst.note) ? "Registration Fee" : "EMI",
      amount: Number(inst.amount),
      date: formatDate(inst.date),
    }));

    // Resolve each BIMA_PAYMENT row back to the bima member it was collected
    // for (mirrors getSurakshaBimaPaymentById), so the report shows who the
    // EMI benefits rather than just the payer. Legacy-imported rows use
    // "BIMA_PAYMENT:legacy-<id>" (see import-suraksha-bima-emi-remainder.js) —
    // not a real SurakshaBimaYojana id — so only well-formed UUIDs are looked
    // up; anything else falls through to the payer fallback below untouched.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const bimaRecipientIds = [...new Set(
      surakshaBimaEmiInstallments
        .map((inst) => inst.note?.match(/^BIMA_PAYMENT:([^\s]+)/)?.[1])
        .filter((id): id is string => typeof id === "string" && UUID_RE.test(id))
    )];
    const bimaRecipients = bimaRecipientIds.length
      ? await prisma.surakshaBimaYojana.findMany({
          where: { id: { in: bimaRecipientIds } },
          select: { id: true, applicantName: true, bimaNumber: true },
        })
      : [];
    const bimaRecipientById = new Map(bimaRecipients.map((b) => [b.id, b]));

    const formattedSurakshaBimaEmi = surakshaBimaEmiInstallments.map((inst) => {
      const recipientId = inst.note?.match(/^BIMA_PAYMENT:([^\s]+)/)?.[1];
      const recipient = recipientId ? bimaRecipientById.get(recipientId) : undefined;
      return {
        form_number: recipient?.bimaNumber || inst.application.formNumber,
        name: recipient?.applicantName || inst.application.applicantName,
        payment_mode: "EMI",
        amount: Number(inst.amount),
        date: formatDate(inst.date),
      };
    });

    // Same caveat as formattedMarriageCongrats below: permanentFee is the
    // applicant's own registration fee, not the pool-wide grant total.
    const formattedSurakshaBima = surakshaBimaRecords.map((record) => ({
      form_number: record.bimaNumber,
      name: record.applicantName,
      payment_mode: "Registration",
      amount: Number(record.permanentFee),
      date: formatDate(record.date),
    }));

    const formattedMarriageCongrats = marriageCongrats.map((record) => ({
      form_number: record.marriageNumber,
      name: record.applicantName,
      payment_mode: "Registration",
      // totalPaidAmount is a pool-wide projected grant (rate × active-member-count
      // across the whole gender pool, minus deduction) — not cash this agent
      // collected. permanentFee is the applicant's own registration fee.
      amount: Number(record.permanentFee),
      date: formatDate(record.date),
    }));

    // applicationId (when present) is the paying member's own GeneralApplication
    // — show who paid (matches the commission-earning agent this row was
    // filtered by) rather than only who the money benefits. No Prisma relation
    // is declared for this FK, so resolve it with a manual lookup.
    const marriageCongratsPayerIds = [...new Set(
      marriageCongratsEmi.map((p) => p.applicationId).filter((id): id is string => Boolean(id))
    )];
    const marriageCongratsPayers = marriageCongratsPayerIds.length
      ? await prisma.generalApplication.findMany({
          where: { id: { in: marriageCongratsPayerIds } },
          select: { id: true, applicantName: true, formNumber: true },
        })
      : [];
    const marriageCongratsPayerById = new Map(marriageCongratsPayers.map((p) => [p.id, p]));

    const seenMarriageKeys = new Set<string>();
    const uniqueMarriageCongratsEmi = marriageCongratsEmi.filter((payment) => {
      if (!payment.applicationId) return true;
      const key = `${payment.applicationId}_${payment.marriageCongratulationsId}`;
      if (seenMarriageKeys.has(key)) return false;
      seenMarriageKeys.add(key);
      return true;
    });

    const formattedMarriageCongratsEmi = uniqueMarriageCongratsEmi.map((payment) => {
      const payer = payment.applicationId ? marriageCongratsPayerById.get(payment.applicationId) : undefined;
      return {
        form_number: payer?.formNumber || payment.marriageCongratulations.marriageNumber,
        name: payer?.applicantName || payment.marriageCongratulations.applicantName,
        payment_mode: "EMI",
        amount: Number(payment.amount),
        date: formatDate(payment.marriageCongratulations.date),
      };
    });

    // Same caveat as formattedApps above: joiningFee is the slab's target fee,
    // not what's been collected — the real figure is already in
    // formattedMayraInstallments.
    const formattedMayraApplications = mayraApplications.map((app) => ({
      form_number: app.formNumber,
      name: app.applicantName,
      payment_mode: "Registration",
      amount: Number(app.joiningFee),
      date: formatDate(app.applicationDate),
    }));

    // Mayra's legacy import scripts used two different labels for the amount
    // already paid at registration ("Imported Registration Payment" and
    // "Legacy Import") — neither matches the live create-flow's exact string,
    // so both must be recognized here or those 123 rows get mislabeled as EMI.
    const isMayraRegistrationFeeNote = (note: string | null) =>
      note === "Registration Initial Payment" ||
      note === "Imported Registration Payment" ||
      note === "Legacy Import";

    const formattedMayraInstallments = mayraInstallments.map((inst) => ({
      form_number: inst.mayraRegistration.formNumber,
      name: inst.mayraRegistration.applicantName,
      payment_mode: inst.paymentMode,
      fee_type: isMayraRegistrationFeeNote(inst.note) ? "Registration Fee" : "EMI",
      amount: Number(inst.amount),
      date: formatDate(inst.date),
    }));

    const formattedMayraCongrats = mayraCongrats.map((record) => ({
      form_number: record.mayraNumber,
      name: record.applicantName,
      payment_mode: "Registration",
      // Same pool-wide-projection issue as marriage congratulations above —
      // use the applicant's own registration fee, not the grant total.
      amount: Number(record.permanentFee),
      date: formatDate(record.date),
    }));

    const seenMayraKeys = new Set<string>();
    const uniqueMayraCongratsEmi = mayraCongratsEmi.filter((payment) => {
      if (!payment.applicationId) return true;
      const key = `${payment.applicationId}_${payment.mayraCongratulationsId}`;
      if (seenMayraKeys.has(key)) return false;
      seenMayraKeys.add(key);
      return true;
    });

    const formattedMayraCongratsEmi = uniqueMayraCongratsEmi.map((payment) => ({
      form_number: payment.mayraCongratulations.mayraNumber,
      name: payment.mayraCongratulations.applicantName,
      payment_mode: "EMI",
      amount: Number(payment.amount),
      date: formatDate(payment.mayraCongratulations.date),
    }));

    const formattedLoanRepayments = loanRepayments.map((inst) => ({
      form_number: inst.loanApplication.formNumber || "",
      name: inst.loanApplication.applicantName,
      payment_mode: "Repayment",
      amount: Number(inst.amount),
      date: formatDate(inst.date),
    }));

    const formattedFinancialHelps = financialHelps.map((record) => ({
      form_number: record.formNumber,
      name: record.name,
      payment_mode: "Donation",
      amount: Number(record.donatedAmount),
      date: formatDate(record.date),
    }));

    const formattedFinancialHelpInstallments = financialHelpInstallments.map((inst) => ({
      form_number: inst.financialHelp.formNumber,
      name: inst.financialHelp.name,
      payment_mode: "Installment",
      amount: Number(inst.amount),
      date: formatDate(inst.date),
    }));

    const formattedPensionPayments = pensionPayments.map((payment) => ({
      form_number: payment.pensionYojana.formNumber || "",
      name: payment.pensionYojana.name,
      payment_mode: "Pension Payment",
      amount: Number(payment.amount),
      date: formatDate(payment.date),
    }));

    return {
      success: true,
      applications: formattedApps,
      application_installments: formattedInst,
      insurances: formattedInsurances,
      insurance_installments: formattedInsInst,
      suraksha_bima_yojana: formattedSurakshaBima,
      suraksha_bima_emi: formattedSurakshaBimaEmi,
      marriage_congratulations: formattedMarriageCongrats,
      marriage_congratulations_emi: formattedMarriageCongratsEmi,
      mayra_applications: formattedMayraApplications,
      mayra_installments: formattedMayraInstallments,
      mayra_congratulations: formattedMayraCongrats,
      mayra_congratulations_emi: formattedMayraCongratsEmi,
      loan_repayments: formattedLoanRepayments,
      financial_helps: formattedFinancialHelps,
      financial_help_installments: formattedFinancialHelpInstallments,
      pension_payments: formattedPensionPayments,
    };
  }

  /**
   * Save agent commission payout record
   */
  public async payAgentCommission(
    agentId: string,
    amount: number,
    startDate: Date,
    endDate: Date,
    adminId: string
  ) {
    // Check agent exists
    const agent = await prisma.user.findFirst({
      where: { id: agentId, role: "AGENT", deletedAt: null },
    });

    if (!agent) {
      throw new NotFoundError("Agent not found");
    }

    const payout = await prisma.agentPayment.create({
      data: {
        agentId,
        amount,
        startDate,
        endDate,
        addedById: adminId,
      },
    });

    await recordLegacyPaymentEntry(prisma, {
      legacyId: payout.id,
      date: payout.paymentDate,
      amount: payout.amount,
      name: agent.name,
      source: "agent_payouts",
      type: "Out",
    });

    return payout;
  }

  /**
   * List commission payout history for an agent
   */
  public async getAgentPaymentsForDetails(agentId: string) {
    const agent = await prisma.user.findFirst({
      where: { id: agentId, role: "AGENT", deletedAt: null },
    });

    if (!agent) {
      throw new NotFoundError("Agent not found");
    }

    const payments = await prisma.agentPayment.findMany({
      where: { agentId, deletedAt: null },
      orderBy: { paymentDate: "desc" },
    });

    return {
      success: true,
      payments: payments.map((payment) => ({
        id: payment.id,
        agentId: payment.agentId,
        startDate: payment.startDate.toISOString().slice(0, 10),
        endDate: payment.endDate.toISOString().slice(0, 10),
        amount: String(payment.amount),
        paymentDate: payment.paymentDate.toISOString().slice(0, 10),
      })),
    };
  }

  // ── RAZORPAY ORDERS ────────────────────────────────

  /**
   * Generate Razorpay order for online payment gateway flow
   */
  public async createRazorpayOrder(amountInRupees: number, receipt?: string) {
    const amountInPaise = Math.round(amountInRupees * 100);

    const options = {
      amount: amountInPaise,
      currency: "INR",
      receipt: receipt || `rec_${Date.now()}`,
    };

    try {
      const order = await razorpay.orders.create(options);
      return order;
    } catch (error: any) {
      throw new BadRequestError(`Razorpay Order Creation Failed: ${error.message}`);
    }
  }

  /**
   * Verify HMAC-SHA256 signature from Razorpay checkout completion
   */
  public async verifyRazorpayPayment(
    orderId: string,
    paymentId: string,
    signature: string
  ) {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      throw new BadRequestError("Razorpay key secret is not configured in backend env");
    }

    const payload = `${orderId}|${paymentId}`;
    const generatedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(payload)
      .digest("hex");

    if (generatedSignature !== signature) {
      throw new BadRequestError("Invalid payment signature. Verification failed.");
    }

    return {
      success: true,
      message: "Payment signature verified successfully",
    };
  }
}
