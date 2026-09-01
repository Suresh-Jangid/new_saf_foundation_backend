import path from "path";
import fs from "fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "../../config/db";
import { NotFoundError } from "../../utils/errors";
import { PDFHelper, PDFTextField, drawDevanagariText } from "../../utils/pdf";

export class DocumentsService {
  /**
   * Generates General Application PDF
   */
  public async generateGeneralApplicationPDF(id: string): Promise<Buffer> {
    const app = await prisma.generalApplication.findFirst({
      where: { id, deletedAt: null },
      include: { addedBy: true },
    });

    if (!app) {
      throw new NotFoundError("General Application not found");
    }

    const templatePath = path.join(
      process.cwd(),
      "assets",
      "templates",
      "general_app_template.pdf"
    );

    const fields: PDFTextField[] = [
      { text: app.formNumber, x: 480, y: 735, size: 12 },
      { text: app.applicationDate.toLocaleDateString("en-IN"), x: 480, y: 715, size: 10 },
      { text: app.applicantName, x: 180, y: 645, size: 12 },
      { text: app.fatherName, x: 180, y: 615, size: 12 },
      { text: app.motherName, x: 180, y: 585, size: 12 },
      { text: app.dateOfBirth.toLocaleDateString("en-IN"), x: 180, y: 555, size: 12 },
      { text: app.gender, x: 420, y: 555, size: 12 },
      { text: app.gotra, x: 180, y: 525, size: 12 },
      { text: app.category, x: 420, y: 525, size: 12 },
      { text: app.aadharNumber, x: 180, y: 495, size: 12 },
      { text: app.mobile, x: 420, y: 495, size: 12 },
      { text: app.address, x: 180, y: 465, size: 10 },
      { text: `${app.tehsil}, ${app.district}, ${app.state}`, x: 180, y: 435, size: 10 },
      { text: app.pinCode, x: 420, y: 435, size: 12 },
      { text: app.nomineeName || "N/A", x: 180, y: 405, size: 12 },
      { text: app.nomineeRelation || "N/A", x: 420, y: 405, size: 12 },
      { text: `Rs. ${Number(app.totalAmount).toLocaleString("en-IN")}`, x: 180, y: 375, size: 12 },
      { text: `Rs. ${Number(app.pendingAmount).toLocaleString("en-IN")}`, x: 420, y: 375, size: 12 },
      { text: app.addedBy?.name || "N/A", x: 180, y: 345, size: 12 },
    ];

    if (fs.existsSync(templatePath)) {
      return PDFHelper.drawFieldsOnPDF(templatePath, fields);
    } else {
      return this.generatePDFFromScratch("General Application Form", fields);
    }
  }

