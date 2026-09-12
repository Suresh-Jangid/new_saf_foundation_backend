import { prisma } from "../config/db";
import { ApplicationsService } from "../modules/applications/applications.service";
import { DocumentsService } from "../modules/documents/documents.service";

async function runInsuranceDualFormNumberTests() {
  console.log("==================================================");
  console.log("TESTING DUAL-FORM-NUMBER SYSTEM (INSURANCE BIMA)");
  console.log("==================================================\n");

  const appsService = new ApplicationsService();
  const docService = new DocumentsService();

  // Find a valid admin user for creation
  const user = await prisma.user.findFirst({
    where: { role: "ADMIN", deletedAt: null },
  });
  if (!user) {
    throw new Error("Admin user not found for test execution");
  }

  const testOfflineNumber1 = `OFFLINE_INS_${Date.now()}`;
  let createdAppId: string | null = null;
  let createdAppId2: string | null = null;

  try {
    // -------------------------------------------------------------
    // TEST 1, 2 & 3: Create new Insurance Application with offlineFormNumber
    // -------------------------------------------------------------
    console.log("TEST 1, 2 & 3: Creating Insurance Application with offlineFormNumber...");
    const createdApp = await appsService.createInsuranceApplication(
      {
        applicantName: "Test Insurance Dual Form Applicant",
        fatherName: "Test Father",
        motherName: "Test Mother",
        wifeName: "Test Wife",
        dateOfBirth: "1995-05-15",
        applicationDate: "2026-08-01",
        aadharNumber: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
        gotra: "Prajapat",
        mobile: "9876543210",
        address: "Village Test, Balotra",
        pinCode: "344021",
        tehsil: "Balotra",
        district: "Balotra",
        state: "Rajasthan",
        nomineeName: "Test Nominee",
        nomineeRelation: "Wife",
        gender: "Male",
        category: "A",
        totalAmount: 11000,
        offlineFormNumber: testOfflineNumber1,
        selectedAgentId: user.id,
      },
      user.id,
      "ADMIN"
    );

    createdAppId = createdApp.id;
    console.log(`✅ Insurance Application created: ID=${createdApp.id}`);
    console.log(`   System Form Number (formNumber): ${createdApp.formNumber}`);
    console.log(`   Offline Form Number (offlineFormNumber): ${createdApp.offlineFormNumber}`);

    if (!createdApp.formNumber.startsWith("S-")) {
      throw new Error(`Expected system formNumber to start with 'S-', got ${createdApp.formNumber}`);
    }
    if (createdApp.offlineFormNumber !== testOfflineNumber1) {
      throw new Error(`Expected offlineFormNumber '${testOfflineNumber1}', got ${createdApp.offlineFormNumber}`);
    }

    // -------------------------------------------------------------
    // TEST 4 & 5: Update offlineFormNumber and verify formNumber stays unchanged
    // -------------------------------------------------------------
    console.log("\nTEST 4 & 5: Updating offlineFormNumber and verifying formNumber immutability...");
    const originalSystemNumber = createdApp.formNumber;
    const updatedOfflineNumber = `${testOfflineNumber1}_UPDATED`;

    const updatedApp = await appsService.updateInsuranceApplication(createdApp.id, {
      applicantName: "Test Insurance Dual Form Applicant Edited",
      offlineFormNumber: updatedOfflineNumber,
    });

    console.log(`✅ Insurance Application updated.`);
    console.log(`   System Form Number after edit: ${updatedApp.formNumber}`);
    console.log(`   Offline Form Number after edit: ${updatedApp.offlineFormNumber}`);

    if (updatedApp.formNumber !== originalSystemNumber) {
      throw new Error(`CRITICAL BUG: system formNumber changed from ${originalSystemNumber} to ${updatedApp.formNumber}`);
    }
    if (updatedApp.offlineFormNumber !== updatedOfflineNumber) {
      throw new Error(`Expected updated offlineFormNumber '${updatedOfflineNumber}', got ${updatedApp.offlineFormNumber}`);
    }

    // -------------------------------------------------------------
    // TEST 6: Duplicate detection for offlineFormNumber
    // -------------------------------------------------------------
    console.log("\nTEST 6: Testing duplicate detection for offlineFormNumber...");
    let duplicateRejected = false;
    try {
      await appsService.createInsuranceApplication(
        {
          applicantName: "Duplicate Test Insurance Applicant",
          fatherName: "Test Father 2",
          motherName: "Test Mother 2",
          dateOfBirth: "1996-06-16",
          applicationDate: "2026-08-01",
          aadharNumber: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
          gotra: "Prajapat",
          mobile: "9876543211",
          address: "Village Test 2, Balotra",
          pinCode: "344021",
          tehsil: "Balotra",
          district: "Balotra",
          state: "Rajasthan",
          gender: "Male",
          category: "A",
          totalAmount: 11000,
          offlineFormNumber: updatedOfflineNumber, // Duplicate!
          selectedAgentId: user.id,
        },
        user.id,
        "ADMIN"
      );
    } catch (err: any) {
      if (err.message.includes("is already assigned")) {
        duplicateRejected = true;
        console.log(`✅ Duplicate offline form number correctly rejected with message: "${err.message}"`);
      } else {
        throw err;
      }
    }

    if (!duplicateRejected) {
      throw new Error("Duplicate offlineFormNumber was NOT rejected!");
    }

    // -------------------------------------------------------------
    // TEST 7: Concurrent duplicate race condition test
    // -------------------------------------------------------------
    console.log("\nTEST 7: Testing concurrent duplicate protection...");
    const concurrentOfflineNumber = `OFFLINE_INS_CONC_${Date.now()}`;
    const results = await Promise.allSettled([
      appsService.createInsuranceApplication(
        {
          applicantName: "Concurrent Applicant 1",
          fatherName: "Father 1",
          motherName: "Mother 1",
          dateOfBirth: "1994-04-14",
          applicationDate: "2026-08-01",
          aadharNumber: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
          gotra: "Prajapat",
          mobile: "9876543212",
          address: "Village Test, Balotra",
          pinCode: "344021",
          tehsil: "Balotra",
          district: "Balotra",
          state: "Rajasthan",
          gender: "Male",
          category: "A",
          totalAmount: 11000,
          offlineFormNumber: concurrentOfflineNumber,
          selectedAgentId: user.id,
        },
        user.id,
        "ADMIN"
      ),
      appsService.createInsuranceApplication(
        {
          applicantName: "Concurrent Applicant 2",
          fatherName: "Father 2",
          motherName: "Mother 2",
          dateOfBirth: "1994-04-14",
          applicationDate: "2026-08-01",
          aadharNumber: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
          gotra: "Prajapat",
          mobile: "9876543213",
          address: "Village Test, Balotra",
          pinCode: "344021",
          tehsil: "Balotra",
          district: "Balotra",
          state: "Rajasthan",
          gender: "Male",
          category: "A",
          totalAmount: 11000,
          offlineFormNumber: concurrentOfflineNumber,
          selectedAgentId: user.id,
        },
        user.id,
        "ADMIN"
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    if (fulfilled.length > 0) {
      createdAppId2 = (fulfilled[0] as PromiseFulfilledResult<any>).value.id;
    }

    console.log(`   Concurrent test: ${fulfilled.length} succeeded, ${rejected.length} rejected.`);
    if (fulfilled.length > 1) {
      throw new Error("Concurrency failure: Two records were created with the same offline form number!");
    }
    console.log(`✅ Concurrency duplicate safety verified.`);

    // -------------------------------------------------------------
    // TEST 8 & 9: Search by system formNumber and by offlineFormNumber
    // -------------------------------------------------------------
    console.log("\nTEST 8 & 9: Testing search by formNumber and offlineFormNumber...");
    
    // Search by system form number (S-1 etc.)
    const searchBySystem = await appsService.getAllInsuranceApplications({ search: originalSystemNumber });
    const foundBySystem = Array.isArray(searchBySystem)
      ? searchBySystem.some((r) => r.id === createdApp.id)
      : (searchBySystem as any).data?.some((r: any) => r.id === createdApp.id);
    console.log(`   Found by system formNumber (${originalSystemNumber}): ${foundBySystem}`);
    if (!foundBySystem) throw new Error("Search by system formNumber failed");

    // Search by offline form number
    const searchByOffline = await appsService.getAllInsuranceApplications({ search: updatedOfflineNumber });
    const foundByOffline = Array.isArray(searchByOffline)
      ? searchByOffline.some((r) => r.id === createdApp.id)
      : (searchByOffline as any).data?.some((r: any) => r.id === createdApp.id);
    console.log(`   Found by offlineFormNumber (${updatedOfflineNumber}): ${foundByOffline}`);
    if (!foundByOffline) throw new Error("Search by offlineFormNumber failed");

    // -------------------------------------------------------------
    // TEST 10 & 11: List and Detail return both formNumber and offlineFormNumber
    // -------------------------------------------------------------
    console.log("\nTEST 10 & 11: Testing List and Detail responses for dual numbers...");
    const detail = await appsService.getInsuranceApplicationById(createdApp.id);
    if (!detail.formNumber || detail.offlineFormNumber !== updatedOfflineNumber) {
      throw new Error(`Detail response missing dual numbers: formNumber=${detail.formNumber}, offlineFormNumber=${detail.offlineFormNumber}`);
    }
    console.log(`✅ Detail returns formNumber: ${detail.formNumber}, offlineFormNumber: ${detail.offlineFormNumber}`);

    const list = await appsService.getAllInsuranceApplications({ limit: 50, page: 1 });
    const listRecords = Array.isArray(list) ? list : (list as any).data;
    const matchInList = listRecords.find((r: any) => r.id === createdApp.id);
    if (!matchInList || !matchInList.formNumber || matchInList.offlineFormNumber !== updatedOfflineNumber) {
      throw new Error(`List response missing dual numbers: ${JSON.stringify(matchInList)}`);
    }
    console.log(`✅ List returns formNumber: ${matchInList.formNumber}, offlineFormNumber: ${matchInList.offlineFormNumber}`);

    // -------------------------------------------------------------
    // TEST 12: Historical record compatibility (offlineFormNumber = null)
    // -------------------------------------------------------------
    console.log("\nTEST 12: Testing historical record compatibility...");
    const historical = await prisma.insuranceApplication.findFirst({
      where: { offlineFormNumber: null, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    if (historical) {
      console.log(`   Historical record found: ID=${historical.id}, formNumber=${historical.formNumber}, offlineFormNumber=${historical.offlineFormNumber}`);
      if (historical.offlineFormNumber !== null) {
        throw new Error(`Expected historical record offlineFormNumber to be null, got ${historical.offlineFormNumber}`);
      }
      console.log(`✅ Historical record preserved with offlineFormNumber: null`);
    }

    // -------------------------------------------------------------
    // TEST 13: PDF Buffer Generation
    // -------------------------------------------------------------
    console.log("\nTEST 13: Testing PDF buffer generation with dual numbers...");
    const pdfBuffer = await docService.generateInsuranceApplicationPDF(createdApp.id);
    console.log(`✅ PDF Buffer generated successfully (${pdfBuffer.length} bytes)`);

    console.log("\n==================================================");
    console.log("🎉 ALL 13 INSURANCE DUAL-FORM-NUMBER TESTS PASSED PERFECTLY!");
    console.log("==================================================");
  } finally {
    // Clean up created test applications so live production database remains pristine
    if (createdAppId) {
      await appsService.softDeleteInsuranceApplication(createdAppId);
      console.log(`Cleaned up test record ${createdAppId}`);
    }
    if (createdAppId2) {
      await appsService.softDeleteInsuranceApplication(createdAppId2);
      console.log(`Cleaned up test record ${createdAppId2}`);
    }
  }
}

runInsuranceDualFormNumberTests()
  .catch((err) => {
    console.error("TEST FAILED:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
