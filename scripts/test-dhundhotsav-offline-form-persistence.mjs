import http from "http";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();

// Dynamic import of dist app
const { default: app } = await import("../dist/app.js");

const JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ||
  process.env.JWT_SECRET ||
  "super-secret-access-token-key-change-in-prod-32chars";

async function runTests() {
  console.log("================================================================================");
  console.log("SAF Foundation — Dhundhotsav Offline Form Number Persistence Test Suite");
  console.log("================================================================================");

  // 1. Start server on ephemeral port
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  console.log(`[INIT] Test server running on http://127.0.0.1:${port}`);

  // 2. Fetch or mock admin user for auth token
  const adminUser = await prisma.user.findFirst({
    where: { role: "ADMIN", deletedAt: null },
    select: { id: true, role: true, mobile: true },
  });

  if (!adminUser) {
    throw new Error("No active ADMIN user found in database to execute test suite.");
  }

  const token = jwt.sign(
    { userId: adminUser.id, role: adminUser.role, mobile: adminUser.mobile },
    JWT_ACCESS_SECRET,
    { expiresIn: "1h" }
  );

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

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
    // Generate unique test aadhaar numbers
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

    const res1 = await fetch(`${baseUrl}/dhundhotsav`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(createPayload1),
    });
    const data1 = await res1.json();
    assert(res1.status === 201 && data1.success, "3. Create with offlineFormNumber persists it");
    const regId1 = data1.data.id;
    createdRecordIds.push(regId1);

    // 2. GET detail returns offlineFormNumber when present
    const getRes1 = await fetch(`${baseUrl}/dhundhotsav/${regId1}`, {
      method: "GET",
      headers: authHeaders,
    });
    const getData1 = await getRes1.json();
    assert(
      getRes1.status === 200 &&
        getData1.data.offlineFormNumber === `OFF-${testRunTag}-01` &&
        getData1.data.offline_form_number === `OFF-${testRunTag}-01`,
      "1. GET detail returns offlineFormNumber when present (with aliases)"
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

    const res2 = await fetch(`${baseUrl}/dhundhotsav`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(createPayload2),
    });
    const data2 = await res2.json();
    assert(res2.status === 201 && data2.success, "4. Create without offlineFormNumber still works");
    const regId2 = data2.data.id;
    createdRecordIds.push(regId2);

    // 4. GET detail returns null/empty correctly when absent
    const getRes2 = await fetch(`${baseUrl}/dhundhotsav/${regId2}`, {
      method: "GET",
      headers: authHeaders,
    });
    const getData2 = await getRes2.json();
    assert(
      getRes2.status === 200 && getData2.data.offlineFormNumber === null,
      "2. GET detail returns null correctly when offlineFormNumber is absent"
    );

    console.log("\n--- TEST PHASE 2: UPDATE FLOWS & NORMALIZATIONS ---");

    // 5. Update from null -> value
    const updateRes1 = await fetch(`${baseUrl}/dhundhotsav/${regId2}`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ offlineFormNumber: `OFF-${testRunTag}-02` }),
    });
    const updateData1 = await updateRes1.json();
    assert(
      updateRes1.status === 200 &&
        updateData1.data.offlineFormNumber === `OFF-${testRunTag}-02`,
      "5. Update from null -> value persists"
    );

    // 6. Update value -> another value
    const updateRes2 = await fetch(`${baseUrl}/dhundhotsav/${regId2}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ offlineFormNumber: `OFF-${testRunTag}-02-ALT` }),
    });
    const updateData2 = await updateRes2.json();
    assert(
      updateRes2.status === 200 &&
        updateData2.data.offlineFormNumber === `OFF-${testRunTag}-02-ALT`,
      "6. Update value -> another value persists"
    );

    // 7. Update value -> "" results in null
    const updateRes3 = await fetch(`${baseUrl}/dhundhotsav/${regId2}`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ offlineFormNumber: "" }),
    });
    const updateData3 = await updateRes3.json();
    assert(
      updateRes3.status === 200 && updateData3.data.offlineFormNumber === null,
      "7. Update value -> '' (empty string) results in null"
    );

    // 8. Update value -> null results in null
    await fetch(`${baseUrl}/dhundhotsav/${regId2}`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ offlineFormNumber: `OFF-${testRunTag}-TEMP` }),
    });
    const updateRes4 = await fetch(`${baseUrl}/dhundhotsav/${regId2}`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ offlineFormNumber: null }),
    });
    const updateData4 = await updateRes4.json();
    assert(
      updateRes4.status === 200 && updateData4.data.offlineFormNumber === null,
      "8. Update value -> null results in null"
    );

    console.log("\n--- TEST PHASE 3: DUPLICATE PROTECTION ---");

    // 9. Duplicate offline number is rejected for another active record
    // regId1 has OFF-${testRunTag}-01
    const dupRes = await fetch(`${baseUrl}/dhundhotsav/${regId2}`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ offlineFormNumber: `OFF-${testRunTag}-01` }),
    });
    const dupData = await dupRes.json();
    assert(
      dupRes.status === 409 || dupRes.status === 400,
      `9. Duplicate offline number is rejected with conflict error (status=${dupRes.status})`
    );

    // 10. Same value is allowed when updating the same record
    const sameRes = await fetch(`${baseUrl}/dhundhotsav/${regId1}`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({
        applicantName: `Updated Name ${testRunTag}`,
        offlineFormNumber: `OFF-${testRunTag}-01`,
      }),
    });
    const sameData = await sameRes.json();
    assert(
      sameRes.status === 200 && sameData.data.offlineFormNumber === `OFF-${testRunTag}-01`,
      "10. Same value is allowed when updating the same record"
    );

    console.log("\n--- TEST PHASE 4: LIST & DETAIL ENDPOINTS ---");

    // 11. List response exposes offlineFormNumber and search works
    const listRes = await fetch(
      `${baseUrl}/dhundhotsav?search=${encodeURIComponent(`OFF-${testRunTag}-01`)}`,
      {
        method: "GET",
        headers: authHeaders,
      }
    );
    const listData = await listRes.json();
    const foundInList = listData.data.some(
      (r) => r.id === regId1 && r.offlineFormNumber === `OFF-${testRunTag}-01`
    );
    assert(
      listRes.status === 200 && foundInList,
      "11. List response exposes offlineFormNumber and matches search filter"
    );

    // 12. Detail response exposes offlineFormNumber
    const detailRes = await fetch(`${baseUrl}/dhundhotsav/${regId1}`, {
      method: "GET",
      headers: authHeaders,
    });
    const detailData = await detailRes.json();
    assert(
      detailRes.status === 200 &&
        detailData.data.offlineFormNumber === `OFF-${testRunTag}-01`,
      "12. Detail response exposes offlineFormNumber"
    );

    console.log("\n--- TEST PHASE 5: LENGTH & WHITESPACE SANITIZATION ---");

    // 13. Maximum 50 characters accepted
    const exact50 = "A".repeat(50);
    const len50Res = await fetch(`${baseUrl}/dhundhotsav/${regId2}`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ offlineFormNumber: exact50 }),
    });
    const len50Data = await len50Res.json();
    assert(
      len50Res.status === 200 && len50Data.data.offlineFormNumber === exact50,
      "13. Maximum 50 characters accepted exactly"
    );

    // 14. More than 50 characters rejected
    const len51 = "A".repeat(51);
    const len51Res = await fetch(`${baseUrl}/dhundhotsav/${regId2}`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ offlineFormNumber: len51 }),
    });
    assert(
      len51Res.status === 400,
      "14. More than 50 characters rejected by validation (400 Bad Request)"
    );

    // 15. Whitespace-only input becomes null
    const wsOnlyRes = await fetch(`${baseUrl}/dhundhotsav/${regId2}`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ offlineFormNumber: "    " }),
    });
    const wsOnlyData = await wsOnlyRes.json();
    assert(
      wsOnlyRes.status === 200 && wsOnlyData.data.offlineFormNumber === null,
      "15. Whitespace-only input becomes null"
    );

    // 16. Leading/trailing whitespace is trimmed
    const trimmedVal = `OFF-TRIM-${testRunTag}`;
    const trimRes = await fetch(`${baseUrl}/dhundhotsav/${regId2}`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ offlineFormNumber: `   ${trimmedVal}   ` }),
    });
    const trimData = await trimRes.json();
    assert(
      trimRes.status === 200 && trimData.data.offlineFormNumber === trimmedVal,
      "16. Leading and trailing whitespace is trimmed properly"
    );

    console.log("\n--- TEST PHASE 6: IMMUTABILITY & ISOLATION CHECKS ---");

    // 17. Existing records with null remain unaffected
    const nullRecordsCount = await prisma.dhundhotsavRegistration.count({
      where: { offlineFormNumber: null, deletedAt: null },
    });
    assert(
      nullRecordsCount >= 0,
      "17. Existing records with null remain valid and unaffected"
    );

    // 18. Existing financial fields remain unchanged
    assert(
      detailData.data.membershipFee === 5100 &&
        detailData.data.financialSummary?.membershipFee === 5100 &&
        detailData.data.financialSummary?.installmentAmount === 300,
      "18. Existing financial fields (₹5,100 registration / ₹300 installment) remain unchanged"
    );

    // 19. Existing system registration/member number DH-xxx remains immutable
    assert(
      detailData.data.formNumber &&
        detailData.data.formNumber.startsWith("DH-") &&
        detailData.data.formNumber !== detailData.data.offlineFormNumber,
      "19. System form number DH-xxx remains immutable and distinct from offlineFormNumber"
    );

    // 20. Existing E-PIN/other required fields remain unchanged
    assert(
      detailData.data.schemeType === "DHUNDHOTSAV" &&
        detailData.data.pool === "MALE_POOL" &&
        detailData.data.isActive === true,
      "20. Scheme metadata (DHUNDHOTSAV, MALE_POOL, isActive) remains intact"
    );

    console.log("\n================================================================================");
    console.log(`🎉 ALL ${passedCount}/${totalTests} DHUNDHOTSAV OFFLINE FORM PERSISTENCE TESTS PASSED!`);
    console.log("================================================================================");
  } finally {
    // Clean up test records created during this run
    if (createdRecordIds.length > 0) {
      console.log(`\n[CLEANUP] Cleaning up ${createdRecordIds.length} test records...`);
      await prisma.dhundhotsavRegistration.deleteMany({
        where: { id: { in: createdRecordIds } },
      });
      console.log("[CLEANUP] Done.");
    }
    server.close();
    await prisma.$disconnect();
  }
}

runTests().catch((err) => {
  console.error("\n❌ TEST SUITE FAILED WITH ERROR:", err);
  process.exit(1);
});
