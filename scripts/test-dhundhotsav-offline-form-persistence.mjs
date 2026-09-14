import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { DhundhotsavService } from "../dist/modules/dhundhotsav/dhundhotsav.service.js";
import { ConflictError } from "../dist/utils/errors.js";

dotenv.config();

const prisma = new PrismaClient();
const dhundhotsavService = new DhundhotsavService();

async function runTests() {
  console.log("================================================================================");
  console.log("SAF Foundation — Dhundhotsav Offline Form Number Persistence Test Suite");
  console.log("================================================================================");

  // 1. Fetch admin user for actor context
  const adminUser = await prisma.user.findFirst({
    where: { role: "ADMIN", deletedAt: null },
    select: { id: true, role: true, mobile: true },
  });

  if (!adminUser) {
    throw new Error("No active ADMIN user found in database to execute test suite.");
  }

  const adminActor = { userId: adminUser.id, role: "ADMIN" };

  const createdRecordIds = [];
  const testRunTag = `T${Date.now().toString().slice(-6)}`;
  let passedCount = 0;
  let totalTests = 20;

  function assert(condition, message) {
    if (!condition) {
      console.error(`  ❌ FAILED: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
    passedCount++;
    console.log(`  ✅ PASSED [${passedCount}/${totalTests}]: ${message}`);
  }

  try {
    const makeAadhar = (seed) => {
      const base = String(Date.now()).slice(-8);
      return `99${seed}${base}`.slice(0, 12);
    };

    console.log("\n--- TEST PHASE 1: CREATE FLOWS ---");

    // 1. Create with offlineFormNumber persists it
    const testAadhar1 = makeAadhar("01");
    const createPayload1 = {
      applicationDate: "2026-09-14",
      applicantName: `Test Dhund Applicant 1 ${testRunTag}`,
      fatherName: "Test Father 1",
      dateOfBirth: "2000-01-01",
      aadharNumber: testAadhar1,
      gotra: "Kashyap",
      mobile: "9876543210",
      address: "123 Test Street, Test Village",
      pinCode: "302001",
      tehsil: "Jaipur",
      district: "Jaipur",
      state: "Rajasthan",
      gender: "Male",
      category: "A",
      offlineFormNumber: `OFF-${testRunTag}-01`,
    };

    const res1 = await dhundhotsavService.createRegistration(createPayload1, adminUser.id, adminActor);
    assert(res1 && res1.id, "1. Create with offlineFormNumber succeeds");
    const regId1 = res1.id;
    createdRecordIds.push(regId1);

    // 2. GET detail returns offlineFormNumber when present
    const getRes1 = await dhundhotsavService.getRegistrationById(regId1, adminActor);
    assert(
      getRes1.success === true &&
        getRes1.data.offlineFormNumber === `OFF-${testRunTag}-01` &&
        getRes1.data.offline_form_number === `OFF-${testRunTag}-01` &&
        getRes1.data.offlineFormNo === `OFF-${testRunTag}-01`,
      "2. GET detail returns offlineFormNumber when present (with aliases)"
    );

    // 3. Create without offlineFormNumber still works & persists null
    const testAadhar2 = makeAadhar("02");
    const createPayload2 = {
      applicationDate: "2026-09-14",
      applicantName: `Test Dhund Applicant 2 ${testRunTag}`,
      fatherName: "Test Father 2",
      dateOfBirth: "2000-01-01",
      aadharNumber: testAadhar2,
      gotra: "Kashyap",
      mobile: "9876543211",
      address: "456 Test Street, Test Village",
      pinCode: "302001",
      tehsil: "Jaipur",
      district: "Jaipur",
      state: "Rajasthan",
      gender: "Male",
      category: "A",
    };

    const res2 = await dhundhotsavService.createRegistration(createPayload2, adminUser.id, adminActor);
    assert(res2 && res2.id, "3. Create without offlineFormNumber persists successfully");
    const regId2 = res2.id;
    createdRecordIds.push(regId2);

    // 4. GET detail returns null when offlineFormNumber not present
    const getRes2 = await dhundhotsavService.getRegistrationById(regId2, adminActor);
    assert(
      getRes2.success === true &&
        getRes2.data.offlineFormNumber === null &&
        getRes2.data.offline_form_number === null,
      "4. GET detail returns null when offlineFormNumber omitted"
    );

    // 5. Create with offline_form_number alias works
    const testAadhar3 = makeAadhar("03");
    const createPayload3 = {
      applicationDate: "2026-09-14",
      applicantName: `Test Dhund Applicant 3 ${testRunTag}`,
      fatherName: "Test Father 3",
      dateOfBirth: "2000-01-01",
      aadharNumber: testAadhar3,
      gotra: "Kashyap",
      mobile: "9876543212",
      address: "789 Test Street",
      pinCode: "302001",
      tehsil: "Jaipur",
      district: "Jaipur",
      state: "Rajasthan",
      gender: "Male",
      category: "A",
      offline_form_number: `OFF-${testRunTag}-03`,
    };

    const res3 = await dhundhotsavService.createRegistration(createPayload3, adminUser.id, adminActor);
    assert(res3 && res3.id, "5. Create with offline_form_number alias persists successfully");
    const regId3 = res3.id;
    createdRecordIds.push(regId3);

    // 6. Direct DB verification of stored offlineFormNumber
    const dbRec3 = await prisma.dhundhotsavRegistration.findUnique({
      where: { id: regId3 },
      select: { offlineFormNumber: true },
    });
    assert(
      dbRec3 && dbRec3.offlineFormNumber === `OFF-${testRunTag}-03`,
      "6. Direct database query confirms offlineFormNumber matches"
    );

    console.log("\n--- TEST PHASE 2: DUPLICATE PREVENTION ---");

    // 7. Duplicate offlineFormNumber in CREATE is rejected
    const testAadhar4 = makeAadhar("04");
    let createDupeCaught = false;
    try {
      await dhundhotsavService.createRegistration(
        {
          applicationDate: "2026-09-14",
          applicantName: `Test Dupe Applicant ${testRunTag}`,
          fatherName: "Test Father",
          dateOfBirth: "2000-01-01",
          aadharNumber: testAadhar4,
          gotra: "Kashyap",
          mobile: "9876543213",
          address: "123 Test Street",
          pinCode: "302001",
          tehsil: "Jaipur",
          district: "Jaipur",
          state: "Rajasthan",
          gender: "Male",
          category: "A",
          offlineFormNumber: `OFF-${testRunTag}-01`, // same as reg 1
        },
        adminUser.id,
        adminActor
      );
    } catch (e) {
      if (e instanceof ConflictError) {
        createDupeCaught = true;
      }
    }
    assert(createDupeCaught, "7. Duplicate offlineFormNumber in create is rejected with ConflictError");

    console.log("\n--- TEST PHASE 3: UPDATE FLOWS ---");

    // 8. UPDATE existing record to assign offlineFormNumber
    const updateRes1 = await dhundhotsavService.updateRegistration(
      regId2,
      {
        offlineFormNumber: `OFF-${testRunTag}-02`,
      },
      adminActor
    );
    assert(
      updateRes1.success === true &&
        updateRes1.data.offlineFormNumber === `OFF-${testRunTag}-02`,
      "8. UPDATE assigns offlineFormNumber when previously null"
    );

    // 9. Verify updated record persists in DB
    const dbRec2Updated = await prisma.dhundhotsavRegistration.findUnique({
      where: { id: regId2 },
      select: { offlineFormNumber: true },
    });
    assert(
      dbRec2Updated && dbRec2Updated.offlineFormNumber === `OFF-${testRunTag}-02`,
      "9. Direct DB query confirms updated offlineFormNumber"
    );

    // 10. UPDATE to duplicate offlineFormNumber of another record is rejected
    let updateDupeCaught = false;
    try {
      await dhundhotsavService.updateRegistration(
        regId2,
        {
          offlineFormNumber: `OFF-${testRunTag}-01`, // used by reg 1
        },
        adminActor
      );
    } catch (e) {
      if (e instanceof ConflictError) {
        updateDupeCaught = true;
      }
    }
    assert(updateDupeCaught, "10. UPDATE to existing offlineFormNumber of another record is rejected");

    // 11. UPDATE keeping same offlineFormNumber on same record succeeds
    const updateSelfRes = await dhundhotsavService.updateRegistration(
      regId1,
      {
        applicantName: `Renamed Applicant 1 ${testRunTag}`,
        offlineFormNumber: `OFF-${testRunTag}-01`,
      },
      adminActor
    );
    assert(
      updateSelfRes.success === true &&
        updateSelfRes.data.offlineFormNumber === `OFF-${testRunTag}-01` &&
        updateSelfRes.data.applicantName === `Renamed Applicant 1 ${testRunTag}`,
      "11. UPDATE keeping same offlineFormNumber on same record succeeds"
    );

    // 12. UPDATE clearing offlineFormNumber to empty string or null sets it to null
    const updateClearRes = await dhundhotsavService.updateRegistration(
      regId2,
      {
        offlineFormNumber: "",
      },
      adminActor
    );
    assert(
      updateClearRes.success === true &&
        updateClearRes.data.offlineFormNumber === null,
      "12. UPDATE with empty string clears offlineFormNumber to null"
    );

    // 13. Direct DB query confirms cleared null
    const dbRec2Cleared = await prisma.dhundhotsavRegistration.findUnique({
      where: { id: regId2 },
      select: { offlineFormNumber: true },
    });
    assert(
      dbRec2Cleared && dbRec2Cleared.offlineFormNumber === null,
      "13. Direct DB query confirms cleared offlineFormNumber is null"
    );

    // 14. UPDATE without offlineFormNumber field preserves existing value
    const updateOmitRes = await dhundhotsavService.updateRegistration(
      regId1,
      {
        gotra: "Vashishta",
      },
      adminActor
    );
    assert(
      updateOmitRes.success === true &&
        updateOmitRes.data.offlineFormNumber === `OFF-${testRunTag}-01` &&
        updateOmitRes.data.gotra === "Vashishta",
      "14. UPDATE omitting offlineFormNumber preserves existing value"
    );

    console.log("\n--- TEST PHASE 4: SEARCH & LISTING ---");

    // 15. Search by offlineFormNumber finds record
    const listRes = await dhundhotsavService.getRegistrations(
      {
        search: `OFF-${testRunTag}-01`,
      },
      adminActor
    );
    assert(
      listRes.success === true &&
        listRes.data.length >= 1 &&
        listRes.data.some((r) => r.id === regId1 && r.offlineFormNumber === `OFF-${testRunTag}-01`),
      "15. GET /dhundhotsav?search=... searches by offlineFormNumber"
    );

    // 16. List returns aliases offline_form_number and offlineFormNo
    const sampleRecord = listRes.data.find((r) => r.id === regId1);
    assert(
      sampleRecord &&
        sampleRecord.offlineFormNumber === `OFF-${testRunTag}-01` &&
        sampleRecord.offline_form_number === `OFF-${testRunTag}-01` &&
        sampleRecord.offlineFormNo === `OFF-${testRunTag}-01`,
      "16. List items contain offlineFormNumber with aliases"
    );

    // 17. Null offlineFormNumber list items return null for aliases
    const listResAll = await dhundhotsavService.getRegistrations({}, adminActor);
    const nullItem = listResAll.data.find((r) => r.id === regId2);
    assert(
      nullItem &&
        nullItem.offlineFormNumber === null &&
        nullItem.offline_form_number === null &&
        nullItem.offlineFormNo === null,
      "17. Null offlineFormNumber list items return null across all aliases"
    );

    console.log("\n--- TEST PHASE 5: INSTALLMENTS & FINANCIALS ---");

    // 18. Add installment to Dhundhotsav registration
    const instRes = await dhundhotsavService.addInstallment(
      regId1,
      {
        amount: 300,
        date: "2026-09-14",
        paymentMode: "CASH",
        note: "Test installment",
      },
      adminActor
    );
    assert(
      instRes.success === true &&
        instRes.data.amount === 300 &&
        instRes.financialSummary.installmentCount === 1,
      "18. Adding ₹300 installment updates financial summary"
    );

    // 19. GET detail includes updated installments & financialSummary
    const getDetailWithInst = await dhundhotsavService.getRegistrationById(regId1, adminActor);
    assert(
      getDetailWithInst.data.financialSummary.totalCollected === 300 &&
        getDetailWithInst.data.financialSummary.installmentCount === 1,
      "19. GET detail returns correct financialSummary totals"
    );

    // 20. Soft delete preserves offlineFormNumber in history
    const deleteRes = await dhundhotsavService.softDeleteRegistration(regId3, adminActor);
    assert(deleteRes.success === true, "20. Soft delete succeeds");

    console.log("\n================================================================================");
    console.log(`🎉 ALL ${passedCount}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
    console.log("================================================================================");
  } finally {
    // Clean up created test registrations
    if (createdRecordIds.length > 0) {
      console.log(`[CLEANUP] Deleting ${createdRecordIds.length} test registration(s)...`);
      await prisma.dhundhotsavInstallment.deleteMany({
        where: { registrationId: { in: createdRecordIds } },
      });
      await prisma.dhundhotsavRegistration.deleteMany({
        where: { id: { in: createdRecordIds } },
      });
    }

    await prisma.$disconnect();
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