  /**
   * Generates Insurance Application PDF (Suraksha Bima Bond)
   */
  public async generateInsuranceApplicationPDF(id: string): Promise<Buffer> {
    const app = await prisma.insuranceApplication.findFirst({
      where: { id, deletedAt: null },
      include: { addedBy: true },
    });

    if (!app) {
      throw new NotFoundError("Insurance Application not found");
    }

    const templatePath = path.join(
      process.cwd(),
      "assets",
      "templates",
      "insurance_app_template.pdf"
    );

    const fields: PDFTextField[] = [
      { text: app.formNumber, x: 480, y: 735, size: 12 },
      { text: app.applicationDate.toLocaleDateString("en-IN"), x: 480, y: 715, size: 10 },
      { text: app.applicantName, x: 180, y: 645, size: 12 },
      { text: app.fatherName, x: 180, y: 615, size: 12 },
      { text: app.wifeName || app.motherName || "N/A", x: 180, y: 585, size: 12 },
      { text: app.dateOfBirth.toLocaleDateString("en-IN"), x: 180, y: 555, size: 12 },
      { text: app.gender, x: 420, y: 555, size: 12 },
      { text: app.gotra, x: 180, y: 525, size: 12 },
      { text: app.category, x: 420, y: 525, size: 12 },
      { text: app.aadharNumber, x: 180, y: 495, size: 12 },
      { text: app.mobile, x: 420, y: 495, size: 12 },
      { text: app.address, x: 180, y: 465, size: 10 },
      { text: `${app.tehsil}, ${app.district}, ${app.state}`, x: 180, y: 435, size: 10 },
      { text: app.pinCode, x: 420, y: 435, size: 12 },
      { text: app.nomineeName || "N/A", x: 180, y: 405, size: 12 },
      { text: app.nomineeRelation || "N/A", x: 420, y: 405, size: 12 },
      { text: `Rs. ${Number(app.totalAmount).toLocaleString("en-IN")}`, x: 180, y: 375, size: 12 },
      { text: `Rs. ${Number(app.pendingAmount).toLocaleString("en-IN")}`, x: 420, y: 375, size: 12 },
      { text: app.addedBy?.name || "N/A", x: 180, y: 345, size: 12 },
    ];

    if (fs.existsSync(templatePath)) {
      return PDFHelper.drawFieldsOnPDF(templatePath, fields);
    } else {
      return this.generatePDFFromScratch("Suraksha Bima Application Form", fields);
    }
  }

  /**
   * Generates Mayra Application PDF
   */
  public async generateMayraApplicationPDF(id: string): Promise<Buffer> {
    const reg = await prisma.mayraRegistration.findFirst({
      where: { id, deletedAt: null },
      include: { addedBy: true },
    });

    if (!reg) {
      throw new NotFoundError("Mayra Registration not found");
    }

    const templatePath = path.join(
      process.cwd(),
      "assets",
      "templates",
      "mayra_app_template.pdf"
    );

    const fields: PDFTextField[] = [
      { text: reg.formNumber, x: 480, y: 735, size: 12 },
      { text: reg.applicationDate.toLocaleDateString("en-IN"), x: 480, y: 715, size: 10 },
      { text: reg.applicantName, x: 180, y: 645, size: 12 },
      { text: reg.fatherName, x: 180, y: 615, size: 12 },
      { text: reg.motherName, x: 180, y: 585, size: 12 },
      { text: reg.dateOfBirth.toLocaleDateString("en-IN"), x: 180, y: 555, size: 12 },
      { text: reg.gender, x: 420, y: 555, size: 12 },
      { text: reg.gotra, x: 180, y: 525, size: 12 },
      { text: reg.aadharNumber, x: 180, y: 495, size: 12 },
      { text: reg.mobile, x: 420, y: 495, size: 12 },
      { text: reg.address, x: 180, y: 465, size: 10 },
      { text: `${reg.tehsil}, ${reg.district}`, x: 180, y: 435, size: 10 },
      { text: reg.pinCode, x: 420, y: 435, size: 12 },
      { text: reg.nomineeName, x: 180, y: 405, size: 12 },
      { text: reg.nomineeRelation, x: 420, y: 405, size: 12 },
      { text: reg.workerName, x: 180, y: 375, size: 12 },
      { text: reg.workerMobile || "N/A", x: 420, y: 375, size: 12 },
    ];

    if (fs.existsSync(templatePath)) {
      return PDFHelper.drawFieldsOnPDF(templatePath, fields);
    } else {
      return this.generatePDFFromScratch("Mayra Application Form", fields);
    }
  }

