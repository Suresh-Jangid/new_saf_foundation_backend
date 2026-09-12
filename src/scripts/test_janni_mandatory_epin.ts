import { prisma } from "../config/db";
import { JanniDeliveryService } from "../modules/janni-delivery/janni-delivery.service";
import { EpinsService } from "../modules/epins/epins.service";
import { createJanniDeliverySchema } from "../modules/janni-delivery/janni-delivery.validation";

async function runJanniMandatoryEpinTests() {
  console.log("================================================================================");
  console.log("SAF FOUNDATION — JANNI DELIVERY MANDATORY E-PIN VERIFICATION TEST SUITE");
  console.log("================================================================================\n");

  const janniService = new JanniDeliveryService();
  const epinsService = new EpinsService();

  // Find admin user
  const adminUser = await prisma.user.findFirst({
    where: { role: "ADMIN", deletedAt: null },
  });
  if (!adminUser) {
    throw new Error("Admin user not found for test execution");
  }

  const createdRegistrationIds: string[] = [];
  const createdEPinCodes: string[] = [];

  try {
    // --------------------------------------------------------------------------
    // TEST 1: Schema Rejection for missing, empty, or whitespace E-PIN
    // --------------------------------------------------------------------------
    console.log("TEST 1: Schema Rejection for missing/empty/whitespace E-PIN...");

    const basePayload = {
      applicationDate: "2026-09-12",
      applicantName: "Test Mother Janni",
      fatherName: "Test Father",
      dateOfBirth: "1997-01-01",
      aadharNumber: "998877665544",
      gotra: "Prajapat",
      mobile: "9876543210",
      address: "Test Village",
      pinCode: "344022",
      tehsil: "Balotra",
      district: "Balotra",
      totalAmount: 1500,
      paymentAmount: 1000,
      paymentMode: "CASH",
    };

    const resMissing = createJanniDeliverySchema.safeParse({ body: { ...basePayload } });
    if (resMissing.success) throw new Error("Schema failed to reject missing E-PIN");
    console.log("  ✅ Missing E-PIN rejected by schema");

    const resEmpty = createJanniDeliverySchema.safeParse({ body: { ...basePayload, epinCode: "" } });
    if (resEmpty.success) throw new Error("Schema failed to reject empty E-PIN");
    console.log("  ✅ Empty string E-PIN rejected by schema");

    const resWhitespace = createJanniDeliverySchema.safeParse({ body: { ...basePayload, epinCode: "    " } });
    if (resWhitespace.success) throw new Error("Schema failed to reject whitespace-only E-PIN");
    console.log("  ✅ Whitespace-only E-PIN rejected by schema");

    // --------------------------------------------------------------------------
    // TEST 2: Service Rejection for missing / empty E-PIN
    // --------------------------------------------------------------------------
    console.log("\nTEST 2: Service Rejection without E-PIN...");
    let serviceRejectedNoPin = false;
    try {
      await janniService.createRegistration(
        {
          ...basePayload,
          aadharNumber: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
        } as any,
        adminUser.id,
        { userId: adminUser.id, role: "ADMIN" }
      );
    } catch (err: any) {
      if (err.message.includes("E-PIN आवश्यक है") || err.message.includes("E-PIN is required")) {
        serviceRejectedNoPin = true;
        console.log(`  ✅ Service rejected create without E-PIN with error: "${err.message}"`);
      } else {
        throw err;
      }
    }
    if (!serviceRejectedNoPin) throw new Error("Service failed to reject create without E-PIN");

    // --------------------------------------------------------------------------
    // TEST 3: Invalid E-PIN (Non-existent code)
    // --------------------------------------------------------------------------
    console.log("\nTEST 3: Service Rejection for Non-existent / Invalid E-PIN...");
    let rejectedInvalidPin = false;
    try {
      await janniService.createRegistration(
        {
          ...basePayload,
          aadharNumber: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
          epinCode: "EPIN-FAKE-9999-0000",
        } as any,
        adminUser.id,
        { userId: adminUser.id, role: "ADMIN" }
      );
    } catch (err: any) {
      if (err.message.includes("E-PIN Validation Failed") || err.message.includes("not found")) {
        rejectedInvalidPin = true;
        console.log(`  ✅ Invalid E-PIN rejected with message: "${err.message}"`);
      } else {
        throw err;
      }
    }
    if (!rejectedInvalidPin) throw new Error("Non-existent E-PIN was not rejected");

    // --------------------------------------------------------------------------
    // TEST 4 & 5: Generate Active E-PIN, then create with Valid E-PIN
    // --------------------------------------------------------------------------
    console.log("\nTEST 4 & 5: Creating with Valid E-PIN + Cash ₹1000...");
    const genResult1 = await epinsService.generateEPins({
      count: 1,
      schemeAmount: 1000,
      schemeCode: "JANNI_DELIVERY",
      generatedById: adminUser.id,
      remarks: "Test Mandatory E-PIN Janni",
    });
    const validPin1 = genResult1.pins[0].pinCode;
    createdEPinCodes.push(validPin1);
    console.log(`  Generated test E-PIN 1: ${validPin1} (Status: ACTIVE)`);

    const createdReg1 = await janniService.createRegistration(
      {
        ...basePayload,
        applicantName: "Valid E-PIN Applicant 1",
        aadharNumber: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
        epinCode: validPin1,
        paymentAmount: 1000,
        paymentMode: "CASH",
      } as any,
      adminUser.id,
      { userId: adminUser.id, role: "ADMIN" }
    );
    createdRegistrationIds.push(createdReg1.id);
    console.log(`  ✅ Registration created: ID=${createdReg1.id}, FormNumber=${createdReg1.formNumber}, epinCode=${createdReg1.epinCode}`);
    if (createdReg1.epinCode !== validPin1) {
      throw new Error(`Expected saved epinCode '${validPin1}', got '${createdReg1.epinCode}'`);
    }

    // Verify E-PIN is now USED in DB
    const usedPinRecord = await prisma.ePin.findUnique({ where: { pinCode: validPin1 } });
    if (!usedPinRecord || usedPinRecord.status !== "USED") {
      throw new Error(`Expected E-PIN status 'USED', got '${usedPinRecord?.status}'`);
    }
    console.log(`  ✅ E-PIN status verified as USED in DB (Used in module: ${usedPinRecord.usedInModule})`);

    // Verify Installment was created
    const installment1 = await prisma.janniDeliveryInstallment.findFirst({
      where: { registrationId: createdReg1.id, deletedAt: null },
    });
    if (!installment1 || Number(installment1.amount) !== 1000) {
      throw new Error("Expected initial installment of ₹1000");
    }
    console.log(`  ✅ Initial installment of ₹1000 Cash verified.`);

    // --------------------------------------------------------------------------
    // TEST 6: Reject Re-using already USED E-PIN
    // --------------------------------------------------------------------------
    console.log("\nTEST 6: Rejection of already USED E-PIN...");
    let rejectedUsedPin = false;
    try {
      await janniService.createRegistration(
        {
          ...basePayload,
          applicantName: "Re-used Pin Applicant",
          aadharNumber: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
          epinCode: validPin1, // Already USED
        } as any,
        adminUser.id,
        { userId: adminUser.id, role: "ADMIN" }
      );
    } catch (err: any) {
      if (err.message.includes("already been used") || err.message.includes("Validation Failed")) {
        rejectedUsedPin = true;
        console.log(`  ✅ Used E-PIN re-use rejected with message: "${err.message}"`);
      } else {
        throw err;
      }
    }
    if (!rejectedUsedPin) throw new Error("Used E-PIN was not rejected");

    // --------------------------------------------------------------------------
    // TEST 7: Reject BURNT E-PIN
    // --------------------------------------------------------------------------
    console.log("\nTEST 7: Rejection of BURNT E-PIN...");
    const genResult2 = await epinsService.generateEPins({
      count: 1,
      schemeAmount: 1000,
      schemeCode: "JANNI_DELIVERY",
      generatedById: adminUser.id,
      remarks: "Test Burnt Pin Janni",
    });
    const burntPin = genResult2.pins[0].pinCode;
    createdEPinCodes.push(burntPin);

    await epinsService.burnEPin(
      { pinCode: burntPin, reason: "Test Revocation", burntById: adminUser.id },
      { userId: adminUser.id, role: "ADMIN" }
    );

    let rejectedBurntPin = false;
    try {
      await janniService.createRegistration(
        {
          ...basePayload,
          applicantName: "Burnt Pin Applicant",
          aadharNumber: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
          epinCode: burntPin,
        } as any,
        adminUser.id,
        { userId: adminUser.id, role: "ADMIN" }
      );
    } catch (err: any) {
      if (err.message.includes("revoked") || err.message.includes("burnt") || err.message.includes("Validation Failed")) {
        rejectedBurntPin = true;
        console.log(`  ✅ Burnt E-PIN rejected with message: "${err.message}"`);
      } else {
        throw err;
      }
    }
    if (!rejectedBurntPin) throw new Error("Burnt E-PIN was not rejected");

    // --------------------------------------------------------------------------
    // TEST 8: Valid E-PIN with paymentAmount = 0
    // --------------------------------------------------------------------------
    console.log("\nTEST 8: Valid E-PIN with paymentAmount = 0...");
    const genResult3 = await epinsService.generateEPins({
      count: 1,
      schemeAmount: 1000,
      schemeCode: "JANNI_DELIVERY",
      generatedById: adminUser.id,
      remarks: "Test Zero Payment Amount Janni",
    });
    const validPinZeroPay = genResult3.pins[0].pinCode;
    createdEPinCodes.push(validPinZeroPay);

    const createdRegZeroPay = await janniService.createRegistration(
      {
        ...basePayload,
        applicantName: "Zero Payment Amount Applicant",
        aadharNumber: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
        epinCode: validPinZeroPay,
        paymentAmount: 0,
      } as any,
      adminUser.id,
      { userId: adminUser.id, role: "ADMIN" }
    );
    createdRegistrationIds.push(createdRegZeroPay.id);
    console.log(`  ✅ Created registration with paymentAmount 0: ID=${createdRegZeroPay.id}, epinCode=${createdRegZeroPay.epinCode}`);

    // Verify E-PIN was still consumed
    const consumedZeroPayPin = await prisma.ePin.findUnique({ where: { pinCode: validPinZeroPay } });
    if (consumedZeroPayPin?.status !== "USED") {
      throw new Error(`Expected E-PIN to be 'USED', got '${consumedZeroPayPin?.status}'`);
    }
    console.log(`  ✅ E-PIN consumed successfully even with paymentAmount 0`);

    // --------------------------------------------------------------------------
    // TEST 9: Concurrent requests attempting to use the SAME E-PIN
    // --------------------------------------------------------------------------
    console.log("\nTEST 9: Concurrency safety with same E-PIN...");
    const genResult4 = await epinsService.generateEPins({
      count: 1,
      schemeAmount: 1000,
      schemeCode: "JANNI_DELIVERY",
      generatedById: adminUser.id,
      remarks: "Test Concurrency Janni",
    });
    const concurrentPin = genResult4.pins[0].pinCode;
    createdEPinCodes.push(concurrentPin);

    const concurrentResults = await Promise.allSettled([
      janniService.createRegistration(
        {
          ...basePayload,
          applicantName: "Concurrent Applicant 1",
          aadharNumber: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
          epinCode: concurrentPin,
        } as any,
        adminUser.id,
        { userId: adminUser.id, role: "ADMIN" }
      ),
      janniService.createRegistration(
        {
          ...basePayload,
          applicantName: "Concurrent Applicant 2",
          aadharNumber: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
          epinCode: concurrentPin,
        } as any,
        adminUser.id,
        { userId: adminUser.id, role: "ADMIN" }
      ),
    ]);

    const concFulfilled = concurrentResults.filter((r) => r.status === "fulfilled");
    const concRejected = concurrentResults.filter((r) => r.status === "rejected");

    if (concFulfilled.length > 0) {
      createdRegistrationIds.push((concFulfilled[0] as PromiseFulfilledResult<any>).value.id);
    }

    console.log(`  Concurrency result: ${concFulfilled.length} succeeded, ${concRejected.length} rejected.`);
    if (concFulfilled.length !== 1 || concRejected.length !== 1) {
      throw new Error(`Expected exactly 1 success and 1 rejection for concurrent same-pin consumption, got ${concFulfilled.length} succeeded, ${concRejected.length} rejected`);
    }
    console.log("  ✅ Exactly one registration consumed the E-PIN; the second was safely rejected.");

    // --------------------------------------------------------------------------
    // TEST 10: PIN Number Alias compatibility (`pinNumber` vs `epinCode`)
    // --------------------------------------------------------------------------
    console.log("\nTEST 10: PinNumber Alias compatibility...");
    const genResult5 = await epinsService.generateEPins({
      count: 1,
      schemeAmount: 1000,
      schemeCode: "JANNI_DELIVERY",
      generatedById: adminUser.id,
      remarks: "Test pinNumber alias Janni",
    });
    const aliasPin = genResult5.pins[0].pinCode;
    createdEPinCodes.push(aliasPin);

    const createdWithAlias = await janniService.createRegistration(
      {
        ...basePayload,
        applicantName: "PinNumber Alias Applicant",
        aadharNumber: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
        pinNumber: aliasPin, // Using pinNumber alias instead of epinCode
      } as any,
      adminUser.id,
      { userId: adminUser.id, role: "ADMIN" }
    );
    createdRegistrationIds.push(createdWithAlias.id);
    console.log(`  ✅ Registration created using pinNumber alias: epinCode=${createdWithAlias.epinCode}`);

    console.log("\n================================================================================");
    console.log("🎉 ALL 10 JANNI MANDATORY E-PIN TESTS PASSED PERFECTLY!");
    console.log("================================================================================\n");
  } finally {
    // Clean up created test applications so live database remains pristine
    for (const regId of createdRegistrationIds) {
      try {
        await janniService.softDeleteRegistration(regId, { userId: adminUser.id, role: "ADMIN" });
        console.log(`Cleaned up test registration: ${regId}`);
      } catch (e) {
        console.warn(`Could not soft delete test registration ${regId}:`, e);
      }
    }
  }
}

runJanniMandatoryEpinTests()
  .catch((err) => {
    console.error("TEST SUITE FAILED:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
