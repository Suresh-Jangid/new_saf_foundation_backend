import { Response, NextFunction } from "express";
import { SchemesService } from "./schemes.service";
import { AuthenticatedRequest } from "../../middlewares/auth";
import { prisma } from "../../config/db";
import { parseDateInput } from "../../utils/parse-date";
import { isValidUuid } from "../../utils/compat-helpers";
import { recordLegacyPaymentEntry, formatEmiContributionName } from "../../utils/legacy-payment-entry";

const service = new SchemesService();

export class SchemesController {
  
  // ── LOANS ──────────────────────────────────────────

  public async createLoan(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const addedById = req.user?.userId || "";
      const result = await service.createLoan(req.body, addedById, req.user?.role);
      res.status(201).json({ success: true, message: "Loan application created", data: result });
    } catch (error) {
      next(error);
    }
  }

  public async getAllLoans(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await service.getAllLoans(req.query);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  public async getLoanById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await service.getLoanById(req.params.id);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  public async addLoanInstallment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const addedById = req.user?.userId || "";
      const result = await service.addLoanInstallment(req.params.id, req.body, addedById);
      res.status(201).json({ success: true, message: "Loan installment added", data: result });
    } catch (error) {
      next(error);
    }
  }

  // ── FINANCIAL HELP ─────────────────────────────────

  public async createFinancialHelp(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const addedById = req.user?.userId || "";
      const result = await service.createFinancialHelp(req.body, addedById, req.user?.role);
      res.status(201).json({ success: true, message: "Financial help record created", data: result });
    } catch (error) {
      next(error);
    }
  }

  public async getAllFinancialHelps(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await service.getAllFinancialHelps(req.query);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // ── DISABILITY CYCLE ──────────────────────────────

  public async createDisabilityCycle(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const addedById = req.user?.userId || "";
      const result = await service.createDisabilityCycle(req.body, addedById, req.user?.role);
      res.status(201).json({ success: true, message: "Disability cycle request created", data: result });
    } catch (error) {
      next(error);
    }
  }

  public async getAllDisabilityCycles(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await service.getAllDisabilityCycles(req.query);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // ── MARRIAGE CONGRATULATIONS ───────────────────────

  public async createMarriageCongratulations(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const addedById = req.user?.userId || "";
      const result = await service.createMarriageCongratulations(req.body, addedById, req.user?.role);
      res.status(201).json({ success: true, message: "Marriage Congratulations created", data: result });
    } catch (error) {
      next(error);
    }
  }

  public async getAllMarriageCongratulations(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await service.getAllMarriageCongratulations(req.query);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  public async getMarriageCongratulationsById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await service.getMarriageCongratulationsById(req.params.id);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  public async addMarriageCongratulationsPayment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const addedById = req.user?.userId || "";
      const result = await service.addMarriageCongratulationsPayment(req.params.id, req.body, addedById);
      res.status(201).json({ success: true, message: "Payout added", data: result });
    } catch (error) {
      next(error);
    }
  }

  public async addMarriageSewingMachine(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const addedById = req.user?.userId || "";
      const result = await service.addMarriageSewingMachine(req.params.id, req.body, addedById);
      res.status(201).json({ success: true, message: "Sewing machine request added", data: result });
    } catch (error) {
      next(error);
    }
  }

  // ── PENSION YOJANA ─────────────────────────────────

  public async createPensionYojana(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const addedById = req.user?.userId || "";
      const result = await service.createPensionYojana(req.body, addedById, req.user?.role);
      res.status(201).json({ success: true, message: "Pension beneficiary registered", data: result });
    } catch (error) {
      next(error);
    }
  }

  public async getAllPensionYojanas(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await service.getAllPensionYojanas(req.query);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  public async getPensionYojanaById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await service.getPensionYojanaById(req.params.id);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  public async addPensionPayment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const addedById = req.user?.userId || "";
      const result = await service.addPensionPayment(req.params.id, req.body, addedById);
      res.status(201).json({ success: true, message: "Pension payout registered", data: result });
    } catch (error) {
      next(error);
    }
  }

  // ── SEWING MACHINE CAMPS ──────────────────────────

  public async createSewingMachineCamp(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const addedById = req.user?.userId || "";
      const result = await service.createSewingMachineCamp(req.body, addedById, req.user?.role);
      res.status(201).json({ success: true, message: "Sewing machine camp application created", data: result });
    } catch (error) {
      next(error);
    }
  }

  public async getAllSewingMachineCamps(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await service.getAllSewingMachineCamps(req.query);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  public async getMarriageCongratulationsMembers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await service.getMarriageCongratulationsMembers(req.params.id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  public async getMarriageCongratulationsPayments(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await service.getMarriageCongratulationsPayments(req.params.id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  public async deleteMarriageCongratulationsPayment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await service.deleteMarriageCongratulationsPayment(req.params.paymentId);
      res.status(200).json({ success: true, message: "Payment deleted successfully", data: result });
    } catch (error) {
      next(error);
    }
  }

  public async getMarriageCongratulationsDetails(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const marriageCongratsId = req.params.id;
      const appId = req.query.application_id as string;
      const date = req.query.date as string;
      let details: any = null;

      if (marriageCongratsId && marriageCongratsId !== "undefined") {
        try {
          details = await service.getMarriageCongratulationsById(marriageCongratsId);
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
        res.status(404).json({ success: false, message: "Application or congratulations record not found" });
        return;
      }

      let linkedApplicationId: string | undefined = appId;
      if (!linkedApplicationId && marriageCongratsId && details?.codeNumber) {
        const linkedApp = await prisma.generalApplication.findFirst({
          where: { formNumber: details.codeNumber, deletedAt: null },
          select: { id: true },
        });
        linkedApplicationId = linkedApp?.id || undefined;
      }
      if (!linkedApplicationId) {
        linkedApplicationId = details?.id || undefined;
      }

      const targetDate = date ? parseDateInput(date) : new Date();

      const memberGenderRaw = String(details?.gender || "").trim().toLowerCase();
      const memberGender =
        memberGenderRaw === "male"
          ? "Male"
          : memberGenderRaw === "female"
            ? "Female"
            : null;

      const activeMembers = await prisma.generalApplication.findMany({
        where: {
          id: linkedApplicationId ? { not: linkedApplicationId } : undefined,
          applicationDate: { lte: targetDate },
          deletedAt: null,
          isActive: true,
          ...(memberGender ? { gender: memberGender as any } : {})
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

        const targetDateStr = targetDate instanceof Date 
          ? targetDate.toISOString().split('T')[0] 
          : String(targetDate);
        const targetDateNormalized = parseDateInput(targetDateStr);

        const endOfTargetDate = new Date(targetDateNormalized);
        endOfTargetDate.setUTCHours(23, 59, 59, 999);

        otherMarriagesCount = await prisma.marriageCongratulations.count({
          where: {
            date: {
              gte: joinDate,
              lte: endOfTargetDate
            },
            id: marriageCongratsId && isValidUuid(marriageCongratsId) ? { not: marriageCongratsId } : undefined,
            deletedAt: null
          }
        });
      }

      const totalEMI = (otherMarriagesCount + 1) * rate;

      res.status(200).json({
        success: true,
        data: details,
        counts,
        totalEMI
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  public async getMarriageCongratulationsBulkData(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { userId } = req.query;
      if (!userId) {
        res.status(400).json({ success: false, message: "Missing userId query parameter" });
        return;
      }

      const applications = await prisma.generalApplication.findMany({
        where: {
          OR: [
            { id: String(userId) },
            { formNumber: { contains: String(userId), mode: "insensitive" } },
            { applicantName: { contains: String(userId), mode: "insensitive" } }
          ],
          deletedAt: null,
          isActive: true
        }
      });
      if (applications.length === 0) {
        res.status(404).json({ success: false, message: "No member found" });
        return;
      }

      const payer = applications[0];
      const congratsRecords = await prisma.marriageCongratulations.findMany({
        where: { deletedAt: null },
        orderBy: { date: "desc" }
      });

      const mappedRecords = [];
      for (const congrats of congratsRecords) {
        const payment = await prisma.marriageCongratulationsPayment.findFirst({
          where: {
            marriageCongratulationsId: congrats.id,
            applicationId: payer.id,
            deletedAt: null
          }
        });

        const emiAmount = payer.category === "A" ? Number(congrats.rate100) : payer.category === "B" ? Number(congrats.rate200) : Number(congrats.rate300);

        mappedRecords.push({
          id: congrats.id,
          marriageNumber: congrats.marriageNumber,
          applicantName: congrats.applicantName,
          fatherName: congrats.fatherName,
          date: congrats.date,
          emiAmount,
          payment_status: payment ? 1 : 0,
          filter_payment_status: payment ? 1 : 0,
          filter_row_id: payment?.id || congrats.id,
          pdf_created: 0,
          tehsil: congrats.address
        });
      }

      res.status(200).json({
        success: true,
        payer: {
          id: payer.id,
          formNumber: payer.formNumber,
          applicantName: payer.applicantName,
          fatherName: payer.fatherName,
          gotra: payer.gotra,
          address: payer.address,
          category: payer.category,
          gender: payer.gender,
          mobile: payer.mobile,
          emiAmount: payer.category === "A" ? 100 : payer.category === "B" ? 200 : 300
        },
        records: mappedRecords
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  public async updateMarriageCongratulationsBulkPayments(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { application_id, data: items } = req.body;
      const addedById = req.user?.userId || "";

      const payerApp = await prisma.generalApplication.findFirst({
        where: {
          OR: [
            { id: String(application_id) },
            { formNumber: String(application_id) }
          ],
          deletedAt: null
        }
      });
      if (!payerApp) {
        res.status(404).json({ success: false, message: "Payer application not found" });
        return;
      }
      if (!payerApp.isActive) {
        res.status(400).json({
          success: false,
          message: "This member is inactive (marriage already recorded) and cannot receive further marriage EMI payments"
        });
        return;
      }

      let updated = 0;
      const details = [];

      for (const item of items) {
        try {
          const congrats = await prisma.marriageCongratulations.findUnique({
            where: { id: item.id }
          });
          if (!congrats) {
            details.push({ marriageNumber: "", status: "failed" });
            continue;
          }

          const emiAmount = payerApp.category === "A" ? congrats.rate100 : payerApp.category === "B" ? congrats.rate200 : congrats.rate300;

          const marriagePayment = await prisma.marriageCongratulationsPayment.create({
            data: {
              marriageCongratulationsId: congrats.id,
              applicationId: payerApp.id,
              category: payerApp.category,
              amount: emiAmount,
              addedById: item.addedby_id || addedById || ""
            }
          });

          await recordLegacyPaymentEntry(prisma, {
            legacyId: marriagePayment.id,
            date: marriagePayment.createdAt,
            amount: emiAmount,
            name: formatEmiContributionName(
              [payerApp.formNumber, payerApp.applicantName, payerApp.address],
              { name: congrats.applicantName, code: congrats.codeNumber, scheme: "marriage" }
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

      res.status(200).json({
        success: true,
        updated,
        failed: items.length - updated,
        details
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  public async updateMarriageCongratulationsPdfStatus(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      res.status(200).json({ success: true, message: "PDF status updated" });
      return;
    } catch (error) {
      next(error);
    }
  }
}
