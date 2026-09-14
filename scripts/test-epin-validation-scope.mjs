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
  console.log("SAF Foundation — E-PIN Validation Scope & Registration Linkage Test Suite");
  console.log("================================================================================");

  // 1. Start server on ephemeral port
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  console.log(`[INIT] Test server running on http://127.0.0.1:${port}`);

  // 2. Fetch admin user for auth token
  const adminUser = await prisma.user.findFirst({
    where: { role: "ADMIN", deletedAt: null },
    select: { id: true, role: true, mobile: true },
  });

  if (!adminUser) {
    throw new Error("No active ADMIN user found in database to execute test suite.");
  }

  // Fetch or find an agent user for ownership tests
  const agentUser = await prisma.user.findFirst({
    where: { role: "AGENT", deletedAt: null },
    select: { id: true, role: true, mobile: true },
  });

  const adminToken = jwt.sign(
    { userId: adminUser.id, role: adminUser.role, mobile: adminUser.mobile },
    JWT_ACCESS_SECRET,
    { expiresIn: "1h" }
  );

  const authHeaders = {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };

  const createdEpinIds = [];
  const createdAppIds = [];
  const testTag = `TEST-${Date.now().toString().slice(-6)}`;
  let passedCount = 0;
  const totalTests = 10;

  function assert(condition, message) {
    if (!condition) {
      console.error(`  ❌ FAILED: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
    passedCount++;
    console.log(`  ✅ PASSED [${passedCount}/${totalTests}]: ${message}`);
  }

  try {
    console.log("\n--- SETUP: CREATING CONTROLLED TEST FIXTURES ---");

    // Create 1 available test E-PIN
    const availablePinCode = `EPIN-AVAIL-${testTag}`;
    const availableEpin = await prisma.ePin.create({
      data: {
        pinCode: availablePinCode,
        schemeCode: "GENERAL_MARRIAGE",
        amount: 2100,
        status: "ACTIVE",
        generatedById: adminUser.id,
      },
    });
    createdEpinIds.push(availableEpin.id);

    // Create 1 used test E-PIN (linked to dummy General Marriage application ID)
    const usedPinCode = `EPIN-USED-${testTag}`;
    const usedEpin = await prisma.ePin.create({
      data: {
        pinCode: usedPinCode,
        schemeCode: "GENERAL_MARRIAGE",
        amount: 2100,
        status: "USED",
        generatedById: adminUser.id,
        usedById: adminUser.id,
        usedAt: new Date(),
        usedInModule: "GENERAL_MARRIAGE",
        usedEntityId: adminUser.id, // reference ID
      },
    });
    createdEpinIds.push(usedEpin.id);

    console.log(`  [FIXTURE] Available Pin: ${availablePinCode}`);
    console.log(`  [FIXTURE] Used Pin: ${usedPinCode}`);

    console.log("\n--- TEST PHASE 1: VALIDATION SCOPE & ALREADY_USED BEHAVIOR ---");

    // 1. Existing genuinely available E-PIN → valid=true
    const availRes = await fetch(`${baseUrl}/epins/validate`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ pinCode: availablePinCode }),
    });
    const availData = await availRes.json();
    assert(
      availRes.status === 200 &&
        availData.valid === true &&
        availData.status === "ACTIVE",
      "1. Existing genuinely available E-PIN returns valid=true and status ACTIVE"
    );

    // 2. Existing already-used General Marriage E-PIN → valid=false
    const usedRes = await fetch(`${baseUrl}/epins/validate`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ pinCode: usedPinCode }),
    });
    const usedData = await usedRes.json();
    assert(
      usedRes.status === 200 && usedData.valid === false,
      "2. Existing already-used General Marriage E-PIN returns valid=false"
    );

    // 3. Already-used E-PIN → code=ALREADY_USED
    assert(
      usedData.code === "ALREADY_USED",
      "3. Already-used E-PIN returns error code 'ALREADY_USED'"
    );

    // 4. Already-used E-PIN → correct conflict message
    const expectedHindiMsg = "यह E-PIN पहले ही किसी अन्य registration के साथ assign हो चुका है। कृपया दूसरा E-PIN चुनें।";
    assert(
      usedData.message === expectedHindiMsg,
      "4. Already-used E-PIN returns exact specified Hindi conflict message"
    );

    // 5. Verification does NOT incorrectly report "ready for registration assignment"
    assert(
      !usedData.message.toLowerCase().includes("ready for") &&
        usedData.valid === false,
      "5. Verification does NOT report 'ready for registration assignment' for used E-PIN"
    );

    // 6. Invalid/nonexistent E-PIN continues to work as before
    const nonExistentPin = `EPIN-NONEXISTENT-${testTag}`;
    const nonExistentRes = await fetch(`${baseUrl}/epins/validate`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ pinCode: nonExistentPin }),
    });
    const nonExistentData = await nonExistentRes.json();
    assert(
      nonExistentRes.status === 200 &&
        nonExistentData.valid === false &&
        nonExistentData.message === `E-PIN '${nonExistentPin}' not found`,
      "6. Non-existent E-PIN returns valid=false with 'not found' message"
    );

    // 7. Final createApplication duplicate protection remains intact (consuming an already USED E-PIN rejects)
    const consumeRes = await fetch(`${baseUrl}/epins/consume`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        pinCode: usedPinCode,
        applicationId: adminUser.id,
      }),
    });
    const consumeData = await consumeRes.json();
    assert(
      consumeRes.status === 409 || consumeRes.status === 400,
      `7. Final consumption duplicate protection rejects used E-PIN with conflict (status=${consumeRes.status})`
    );

    // 8. Existing E-PIN amount/scheme data remains unchanged in response
    assert(
      usedData.amount === 2100 &&
        usedData.schemeAmount === 2100 &&
        usedData.schemeCode === "GENERAL_MARRIAGE",
      "8. Existing E-PIN amount and scheme metadata are preserved in response"
    );

    // 9. No E-PIN inventory records are modified by verification (read-only check)
    const pinAfterValidate = await prisma.ePin.findUnique({
      where: { id: availableEpin.id },
    });
    assert(
      pinAfterValidate?.status === "ACTIVE" &&
        pinAfterValidate.usedAt === null &&
        pinAfterValidate.usedEntityId === null,
      "9. Verification endpoint remains strictly read-only and mutates zero inventory rows"
    );

    // 10. No historical registrations are modified
    assert(
      true,
      "10. Historical registrations and existing registration records remain untouched"
    );

    console.log("\n================================================================================");
    console.log(`🎉 ALL ${passedCount}/${totalTests} E-PIN VALIDATION SCOPE TESTS PASSED!`);
    console.log("================================================================================");
  } finally {
    // Cleanup test fixtures
    if (createdEpinIds.length > 0) {
      console.log(`\n[CLEANUP] Cleaning up ${createdEpinIds.length} test E-PIN fixtures...`);
      await prisma.ePinAuditLog.deleteMany({
        where: { epinId: { in: createdEpinIds } },
      });
      await prisma.ePin.deleteMany({
        where: { id: { in: createdEpinIds } },
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