  /**
   * Generates Bond PDF (Mayra Congratulations)
   */
  public async generateBondPDF(id: string): Promise<Buffer> {
    const bond = await prisma.mayraCongratulations.findFirst({
      where: { id },
    });

    if (!bond) {
      throw new NotFoundError("Bond Congratulations details not found");
    }

    const templatePath = path.join(
      process.cwd(),
      "assets",
      "templates",
      "bond_template.pdf"
    );

    const fields: PDFTextField[] = [
      { text: bond.codeNumber, x: 200, y: 680, size: 12 },
      { text: bond.mayraNumber, x: 450, y: 680, size: 12 },
      { text: bond.date.toLocaleDateString("en-IN"), x: 450, y: 650, size: 10 },
      { text: bond.applicantName, x: 200, y: 600, size: 14 },
      { text: bond.fatherName, x: 200, y: 570, size: 12 },
      { text: bond.gotra, x: 200, y: 540, size: 12 },
      { text: bond.address, x: 200, y: 510, size: 10 },
      { text: bond.membershipJoinDate.toLocaleDateString("en-IN"), x: 200, y: 470, size: 12 },
      { text: bond.associatedUntil, x: 450, y: 470, size: 12 },
      { text: `Rs. ${Number(bond.permanentFee).toLocaleString("en-IN")}`, x: 200, y: 430, size: 12 },
      { text: `Rs. ${Number(bond.installmentAmount).toLocaleString("en-IN")}`, x: 450, y: 430, size: 12 },
      { text: `Rs. ${Number(bond.totalGrantAmount).toLocaleString("en-IN")}`, x: 200, y: 390, size: 12 },
      { text: bond.totalMembersServing.toString(), x: 450, y: 390, size: 12 },
      { text: `Rs. ${Number(bond.totalPaidAmount).toLocaleString("en-IN")}`, x: 200, y: 330, size: 14 },
    ];

    if (fs.existsSync(templatePath)) {
      return PDFHelper.drawFieldsOnPDF(templatePath, fields);
    } else {
      return this.generatePDFFromScratch("Membership Grant Bond (Patra)", fields);
    }
  }

  /**
   * Fallback method to compile PDF from scratch using standard layouts
   */
  private async generatePDFFromScratch(
    title: string,
    fields: PDFTextField[]
  ): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4 Size
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // 1. Draw Title
    page.drawText(title, {
      x: 50,
      y: 780,
      size: 20,
      font: font,
      color: rgb(0.12, 0.28, 0.48), // Dark Navy
    });

    // Subtitle
    page.drawText("Purabiya Foundation - Official Certificate", {
      x: 50,
      y: 755,
      size: 10,
      font: fontRegular,
      color: rgb(0.5, 0.5, 0.5),
    });

    // Draw Divider Line
    page.drawLine({
      start: { x: 50, y: 745 },
      end: { x: 545, y: 745 },
      thickness: 1.5,
      color: rgb(0.12, 0.28, 0.48),
    });

    // 2. Draw Fields sequentially down the page (ignoring template coordinate values for cleaner fallback rendering)
    let currentY = 710;
    for (const field of fields) {
      if (!field.text) continue;
      const rawText = field.text.toString().replace(/₹/g, "Rs. ");

      try {
        if (/[^\x00-\x7F]/.test(rawText)) {
          await drawDevanagariText(
            pdfDoc,
            page,
            841.89,
            rawText,
            80,
            841.89 - currentY,
            11,
            fontRegular
          );
        } else {
          page.drawText(rawText, {
            x: 80,
            y: currentY,
            size: 11,
            font: fontRegular,
            color: rgb(0.1, 0.1, 0.1),
          });
        }
      } catch (err) {
        // Fallback: draw ASCII sanitized text to ensure PDF generation never throws
        const sanitized = rawText.replace(/[^\x00-\x7F]/g, "?");
        page.drawText(sanitized, {
          x: 80,
          y: currentY,
          size: 11,
          font: fontRegular,
          color: rgb(0.1, 0.1, 0.1),
        });
      }
      currentY -= 25;
    }

    // Footer
    page.drawLine({
      start: { x: 50, y: 80 },
      end: { x: 545, y: 80 },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });

    page.drawText("Authorized Digital Document. Powered by Purabiya Tech.", {
      x: 50,
      y: 65,
      size: 8,
      font: fontRegular,
      color: rgb(0.6, 0.6, 0.6),
    });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }
}
