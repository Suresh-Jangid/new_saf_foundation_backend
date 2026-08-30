import { Request, Response, NextFunction } from "express";
import { MayraService } from "./mayra.service";
import { AuthenticatedRequest } from "../../middlewares/auth";
import { prisma } from "../../config/db";
import { recordLegacyPaymentEntry, formatEmiContributionName } from "../../utils/legacy-payment-entry";

const service = new MayraService();

export class MayraController {
  
  public async createMayraRegistration(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const addedById = req.user?.userId || "";
      const result = await service.createMayraRegistration(req.body, addedById, req.user?.role);
      res.status(201).json({
        success: true,
        message: "Mayra Registration created successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  public async getAllMayraRegistrations(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await service.getAllMayraRegistrations(req.query);
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

  public async getMayraRegistrationById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await service.getMayraRegistrationById(id);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  public async updateMayraRegistration(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await service.updateMayraRegistration(id, req.body);
      res.status(200).json({
        success: true,
        message: "Mayra Registration updated successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  public async softDeleteMayraRegistration(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await service.softDeleteMayraRegistration(id);
      res.status(200).json({
        success: true,
        message: "Mayra Registration deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  public async addMayraInstallment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params; // Mayra Registration ID
      const addedById = req.user?.userId || "";
      const result = await service.addMayraInstallment(id, req.body, addedById);
      res.status(201).json({
        success: true,
        message: "Installment recorded successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  public async createMayraCongratulations(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params; // Mayra Registration ID
      const addedById = req.user?.userId || "";
      const result = await service.createMayraCongratulations(id, req.body, addedById);
      res.status(201).json({
        success: true,
        message: "Congratulations record bound successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  public async addMayraCongratulationsPayment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params; // Mayra Congratulations ID
      const addedById = req.user?.userId || "";
      const result = await service.addMayraCongratulationsPayment(id, req.body, addedById);
      res.status(201).json({
        success: true,
        message: "Payout record added successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  public async getMayraCongratulationsMembers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params; // Mayra Registration ID (passed as user.mayra_id in frontend)
      const result = await service.getMayraCongratulationsMembers(id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  public async getMayraCongratulationsPayments(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params; // Mayra Registration ID
      const result = await service.getMayraCongratulationsPayments(id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  public async deleteMayraCongratulationsPayment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { paymentId } = req.params;
      const result = await service.deleteMayraCongratulationsPayment(paymentId);
      res.status(200).json({ success: true, message: "Payment deleted successfully", data: result });
    } catch (error) {
      next(error);
    }
  }

  public async getMayraCongratulationsDetails(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const mayraId = req.params.id;
      const date = req.query.date as string;
      
      let details: any = null;
      let congrats = await prisma.mayraCongratulations.findFirst({
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

      if (congrats) {
        details = congrats;
      } else {
        const reg = await prisma.mayraRegistration.findUnique({
          where: { id: mayraId }
        });
        if (reg) {
          details = {
            id: reg.id,
            applicantName: reg.applicantName,
            fatherName: reg.fatherName,
            nomineeName: reg.nomineeName,
            gotra: reg.gotra,
            address: reg.address,
            applicationDate: reg.applicationDate,
            gender: reg.gender,
          };
        }
      }

      if (!details) {
        res.status(404).json({ success: false, message: "Mayra registration or congratulations record not found" });
        return;
      }

      const targetDate = date ? new Date(date) : new Date();

      // Filter by the applicant's gender (same as marriage congratulations):
      // a female applicant's form counts female Mayra members, male counts male.
      const memberGenderRaw = String(details?.gender || "").trim().toLowerCase();
      const memberGender =
        memberGenderRaw === "male"
          ? "Male"
          : memberGenderRaw === "female"
            ? "Female"
            : null;

      // Use groupBy+_count for an efficient single SQL GROUP BY.
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

  public async getMayraBulkData(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { userId } = req.query;
      if (!userId) {
        res.status(400).json({ success: false, message: "Missing userId query parameter" });
        return;
      }

      const applications = await prisma.generalApplication.findMany({
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
      const congratsRecords = await prisma.mayraCongratulations.findMany({
        where: { deletedAt: null },
        orderBy: { date: "desc" }
      });

      const mappedMayras = [];
      for (const congrats of congratsRecords) {
        const payment = await prisma.mayraCongratulationsPayment.findFirst({
          where: {
            mayraCongratulationsId: congrats.id,
            applicationId: payer.id,
            deletedAt: null
          }
        });

        const emiAmount = payer.category === "B" ? Number(congrats.rate200) : payer.category === "C" ? Number(congrats.rate300) : 0;

        mappedMayras.push({
          id: congrats.id,
          mayraNumber: congrats.mayraNumber,
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
        mayras: mappedMayras
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  public async updateMayraBulkPayments(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { mayra_id, data: items } = req.body;
      const addedById = req.user?.userId || "";

      const payerApp = await prisma.generalApplication.findFirst({
        where: {
          OR: [
            { id: String(mayra_id) },
            { formNumber: String(mayra_id) }
          ],
          deletedAt: null
        }
      });
      if (!payerApp) {
        res.status(404).json({ success: false, message: "Payer application not found" });
        return;
      }

      let updated = 0;
      const details = [];

      for (const item of items) {
        try {
          const congrats = await prisma.mayraCongratulations.findUnique({
            where: { id: item.id }
          });
          if (!congrats) {
            details.push({ mayraNumber: "", status: "failed" });
            continue;
          }

          const emiAmount = payerApp.category === "B" ? congrats.rate200 : payerApp.category === "C" ? congrats.rate300 : 0;

          const mayraPayment = await prisma.mayraCongratulationsPayment.create({
            data: {
              mayraCongratulationsId: congrats.id,
              applicationId: payerApp.id,
              category: payerApp.category,
              amount: emiAmount,
              addedById: item.addedby_id || addedById || ""
            }
          });

          await recordLegacyPaymentEntry(prisma, {
            legacyId: mayraPayment.id,
            date: mayraPayment.createdAt,
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

  public async updateMayraPdfStatus(_req: Request, res: Response, next: NextFunction) {
    try {
      res.status(200).json({ success: true, message: "PDF status updated" });
      return;
    } catch (error) {
      next(error);
    }
  }
}
