import { Request, Response, NextFunction } from "express";
import { DocumentsService } from "./documents.service";

const service = new DocumentsService();

export class DocumentsController {
  
  public async generateGeneralPDF(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { buffer: pdfBuffer, fileName } = await service.generateGeneralApplicationBond(id);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
      res.send(pdfBuffer);
    } catch (error) {
      next(error);
    }
  }

  public async generateMayraPDF(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const pdfBuffer = await service.generateMayraApplicationPDF(id);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=mayra-application-${id}.pdf`);
      res.send(pdfBuffer);
    } catch (error) {
      next(error);
    }
  }

  public async generateInsurancePDF(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const pdfBuffer = await service.generateInsuranceApplicationPDF(id);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=insurance-application-${id}.pdf`);
      res.send(pdfBuffer);
    } catch (error) {
      next(error);
    }
  }

  public async generateBondPDF(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const pdfBuffer = await service.generateBondPDF(id);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=bond-${id}.pdf`);
      res.send(pdfBuffer);
    } catch (error) {
      next(error);
    }
  }
}
