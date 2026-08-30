import fs from "fs";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { NotFoundError } from "./errors";

export interface PDFTextField {
  text: string;
  x: number;
  y: number;
  size?: number;
}

export class PDFHelper {
  /**
   * Loads a base PDF template file, prints fields on it, and returns the compiled PDF Buffer
   */
  public static async drawFieldsOnPDF(
    templateFilePath: string,
    fields: PDFTextField[]
  ): Promise<Buffer> {
    if (!fs.existsSync(templateFilePath)) {
      throw new NotFoundError(`Base PDF template file not found at: ${templateFilePath}`);
    }

    try {
      // 1. Load the existing PDF template
      const templateBytes = fs.readFileSync(templateFilePath);
      const pdfDoc = await PDFDocument.load(templateBytes);
      
      // 2. Fetch the first page (or page index 0)
      const pages = pdfDoc.getPages();
      const firstPage = pages[0];
      if (!firstPage) {
        throw new Error("The loaded PDF template has no pages.");
      }

      // 3. Load a standard font (Courier/Helvetica) to draw text
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      // 4. Draw each field at its respective coordinates
      fields.forEach((field) => {
        if (!field.text) return;

        firstPage.drawText(field.text.toString(), {
          x: field.x,
          y: field.y,
          size: field.size || 12,
          font: font,
          color: rgb(0, 0, 0), // Black ink
        });
      });

      // 5. Save the PDF doc as bytes array
      const pdfBytes = await pdfDoc.save();
      return Buffer.from(pdfBytes);
    } catch (error: any) {
      throw new Error(`Failed to print fields on PDF template: ${error.message}`);
    }
  }
}

const DEVANAGARI_FONT_FAMILY = 'NotoSansDevanagariPdfText';
const RENDER_PX = 100;
const PAD_PX = 4;

let fontRegistered = false;

function ensureDevanagariFontRegistered(): boolean {
  if (fontRegistered) return true;
  try {
    const path = require('path');
    const fontCandidates = [
      path.join(process.cwd(), '..', 'public', 'fonts', 'NotoSansDevanagari-Regular.ttf'),
      path.join(process.cwd(), 'public', 'fonts', 'NotoSansDevanagari-Regular.ttf'),
      path.join(process.cwd(), 'assets', 'fonts', 'NotoSansDevanagari-Regular.ttf'),
    ];
    const fontPath = fontCandidates.find((p: string) => fs.existsSync(p));
    if (fontPath) {
      const { GlobalFonts } = require('@napi-rs/canvas');
      GlobalFonts.registerFromPath(fontPath, DEVANAGARI_FONT_FAMILY);
      fontRegistered = true;
    }
  } catch (err) {
    console.error('Failed to register Devanagari font for canvas rasterization:', err);
  }
  return fontRegistered;
}

function rasterizeDevanagariText(text: string) {
  const { createCanvas } = require('@napi-rs/canvas');
  const measureCanvas = createCanvas(10, 10);
  const measureCtx = measureCanvas.getContext('2d');
  measureCtx.font = `${RENDER_PX}px "${DEVANAGARI_FONT_FAMILY}"`;
  const metrics = measureCtx.measureText(text);

  const ascentPx = Math.ceil(metrics.fontBoundingBoxAscent);
  const descentPx = Math.ceil(metrics.fontBoundingBoxDescent);
  const widthPx = Math.ceil(metrics.width) + PAD_PX * 2;
  const heightPx = ascentPx + descentPx + PAD_PX * 2;
  const baselineFromTopPx = ascentPx + PAD_PX;

  const canvas = createCanvas(widthPx, heightPx);
  const ctx = canvas.getContext('2d');
  ctx.font = `${RENDER_PX}px "${DEVANAGARI_FONT_FAMILY}"`;
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, PAD_PX, baselineFromTopPx);

  return {
    pngBytes: canvas.toBuffer('image/png'),
    widthPx,
    heightPx,
    baselineFromTopPx,
  };
}

export async function drawDevanagariText(
  pdfDoc: PDFDocument,
  page: any,
  pageHeight: number,
  text: string,
  x: number,
  yFromTop: number,
  fontSizePt: number,
  fallbackFont?: any,
): Promise<void> {
  if (!text) return;
  const drawY = pageHeight - yFromTop;

  if (!ensureDevanagariFontRegistered()) {
    if (fallbackFont) {
      page.drawText(text, { x, y: drawY, size: fontSizePt, font: fallbackFont, color: rgb(0, 0, 0) });
    }
    return;
  }

  const scale = fontSizePt / RENDER_PX;
  const { pngBytes, widthPx, heightPx, baselineFromTopPx } = rasterizeDevanagariText(text);
  const pngImage = await pdfDoc.embedPng(pngBytes);

  page.drawImage(pngImage, {
    x: x - PAD_PX * scale,
    y: drawY - (heightPx - baselineFromTopPx) * scale,
    width: widthPx * scale,
    height: heightPx * scale,
  });
}

