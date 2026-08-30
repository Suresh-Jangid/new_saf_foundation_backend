import { Request, Response, NextFunction } from "express";
import { ApplicationsService } from "./applications.service";
import { AuthenticatedRequest } from "../../middlewares/auth";
import { prisma } from "../../config/db";
import { recordLegacyPaymentEntry, formatEmiContributionName } from "../../utils/legacy-payment-entry";

const service = new ApplicationsService();

// Fixed per-member EMI for Suraksha Bima Yojana. NOTE: SurakshaBimaYojana.rate200
// is NOT a rate — despite the name, it stores the pool's member count (see
// suraksha-bima-yojana add form: "rate200 = memberCount"). It must never be
// read as the per-installment EMI amount.
const SURAKSHA_BIMA_EMI_AMOUNT = 200;

export class ApplicationsController {
  
  // ==========================================
  // GENERAL APPLICATIONS
  // ==========================================

  public async createGeneralApplication(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const addedById = req.user?.userId || "";
      const result = await service.createGeneralApplication(req.body, addedById, req.user?.role);
      res.status(201).json({
        success: true,
        message: "General Application added successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  public async bulkImportGeneralApplications(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const addedById = req.user?.userId || "";
      if (req.user?.role !== "ADMIN") {
        res.status(403).json({ success: false, message: "Only ADMIN can perform bulk upload." });
        return;
      }

      const { rows } = req.body;
      if (!Array.isArray(rows)) {
        res.status(400).json({ success: false, message: "Invalid payload: 'rows' must be an array." });
        return;
      }

      const result = await service.bulkImportGeneralApplications(rows, addedById);
      res.status(200).json({
        success: true,
        message: "Bulk import processed successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }


  public async getAllGeneralApplications(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await service.getAllGeneralApplications(req.query);
      if (result && typeof result === "object" && "meta" in result) {
        res.status(200).json({
          success: true,
          status: true,
          data: result.data,
          meta: result.meta,
        });
      } else {
        res.status(200).json({
          success: true,
          status: true,
          data: result,
        });
      }
    } catch (error) {
      next(error);
    }
  }

  public async getGeneralApplicationById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await service.getGeneralApplicationById(id);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  public async updateGeneralApplication(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await service.updateGeneralApplication(id, req.body);
      res.status(200).json({
        success: true,
        message: "General Application updated successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  public async softDeleteGeneralApplication(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await service.softDeleteGeneralApplication(id);
      res.status(200).json({
        success: true,
        message: "General Application deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  public async addGeneralInstallment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params; // Application ID
      const addedById = req.user?.userId || "";
      const result = await service.addGeneralInstallment(id, req.body, addedById);
      res.status(201).json({
        success: true,
        message: "Installment recorded successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  // ==========================================
  // INSURANCE APPLICATIONS
  // ==========================================

  public async createInsuranceApplication(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const addedById = req.user?.userId || "";
      const result = await service.createInsuranceApplication(req.body, addedById, req.user?.role);
      res.status(201).json({
        success: true,
        message: "Insurance Application added successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  public async getAllInsuranceApplications(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await service.getAllInsuranceApplications(req.query);
      if (result && typeof result === "object" && "meta" in result) {
        res.status(200).json({
          success: true,
          status: true,
          data: result.data,
          meta: result.meta,
        });
      } else {
        res.status(200).json({
          success: true,
          status: true,
          data: result,
        });
      }
    } catch (error) {
      next(error);
    }
  }

  public async getInsuranceApplicationById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await service.getInsuranceApplicationById(id);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  public async softDeleteInsuranceApplication(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await service.softDeleteInsuranceApplication(id);
      res.status(200).json({
        success: true,
        message: "Insurance Application deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  public async addInsuranceInstallment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params; // Insurance Application ID
      const addedById = req.user?.userId || "";
      const result = await service.addInsuranceInstallment(id, req.body, addedById);
      res.status(201).json({
        success: true,
        message: "Installment recorded successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  public async createSurakshaBima(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params; // Insurance Application ID
      const result = await service.createSurakshaBima(id, req.body);
      res.status(201).json({
        success: true,
        message: "Suraksha Bima Yojana details configured successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  public async getInsuranceBulkData(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { userId, fromDate, toDate } = req.query;
      if (!userId) {
        res.status(400).json({ success: false, message: "Missing userId query parameter" });
        return;
      }

      const applications = await prisma.insuranceApplication.findMany({
        where: {
          OR: (() => {
            const conditions: any[] = [
              { formNumber: { contains: String(userId), mode: "insensitive" } },
              { applicantName: { contains: String(userId), mode: "insensitive" } },
            ];
            if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(userId))) {
              conditions.push({ id: String(userId) });
            }
            return conditions;
          })(),
          deletedAt: null,
          isActive: true
        }
      });
      if (applications.length === 0) {
        res.status(404).json({ success: false, message: "No member found" });
        return;
      }

      const payer = applications[0];
      const whereClause: any = { deletedAt: null };
      if (fromDate || toDate) {
        whereClause.date = {};
        if (fromDate) {
          whereClause.date.gte = new Date(String(fromDate));
        }
        if (toDate) {
          whereClause.date.lte = new Date(String(toDate));
        }
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

      const mappedBimas = [];
      for (const bima of bimaRecords) {
        const payment = await prisma.insuranceApplicationInstallment.findFirst({
          where: {
            applicationInsuranceId: payer.id,
            note: {
              startsWith: `BIMA_PAYMENT:${bima.id}`
            },
            deletedAt: null
          }
        });

        mappedBimas.push({
          id: bima.id,
          bimaNumber: bima.bimaNumber,
          applicantName: bima.applicantName,
          fatherName: bima.fatherName || bima.insuranceApplication?.fatherName || "",
          date: bima.date,
          gender: "Female",
          emiAmount: SURAKSHA_BIMA_EMI_AMOUNT,
          payment_status: payment ? 1 : 0,
          filter_payment_status: payment ? 1 : 0,
          filter_row_id: payment?.id || bima.id,
          pdf_created: 0,
          tehsil: bima.address
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
          emiAmount: Number(payer.totalAmount || 0)
        },
        bimaEmis: mappedBimas
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  public async updateBimaPaymentStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { insurance_id, data: items, payment_mode, addedby_id } = req.body;
      const addedById = req.user?.userId || "";

      const payerApp = await prisma.insuranceApplication.findFirst({
        where: {
          OR: [
            { id: String(insurance_id) },
            { formNumber: String(insurance_id) }
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
          message: "This member is inactive (Suraksha Bima Yojana already recorded) and cannot receive further bima EMI payments"
        });
        return;
      }

      let updated = 0;
      let failed = 0;
      const details = [];

      for (const item of items) {
        try {
          const bima = await prisma.surakshaBimaYojana.findUnique({
            where: { id: item.id }
          });
          if (!bima) {
            details.push({ bimaNumber: "", status: "failed" });
            failed++;
            continue;
          }

          const emiAmount = SURAKSHA_BIMA_EMI_AMOUNT;
          const paymentDate = new Date();

          const installment = await prisma.insuranceApplicationInstallment.create({
            data: {
              applicationInsuranceId: payerApp.id,
              amount: emiAmount,
              date: paymentDate,
              note: `BIMA_PAYMENT:${bima.id} - ${bima.bimaNumber}`,
              paymentMode: payment_mode === "razorpay" ? "ONLINE" : (payment_mode || "CASH"),
              addedById: addedById || addedby_id || ""
            }
          });

          await recordLegacyPaymentEntry(prisma, {
            legacyId: installment.id,
            date: paymentDate,
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

      res.status(200).json({
        success: true,
        updated,
        failed,
        details
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  public async updateInsurancePdfStatus(_req: Request, res: Response, next: NextFunction) {
    try {
      res.status(200).json({ success: true, message: "PDF status updated" });
      return;
    } catch (error) {
      next(error);
    }
  }
}
