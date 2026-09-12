import { prisma } from "../config/db";
import { MayraService } from "../modules/mayra/mayra.service";

async function runMayraDualFormNumberTests() {
  console.log("==================================================");
  console.log("TESTING DUAL-FORM-NUMBER SYSTEM (MAYRA REGISTRATION)");
  console.log("==================================================\n");

  const mayraService = new MayraService();

  // Find a valid agent / admin user for creation
  const user = await prisma.user.findFirst({
    where: { role: "ADMIN", deletedAt: null },
  });
  if (!user) {
    throw new Error("Admin user not found for test execution");
  }

  const testOfflineNumber1 = `OFFLINE_MYR_${Date.now()}`;
  let createdMayraId: string | null = null;
  let createdMayraId2: string | null = null;

  try {
    // -------------------------------------------------------------
    // TEST 1, 2 & 3: Create new Mayra Registration with offlineFormNumber
    // -------------------------------------------------------------
    console.log("TEST 1, 2 & 3: Creating Mayra Registration with offlineFormNumber...");
    const createdMayra = await mayraService.createMayraRegistration(
      {
        applicantName: "Test Mayra Applicant",
        fatherName: "Test Father",
        motherName: "Test Mother",
        dateOfBirth: "1995-05-15",
        applicationDate: "2026-08-01",
        age: 31,
        aadharNumber: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
        gotra: "Prajapat",
        mobile: "9876543210",
        address: "Village Test, Balotra",
        pinCode: "344021",
        tehsil: "Balotra",
        district: "Balotra",
        nomineeName: "Test Nominee",
        nomineeRelation: "Wife",
        workerName: "Test Worker",
        gender: "Female",
        offlineFormNumber: testOfflineNumber1,
        selectedAgentId: user.id,
      },
      user.id,
      "ADMIN"
    );

    createdMayraId = createdMayra.id;
    console.log(`✅ Mayra Registration created: ID=${createdMayra.id}`);
    console.log(`   System Form Number (formNumber): ${createdMayra.formNumber}`);
    console.log(`   Offline Form Number (offlineFormNumber): ${createdMayra.offlineFormNumber}`);

    if (!createdMayra.formNumber.startsWith("MYR-")) {
      throw new Error(`Expected system formNumber to start with 'MYR-', got ${createdMayra.formNumber}`);
    }
    if (createdMayra.offlineFormNumber !== testOfflineNumber1) {
      throw new Error(`Expected offlineFormNumber '${testOfflineNumber1}', got ${createdMayra.offlineFormNumber}`);
    }

    // -------------------------------------------------------------
    // TEST 4 & 5: Update offlineFormNumber and verify formNumber stays unchanged
    // -------------------------------------------------------------
    console.log("\nTEST 4 & 5: Updating offlineFormNumber and verifying formNumber immutability...");
    const originalSystemNumber = createdMayra.formNumber;
    const updatedOfflineNumber = `${testOfflineNumber1}_UPDATED`;

    const updatedMayra = await mayraService.updateMayraRegistration(createdMayra.id, {
      applicantName: "Test Mayra Applicant Edited",
      offlineFormNumber: updatedOfflineNumber,
    });

    console.log(`✅ Mayra Registration updated.`);
    console.log(`   System Form Number after edit: ${updatedMayra.formNumber}`);
    console.log(`   Offline Form Number after edit: ${updatedMayra.offlineFormNumber}`);

    if (updatedMayra.formNumber !== originalSystemNumber) {
      throw new Error(`CRITICAL BUG: system formNumber changed from ${originalSystemNumber} to ${updatedMayra.formNumber}`);
    }
    if (updatedMayra.offlineFormNumber !== updatedOfflineNumber) {
      throw new Error(`Expected updated offlineFormNumber '${updatedOfflineNumber}', got ${updatedMayra.offlineFormNumber}`);
    }

    // -------------------------------------------------------------
    // TEST 6: Duplicate detection for offlineFormNumber
    // -------------------------------------------------------------
    console.log("\nTEST 6: Testing duplicate detection for offlineFormNumber...");
    let duplicateRejected = false;
    try {
      await mayraService.createMayraRegistration(
        {
          applicantName: "Duplicate Test Mayra Applicant",
          fatherName: "Test Father 2",
          motherName: "Test Mother 2",
          dateOfBirth: "1996-06-16",
          applicationDate: "2026-08-01",
          age: 30,
          aadharNumber: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
          gotra: "Prajapat",
          mobile: "9876543211",
          address: "Village Test 2, Balotra",
          pinCode: "344021",
          tehsil: "Balotra",
          district: "Balotra",
          nomineeName: "Test Nominee 2",
          nomineeRelation: "Husband",
          workerName: "Test Worker 2",
          gender: "Female",
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
    // TEST 7 & 8: Search by system formNumber and by offlineFormNumber
    // -------------------------------------------------------------
    console.log("\nTEST 7 & 8: Testing search by formNumber and offlineFormNumber...");
    
    // Search by system form number (MYR-1 etc.)
    const searchBySystem = await mayraService.getAllMayraRegistrations({ search: originalSystemNumber });
    const foundBySystem = Array.isArray(searchBySystem)
      ? searchBySystem.some((r) => r.id === createdMayra.id)
      : (searchBySystem as any).data?.some((r: any) => r.id === createdMayra.id);
    console.log(`   Found by system formNumber (${originalSystemNumber}): ${foundBySystem}`);
    if (!foundBySystem) throw new Error("Search by system formNumber failed");

    // Search by offline form number
    const searchByOffline = await mayraService.getAllMayraRegistrations({ search: updatedOfflineNumber });
    const foundByOffline = Array.isArray(searchByOffline)
      ? searchByOffline.some((r) => r.id === createdMayra.id)
      : (searchByOffline as any).data?.some((r: any) => r.id === createdMayra.id);
    console.log(`   Found by offlineFormNumber (${updatedOfflineNumber}): ${foundByOffline}`);
    if (!foundByOffline) throw new Error("Search by offlineFormNumber failed");

    // -------------------------------------------------------------
    // TEST 9 & 10: List and Detail return both formNumber and offlineFormNumber
    // -------------------------------------------------------------
    console.log("\nTEST 9 & 10: Testing List and Detail responses for dual numbers...");
    const detail = await mayraService.getMayraRegistrationById(createdMayra.id);
    if (!detail.formNumber || detail.offlineFormNumber !== updatedOfflineNumber) {
      throw new Error(`Detail response missing dual numbers: formNumber=${detail.formNumber}, offlineFormNumber=${detail.offlineFormNumber}`);
    }
    console.log(`✅ Detail returns formNumber: ${detail.formNumber}, offlineFormNumber: ${detail.offlineFormNumber}`);

    const list = await mayraService.getAllMayraRegistrations({ limit: 50, page: 1 });
    const listRecords = Array.isArray(list) ? list : (list as any).data;
    const matchInList = listRecords.find((r: any) => r.id === createdMayra.id);
    if (!matchInList || !matchInList.formNumber || matchInList.offlineFormNumber !== updatedOfflineNumber) {
      throw new Error(`List response missing dual numbers: ${JSON.stringify(matchInList)}`);
    }
    console.log(`✅ List returns formNumber: ${matchInList.formNumber}, offlineFormNumber: ${matchInList.offlineFormNumber}`);

    // -------------------------------------------------------------
    // TEST 11: Historical record compatibility (offlineFormNumber = null)
    // -------------------------------------------------------------
    console.log("\nTEST 11: Testing historical record compatibility...");
    const historical = await prisma.mayraRegistration.findFirst({
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
    // TEST 12: Concurrency / duplicate safety check
    // -------------------------------------------------------------
    console.log("\nTEST 12: Testing concurrent creation with same offline number...");
    const concurrentOfflineNumber = `OFFLINE_MYR_CONC_${Date.now()}`;
    const results = await Promise.allSettled([
      mayraService.createMayraRegistration(
        {
          applicantName: "Concurrent Applicant 1",
          fatherName: "Father 1",
          motherName: "Mother 1",
          dateOfBirth: "1994-04-14",
          applicationDate: "2026-08-01",
          age: 32,
          aadharNumber: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
          gotra: "Prajapat",
          mobile: "9876543212",
          address: "Village Test, Balotra",
          pinCode: "344021",
          tehsil: "Balotra",
          district: "Balotra",
          nomineeName: "Nominee 1",
          nomineeRelation: "Wife",
          workerName: "Worker 1",
          gender: "Female",
          offlineFormNumber: concurrentOfflineNumber,
          selectedAgentId: user.id,
        },
        user.id,
        "ADMIN"
      ),
      mayraService.createMayraRegistration(
        {
          applicantName: "Concurrent Applicant 2",
          fatherName: "Father 2",
          motherName: "Mother 2",
          dateOfBirth: "1994-04-14",
          applicationDate: "2026-08-01",
          age: 32,
          aadharNumber: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
          gotra: "Prajapat",
          mobile: "9876543213",
          address: "Village Test, Balotra",
          pinCode: "344021",
          tehsil: "Balotra",
          district: "Balotra",
          nomineeName: "Nominee 2",
          nomineeRelation: "Wife",
          workerName: "Worker 2",
          gender: "Female",
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
      createdMayraId2 = (fulfilled[0] as PromiseFulfilledResult<any>).value.id;
    }

    console.log(`   Concurrent test: ${fulfilled.length} succeeded, ${rejected.length} rejected.`);
    if (fulfilled.length > 1) {
      throw new Error("Concurrency failure: Two records were created with the same offline form number!");
    }
    console.log(`✅ Concurrency duplicate safety verified.`);

    console.log("\n==================================================");
    console.log("🎉 ALL 12 MAYRA DUAL-FORM-NUMBER TESTS PASSED PERFECTLY!");
    console.log("==================================================");
  } finally {
    // Clean up created test records so live production database remains pristine
    if (createdMayraId) {
      await mayraService.softDeleteMayraRegistration(createdMayraId);
      console.log(`Cleaned up test record ${createdMayraId}`);
    }
    if (createdMayraId2) {
      await mayraService.softDeleteMayraRegistration(createdMayraId2);
      console.log(`Cleaned up test record ${createdMayraId2}`);
    }
  }
}

runMayraDualFormNumberTests()
  .catch((err) => {
    console.error("TEST FAILED:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
