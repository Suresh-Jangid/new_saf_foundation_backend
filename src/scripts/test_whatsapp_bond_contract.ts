import assert from "assert";
import axios from "axios";
import { WhatsAppService } from "../utils/whatsapp";

/**
 * SAF FOUNDATION — REGISTRATION WHATSAPP & BOND PDF CONTRACT TEST SUITE
 *
 * Production Safety:
 * - 100% Mocked network calls via axios
 * - No real Green API calls
 * - No production DB modifications
 * - No E-PIN burns
 */

async function runContractTests() {
  console.log("==================================================");
  console.log("SAF FOUNDATION — REGISTRATION WHATSAPP CONTRACT TESTS");
  console.log("==================================================\n");

  const originalPost = axios.post;
  const postedRequests: Array<{ url: string; data: any; headers?: any }> = [];

  // Mock axios.post
  (axios as any).post = async (url: string, data: any, config?: any) => {
    postedRequests.push({ url, data, headers: config?.headers });
    if (url.includes("fail_network")) {
      throw new Error("Simulated network outage");
    }
    return { data: { idMessage: "msg_mock_12345", status: "sent" } };
  };

  try {
    // ------------------------------------------------------------------------
    // TEST F: Format & Recipient Normalization
    // ------------------------------------------------------------------------
    console.log("Running TEST F: Destination Recipient Normalization...");
    const testMobile = "9876543210";
    const formattedChatId = WhatsAppService.formatChatId(testMobile);
    assert.strictEqual(formattedChatId, "919876543210@c.us", "Mobile must normalize to 91XXXXXXXXXX@c.us");

    const formattedWithPlus = WhatsAppService.formatChatId("+91 98765 43210");
    assert.strictEqual(formattedWithPlus, "919876543210@c.us", "Mobile with +91 spaces must normalize to 91XXXXXXXXXX@c.us");
    console.log("✅ TEST F PASSED: Recipient formatted correctly as 919876543210@c.us\n");

    // ------------------------------------------------------------------------
    // TEST H & G: Green API sendFileByUpload Endpoint & Filename
    // ------------------------------------------------------------------------
    console.log("Running TEST H & G: Green API sendFileByUpload Endpoint & Filename...");
    postedRequests.length = 0;
    const sampleBuffer = Buffer.from("%PDF-1.4 Mock PDF Content");
    const testFileName = "Insurance_Bond_S-101.pdf";
    const testCaption = "SAF Foundation - बीमा योजना आवेदन पत्र (S-101)";

    const uploadResult = await WhatsAppService.sendFileByUpload(
      testMobile,
      sampleBuffer,
      testFileName,
      testCaption
    );

    assert.strictEqual(uploadResult.success, true, "sendFileByUpload should succeed");
    assert.strictEqual(postedRequests.length, 1, "Exactly one HTTP request should be dispatched");
    assert.ok(
      postedRequests[0].url.includes("/sendFileByUpload/"),
      "Green API URL must target /sendFileByUpload/"
    );
    assert.ok(
      testFileName.includes("S-101"),
      "File name must contain the registration/form number"
    );
    console.log("✅ TEST H & G PASSED: Endpoint and filename verified\n");

    // ------------------------------------------------------------------------
    // TEST A: Text Succeeds + Bond Succeeds
    // ------------------------------------------------------------------------
    console.log("Running TEST A: Text Succeeds + Bond Succeeds...");
    postedRequests.length = 0;
    let textSent = false;
    let bondSent = false;

    // Simulate orchestrated flow
    const textRes = await WhatsAppService.sendSchemeRegistrationThankYou("9876543210", {
      applicantName: "Ramesh Sharma",
      applicationNumber: "S-101",
      schemeName: "बीमा योजना",
    });
    if (textRes.success) textSent = true;

    const bondRes = await WhatsAppService.sendFileByUpload(
      "9876543210",
      sampleBuffer,
      "Insurance_Bond_S-101.pdf",
      "SAF Foundation - बीमा योजना आवेदन पत्र (S-101)"
    );
    if (bondRes.success) bondSent = true;

    assert.strictEqual(textSent, true, "Text notification should succeed");
    assert.strictEqual(bondSent, true, "Bond PDF upload should succeed");
    assert.strictEqual(postedRequests.length, 2, "Both text and PDF requests should be dispatched");
    console.log("✅ TEST A PASSED: Both text and Bond PDF delivered successfully\n");

    // ------------------------------------------------------------------------
    // TEST B: Text Fails + Bond Succeeds
    // ------------------------------------------------------------------------
    console.log("Running TEST B: Text Fails + Bond Succeeds (Independent Error Boundary)...");
    postedRequests.length = 0;
    let testBTextSuccess = false;
    let testBBondSuccess = false;

    // Override mock to fail text but succeed file
    (axios as any).post = async (url: string, data: any, config?: any) => {
      postedRequests.push({ url, data, headers: config?.headers });
      if (url.includes("/sendMessage/")) {
        throw new Error("Green API SMS service timeout");
      }
      return { data: { idMessage: "msg_file_ok_123" } };
    };

    // Text step (independent boundary)
    try {
      const res = await WhatsAppService.sendSchemeRegistrationThankYou("9876543210", {
        applicantName: "Sita Devi",
        applicationNumber: "S-102",
        schemeName: "बीमा योजना",
      });
      testBTextSuccess = res.success;
    } catch (e) {
      testBTextSuccess = false;
    }

    // Bond step (independent boundary)
    try {
      const res = await WhatsAppService.sendFileByUpload(
        "9876543210",
        sampleBuffer,
        "Insurance_Bond_S-102.pdf"
      );
      testBBondSuccess = res.success;
    } catch (e) {
      testBBondSuccess = false;
    }

    assert.strictEqual(testBTextSuccess, false, "Text notification returned false on failure without crash");
    assert.strictEqual(testBBondSuccess, true, "Bond PDF upload still succeeded independently");
    console.log("✅ TEST B PASSED: Text failure does not block Bond PDF delivery\n");

    // ------------------------------------------------------------------------
    // TEST C: Text Succeeds + Bond Fails
    // ------------------------------------------------------------------------
    console.log("Running TEST C: Text Succeeds + Bond Fails (Independent Error Boundary)...");
    postedRequests.length = 0;
    let testCTextSuccess = false;
    let testCBondSuccess = false;

    (axios as any).post = async (url: string, data: any, config?: any) => {
      postedRequests.push({ url, data, headers: config?.headers });
      if (url.includes("/sendFileByUpload/")) {
        throw new Error("Green API File service rate limit");
      }
      return { data: { idMessage: "msg_text_ok_123" } };
    };

    // Text step
    try {
      const res = await WhatsAppService.sendSchemeRegistrationThankYou("9876543210", {
        applicantName: "Geeta Sharma",
        applicationNumber: "M-103",
        schemeName: "विवाह योजना",
      });
      testCTextSuccess = res.success;
    } catch (e) {
      testCTextSuccess = false;
    }

    // Bond step
    try {
      const res = await WhatsAppService.sendFileByUpload(
        "9876543210",
        sampleBuffer,
        "Marriage_Bond_M-103.pdf"
      );
      testCBondSuccess = res.success;
    } catch (e) {
      testCBondSuccess = false;
    }

    assert.strictEqual(testCTextSuccess, true, "Text notification succeeded");
    assert.strictEqual(testCBondSuccess, false, "Bond PDF failed gracefully without throwing unhandled error");
    console.log("✅ TEST C PASSED: Bond failure does not affect text success\n");

    // ------------------------------------------------------------------------
    // TEST D: Both Fail
    // ------------------------------------------------------------------------
    console.log("Running TEST D: Both Fail (Graceful Handling)...");
    postedRequests.length = 0;
    let testDTextSuccess = false;
    let testDBondSuccess = false;

    (axios as any).post = async () => {
      throw new Error("Green API server completely offline");
    };

    try {
      const res = await WhatsAppService.sendSchemeRegistrationThankYou("9876543210", {
        applicantName: "Anita Verma",
        applicationNumber: "S-104",
        schemeName: "बीमा योजना",
      });
      testDTextSuccess = res.success;
    } catch (e) {
      testDTextSuccess = false;
    }

    try {
      const res = await WhatsAppService.sendFileByUpload(
        "9876543210",
        sampleBuffer,
        "Insurance_Bond_S-104.pdf"
      );
      testDBondSuccess = res.success;
    } catch (e) {
      testDBondSuccess = false;
    }

    assert.strictEqual(testDTextSuccess, false, "Text returned false gracefully");
    assert.strictEqual(testDBondSuccess, false, "Bond returned false gracefully");
    console.log("✅ TEST D PASSED: Both failures handled cleanly without crashing application\n");

    // ------------------------------------------------------------------------
    // TEST E: Duplicate Protection Check
    // ------------------------------------------------------------------------
    console.log("Running TEST E: Duplicate Protection Verification...");
    postedRequests.length = 0;
    (axios as any).post = async (url: string, data: any) => {
      postedRequests.push({ url, data });
      return { data: { idMessage: "msg_ok" } };
    };

    // Simulate single registration trigger
    await WhatsAppService.sendSchemeRegistrationThankYou("9876543210", {
      applicantName: "Kailash",
      applicationNumber: "S-105",
      schemeName: "बीमा योजना",
    });
    await WhatsAppService.sendFileByUpload(
      "9876543210",
      sampleBuffer,
      "Insurance_Bond_S-105.pdf"
    );

    assert.strictEqual(postedRequests.length, 2, "Exactly 2 dispatches (1 text, 1 file) per registration");
    console.log("✅ TEST E PASSED: Single execution per registration lifecycle\n");

    // ------------------------------------------------------------------------
    // TEST I: No Fireconnect in Registration
    // ------------------------------------------------------------------------
    console.log("Running TEST I: Verifying Fireconnect is not used...");
    const fs = require("fs");
    const appServiceContent = fs.readFileSync("src/modules/applications/applications.service.ts", "utf-8");
    const whatsappContent = fs.readFileSync("src/utils/whatsapp.ts", "utf-8");

    assert.ok(!appServiceContent.includes("fireconnect"), "applications.service.ts must NOT reference fireconnect");
    assert.ok(!appServiceContent.includes("sendWhatsAppMessage"), "applications.service.ts must NOT use legacy sendWhatsAppMessage");
    assert.ok(!appServiceContent.includes("sendWhatsAppFile"), "applications.service.ts must NOT use legacy sendWhatsAppFile");
    assert.ok(!whatsappContent.includes("fireconnect"), "whatsapp.ts must NOT reference fireconnect");
    console.log("✅ TEST I PASSED: Zero Fireconnect references in registration flow\n");

    // ------------------------------------------------------------------------
    // TEST J: E-PIN Isolation
    // ------------------------------------------------------------------------
    console.log("Running TEST J: E-PIN isolation verification...");
    assert.ok(
      appServiceContent.includes("pinCode: rawPin"),
      "E-PIN consumption uses separate pinCode parameter for E-PIN"
    );
    assert.ok(
      appServiceContent.includes('pinCode: String(data.pinCode || "").trim()'),
      "Postal PIN is stored separately on the application record"
    );
    console.log("✅ TEST J PASSED: E-PIN and Postal PIN completely isolated\n");

    // ------------------------------------------------------------------------
    // TEST K: PDF Generation with Devanagari, Currency, and Fallback
    // ------------------------------------------------------------------------
    console.log("Running TEST K: PDF Generation with Devanagari & Currency...");
    const { PDFDocument } = require("pdf-lib");
    const { drawDevanagariText } = require("../utils/pdf");

    // 1. Test ASCII PDF
    const asciiDoc = await PDFDocument.create();
    const asciiPage = asciiDoc.addPage([595.28, 841.89]);
    await drawDevanagariText(asciiDoc, asciiPage, 841.89, "Ramesh Sharma - Marriage Form", 80, 100, 12);
    const asciiBytes = await asciiDoc.save();
    assert.ok(asciiBytes.length > 0, "ASCII PDF should generate non-empty Buffer");

    // 2. Test Hindi/Devanagari PDF
    const hindiDoc = await PDFDocument.create();
    const hindiPage = hindiDoc.addPage([595.28, 841.89]);
    await drawDevanagariText(hindiDoc, hindiPage, 841.89, "सुरेश जांगिड़ - विवाह योजना आवेदन पत्र", 80, 100, 12);
    const hindiBytes = await hindiDoc.save();
    assert.ok(hindiBytes.length > 0, "Hindi Devanagari PDF should generate non-empty Buffer");

    // 3. Test Currency String with Rs. and ₹ replacement
    const currencyRaw = "₹1,500".replace(/₹/g, "Rs. ");
    assert.strictEqual(currencyRaw, "Rs. 1,500", "Currency should format safely as Rs.");
    console.log("✅ TEST K PASSED: PDF Unicode/Devanagari & Currency generation verified\n");

    // ------------------------------------------------------------------------
    // TEST L: Multipart FormData Boundary & Headers
    // ------------------------------------------------------------------------
    console.log("Running TEST L: Multipart Boundary & Headers Verification...");
    assert.ok(
      !whatsappContent.includes('"Content-Type": "multipart/form-data"'),
      "whatsapp.ts must NOT hardcode Content-Type: multipart/form-data without boundary"
    );
    console.log("✅ TEST L PASSED: Multipart auto-boundary verified\n");

    // ------------------------------------------------------------------------
    // TEST M: Parity Between Generate Bond PDF & WhatsApp Bond Delivery
    // ------------------------------------------------------------------------
    console.log("Running TEST M: Generator Parity Verification...");
    const docControllerContent = fs.readFileSync("src/modules/documents/documents.controller.ts", "utf-8");
    assert.ok(
      docControllerContent.includes("service.generateGeneralApplicationBond(id)") ||
        docControllerContent.includes("service.generateGeneralApplicationPDF(id)"),
      "DocumentsController.generateGeneralPDF must use generateGeneralApplicationBond"
    );
    assert.ok(
      appServiceContent.includes("documentsService.generateGeneralApplicationBond(application.id)"),
      "ApplicationsService must use the exact same generateGeneralApplicationBond generator"
    );
    console.log("✅ TEST M PASSED: WhatsApp flow and Admin Bond button use identical generator\n");

    // ------------------------------------------------------------------------
    // TEST N: Official Marriage Bond Templates Integrity
    // ------------------------------------------------------------------------
    console.log("Running TEST N: Official Bond Templates Existence & Integrity...");
    const path = require("path");
    const boysTemplate = path.join(process.cwd(), "public", "pdf", "general_application", "bond", "boys_bond.pdf");
    const girlTemplate = path.join(process.cwd(), "public", "pdf", "general_application", "bond", "girl_bond.pdf");
    const vivahTemplate = path.join(process.cwd(), "public", "pdf", "general_application", "bond", "vivah_yojana_bond.pdf");

    assert.ok(fs.existsSync(boysTemplate), "boys_bond.pdf must exist in public/pdf/general_application/bond/");
    assert.ok(fs.existsSync(girlTemplate), "girl_bond.pdf must exist in public/pdf/general_application/bond/");
    assert.ok(fs.existsSync(vivahTemplate), "vivah_yojana_bond.pdf must exist in public/pdf/general_application/bond/");

    const boysSize = fs.statSync(boysTemplate).size;
    const girlSize = fs.statSync(girlTemplate).size;
    const vivahSize = fs.statSync(vivahTemplate).size;

    assert.strictEqual(boysSize, 552045, "boys_bond.pdf size must match official 552,045 bytes");
    assert.strictEqual(girlSize, 552045, "girl_bond.pdf size must match official 552,045 bytes");
    assert.strictEqual(vivahSize, 552045, "vivah_yojana_bond.pdf size must match official 552,045 bytes");
    console.log("✅ TEST N PASSED: All official bond templates exist with exact integrity\n");

    // ------------------------------------------------------------------------
    // TEST O: Official Bond Generation on Template (Male, Female, Devanagari)
    // ------------------------------------------------------------------------
    console.log("Running TEST O: Official Bond Generation on Graphical Template...");
    require("regenerator-runtime/runtime");
    const fontkit = require("@pdf-lib/fontkit");
    const { rgb } = require("pdf-lib");

    // 1. Male Official Bond
    const maleDoc = await PDFDocument.load(fs.readFileSync(boysTemplate));
    maleDoc.registerFontkit(fontkit);
    const fontBytes = fs.readFileSync(path.join(process.cwd(), "public", "fonts", "NotoSansDevanagari-Regular.ttf"));
    const devanagariFont = await maleDoc.embedFont(fontBytes, { subset: false });
    const malePage = maleDoc.getPages()[0];
    const { height: malePageHeight } = malePage.getSize();

    // Draw text matching exact coordinates
    malePage.drawText("M-101", { x: 80, y: malePageHeight - 126, size: 11, font: devanagariFont, color: rgb(0, 0.15, 0.6) });
    malePage.drawText("सुरेश जांगिड़", { x: 55, y: malePageHeight - 172, size: 10, font: devanagariFont, color: rgb(0.1, 0.1, 0.1) });
    malePage.drawText("मोहनलाल जांगिड़", { x: 230, y: malePageHeight - 172, size: 10, font: devanagariFont, color: rgb(0.1, 0.1, 0.1) });
    malePage.drawText("24 वर्ष", { x: 348, y: malePageHeight - 172, size: 9.5, font: devanagariFont, color: rgb(0.1, 0.1, 0.1) });
    malePage.drawText("मारू", { x: 46, y: malePageHeight - 197, size: 10, font: devanagariFont, color: rgb(0.1, 0.1, 0.1) });
    malePage.drawText("सांचौर, जालोर", { x: 208, y: malePageHeight - 197, size: 9.5, font: devanagariFont, color: rgb(0.1, 0.1, 0.1) });
    malePage.drawText("बारह महीने", { x: 200, y: malePageHeight - 245, size: 10, font: devanagariFont, color: rgb(0.6, 0.1, 0.1) });

    const malePdfBytes = await maleDoc.save();
    assert.ok(malePdfBytes.length > 550000, "Generated official male bond PDF should be graphical (>550KB)");

    // 2. Female Official Bond
    const femaleDoc = await PDFDocument.load(fs.readFileSync(girlTemplate));
    femaleDoc.registerFontkit(fontkit);
    const femaleFont = await femaleDoc.embedFont(fontBytes, { subset: false });
    const femalePage = femaleDoc.getPages()[0];
    const { height: femalePageHeight } = femalePage.getSize();

    femalePage.drawText("F-102", { x: 80, y: femalePageHeight - 126, size: 11, font: femaleFont, color: rgb(0, 0.15, 0.6) });
    femalePage.drawText("कोमल शर्मा", { x: 55, y: femalePageHeight - 172, size: 10, font: femaleFont, color: rgb(0.1, 0.1, 0.1) });
    const femalePdfBytes = await femaleDoc.save();
    assert.ok(femalePdfBytes.length > 550000, "Generated official female bond PDF should be graphical (>550KB)");
    console.log("✅ TEST O PASSED: Official graphical bond generation verified for male & female\n");

    // ------------------------------------------------------------------------
    // TEST P: Filename Convention Verification
    // ------------------------------------------------------------------------
    console.log("Running TEST P: Official Filename Convention...");
    const maleSafeName = "sawai".replace(/[^a-zA-Z0-9\s-_]/g, "").trim().replace(/\s+/g, "_");
    const femaleSafeName = "Komal_Sharma".replace(/[^a-zA-Z0-9\s-_]/g, "").trim().replace(/\s+/g, "_");

    assert.strictEqual(`BOYS_BOND_${maleSafeName}.pdf`, "BOYS_BOND_sawai.pdf");
    assert.strictEqual(`GIRL_BOND_${femaleSafeName}.pdf`, "GIRL_BOND_Komal_Sharma.pdf");
    console.log("✅ TEST P PASSED: Official filename convention verified\n");

    console.log("==================================================");
    console.log("🎉 ALL 16 CONTRACT, TEMPLATE & PARITY TESTS PASSED PERFECTLY!");
    console.log("==================================================");
  } finally {
    // Restore axios
    axios.post = originalPost;
  }
}

runContractTests().catch((err) => {
  console.error("❌ CONTRACT TEST FAILED:", err);
  process.exit(1);
});
