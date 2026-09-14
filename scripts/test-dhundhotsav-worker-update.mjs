import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { DhundhotsavService } from "../dist/modules/dhundhotsav/dhundhotsav.service.js";
import {
  createDhundhotsavSchema,
  updateDhundhotsavSchema,
} from "../dist/modules/dhundhotsav/dhundhotsav.validation.js";
import { resolveAgentSeniorHierarchyBatch } from "../dist/utils/compat-helpers.js";
import { BadRequestError, NotFoundError, ForbiddenError } from "../dist/utils/errors.js";

dotenv.config();

const prisma = new PrismaClient();
const dhundhotsavService = new DhundhotsavService();

async function runTests() {
  console.log("================================================================================");
  console.log("SAF Foundation — Dhundhotsav Worker Update & Reassignment Test Suite");
  console.log("================================================================================");

  // 1. Fetch admin user for actor context
  const adminUser = await prisma.user.findFirst({
    where: { role: "ADMIN", deletedAt: null },
    select: { id: true, role: true, mobile: true, name: true },
  });

  if (!adminUser) {
    throw new Error("No active ADMIN user found in database to execute test suite.");
  }

  const adminActor = { userId: adminUser.id, role: "ADMIN" };

  const createdRecordIds = [];
  const createdUserIds = [];
  const testRunTag = `T${Date.now().toString().slice(-6)}`;
  let passedCount = 0;
  const totalTests = 20;

  function assert(condition, message) {
    if (!condition) {
      console.error(`  ❌ FAILED: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
    passedCount++;
    console.log(`  ✅ PASSED [${passedCount}/${totalTests}]: ${message}`);
  }

  try {
    // 2. Setup distinct Worker A and Worker B fixtures
    console.log("\n--- TEST SETUP: WORKER FIXTURES ---");
    
    // Check existing agents
    const existingAgents = await prisma.user.findMany({
      where: { role: "AGENT", deletedAt: null, isActive: true },
      include: { agentProfile: true },
      take: 2,
    });

    let workerA = existingAgents[0];
    let workerB = existingAgents[1];

    if (!workerA) {
      workerA = await prisma.user.create({
        data: {
          name: `Test Worker A ${testRunTag}`,
          mobile: `9111${testRunTag}`.slice(0, 10),
          passwordHash: "dummy-hash",
          role: "AGENT",
          isActive: true,
          agentProfile: {
            create: {
              employeeId: `EMP-A-${testRunTag}`,
              offlineFormNumber: `1259`,
              workArea: "Jaipur Central",
            },
          },
        },
        include: { agentProfile: true },
      });
      createdUserIds.push(workerA.id);
    }

    if (!workerB || workerB.id === workerA.id) {
      workerB = await prisma.user.create({
        data: {
          name: `Test Worker B ${testRunTag}`,
          mobile: `9222${testRunTag}`.slice(0, 10),
          passwordHash: "dummy-hash",
          role: "AGENT",
          isActive: true,
          agentProfile: {
            create: {
              employeeId: `EMP-B-${testRunTag}`,
              offlineFormNumber: `1260`,
              workArea: "Jaipur North",
            },
          },
        },
        include: { agentProfile: true },
      });
      createdUserIds.push(workerB.id);
    }

    console.log(`Worker A: USER ID = ${workerA.id}, PROFILE ID = ${workerA.agentProfile?.id}, EMP = ${workerA.agentProfile?.employeeId}`);
    console.log(`Worker B: USER ID = ${workerB.id}, PROFILE ID = ${workerB.agentProfile?.id}, EMP = ${workerB.agentProfile?.employeeId}`);

    assert(workerA.id !== workerB.id, "Worker A and Worker B have distinct User IDs");
    if (workerA.agentProfile && workerB.agentProfile) {
      assert(workerA.id !== workerA.agentProfile.id, "Worker A User ID is distinct from Agent Profile ID");
      assert(workerB.id !== workerB.agentProfile.id, "Worker B User ID is distinct from Agent Profile ID");
    }

    const makeAadhar = (seed) => {
      const base = String(Date.now()).slice(-8);
      return `88${seed}${base}`.slice(0, 12);
    };

    console.log("\n--- TEST PHASE 1: ZOD SCHEMA VALIDATION ---");
    // Validate update schema accepts selectedAgentId, agentId, addedById
    const validUpdatePayload1 = updateDhundhotsavSchema.safeParse({
      body: {
        selectedAgentId: workerB.id,
        offlineFormNumber: "OFF-123",
      },
    });
    assert(validUpdatePayload1.success === true, "1. updateDhundhotsavSchema accepts selectedAgentId");

    const validUpdatePayload2 = updateDhundhotsavSchema.safeParse({
      body: {
        agentId: workerB.id,
        addedById: workerA.id,
      },
    });
    assert(validUpdatePayload2.success === true, "2. updateDhundhotsavSchema accepts agentId and addedById aliases");

    const validUpdatePayloadNull = updateDhundhotsavSchema.safeParse({
      body: {
        selectedAgentId: null,
      },
    });
    assert(validUpdatePayloadNull.success === true, "3. updateDhundhotsavSchema accepts nullable selectedAgentId");

    const invalidUpdatePayload = updateDhundhotsavSchema.safeParse({
      body: {
        selectedAgentId: "not-a-valid-uuid",
      },
    });
    assert(invalidUpdatePayload.success === false, "4. updateDhundhotsavSchema rejects non-UUID selectedAgentId");

    console.log("\n--- TEST PHASE 2: CREATE WITH WORKER A ---");
    const testAadhar1 = makeAadhar("01");
    const createResult = await dhundhotsavService.createRegistration(
      {
        applicationDate: "2026-09-15",
        applicantName: `Dhund Reassignment Test ${testRunTag}`,
        fatherName: "Test Father",
        dateOfBirth: "2000-01-01",
        aadharNumber: testAadhar1,
        gotra: "Kashyap",
        mobile: "9876543210",
        address: "123 Test Street",
        pinCode: "302001",
        tehsil: "Jaipur",
        district: "Jaipur",
        state: "Rajasthan",
        gender: "Male",
        category: "A",
        selectedAgentId: workerA.id,
        offlineFormNumber: `OFF-DH-${testRunTag}-01`,
      },
      adminUser.id,
      adminActor
    );

    const regId = createResult.id;
    createdRecordIds.push(regId);
    assert(createResult.addedById === workerA.id, "5. Create registration sets addedById = Worker A User.id");

    // Verify in DB directly
    const initialDb = await prisma.dhundhotsavRegistration.findUnique({
      where: { id: regId },
      select: { addedById: true, applicantName: true, offlineFormNumber: true },
    });
    assert(initialDb.addedById === workerA.id, "6. Initial DB record stored addedById = Worker A User.id (NOT profile ID)");

    console.log("\n--- TEST PHASE 3: ADMIN REASSIGNS TO WORKER B ---");
    const updateResult1 = await dhundhotsavService.updateRegistration(
      regId,
      {
        selectedAgentId: workerB.id,
      },
      adminActor
    );
    assert(updateResult1.success === true, "7. updateRegistration returns success: true");
    assert(updateResult1.data.addedById === workerB.id, "8. updateRegistration response data contains addedById = Worker B User.id");

    console.log("\n--- TEST PHASE 4: GET DETAIL & PERSISTENCE CHECK ---");
    const getResult1 = await dhundhotsavService.getRegistrationById(regId, adminActor);
    assert(getResult1.success === true, "9. getRegistrationById returns success: true");
    assert(getResult1.data.addedById === workerB.id, "10. getRegistrationById data has addedById = Worker B User.id");
    assert(getResult1.data.addedBy?.id === workerB.id, "11. getRegistrationById returns populated addedBy matching Worker B");

    // Direct DB query check
    const updatedDb = await prisma.dhundhotsavRegistration.findUnique({
      where: { id: regId },
      include: {
        addedBy: {
          include: { agentProfile: true },
        },
      },
    });
    assert(updatedDb.addedById === workerB.id, "12. Direct DB query confirms addedById = Worker B User.id");
    if (workerB.agentProfile) {
      assert(updatedDb.addedById !== workerB.agentProfile.id, "13. DB addedById is strictly User ID, NOT Agent Profile ID");
    }

    console.log("\n--- TEST PHASE 5: SENIOR HIERARCHY RESOLUTION ---");
    const hierarchyMap = await resolveAgentSeniorHierarchyBatch([updatedDb.addedById]);
    const resolved = hierarchyMap.get(updatedDb.addedById);
    assert(resolved !== undefined, "14. resolveAgentSeniorHierarchyBatch successfully resolves senior hierarchy for Worker B");

    console.log("\n--- TEST PHASE 6: UPDATE WITHOUT WORKER FIELDS PRESERVES EXISTING WORKER ---");
    const updateResult2 = await dhundhotsavService.updateRegistration(
      regId,
      {
        applicantName: `Dhund Reassignment Renamed ${testRunTag}`,
      },
      adminActor
    );
    assert(updateResult2.success === true, "15. Update other fields succeeds");
    assert(updateResult2.data.addedById === workerB.id, "16. Worker B remains unchanged when worker fields omitted");
    assert(updateResult2.data.applicantName === `Dhund Reassignment Renamed ${testRunTag}`, "Applicant name updated successfully");

    console.log("\n--- TEST PHASE 7: ALIAS FIELDS (addedById, agentId) ---");
    // Reassign back to Worker A using addedById alias
    const updateResult3 = await dhundhotsavService.updateRegistration(
      regId,
      {
        addedById: workerA.id,
      },
      adminActor
    );
    assert(updateResult3.data.addedById === workerA.id, "17. Reassignment via addedById alias succeeds");

    // Reassign to Worker B using agentId alias
    const updateResult4 = await dhundhotsavService.updateRegistration(
      regId,
      {
        agentId: workerB.id,
      },
      adminActor
    );
    assert(updateResult4.data.addedById === workerB.id, "18. Reassignment via agentId alias succeeds");

    console.log("\n--- TEST PHASE 8: TARGET VALIDATION & REJECTIONS ---");
    // Nonexistent user UUID
    let nonExistentRejected = false;
    try {
      await dhundhotsavService.updateRegistration(
        regId,
        {
          selectedAgentId: "00000000-0000-0000-0000-000000000000",
        },
        adminActor
      );
    } catch (e) {
      if (e instanceof NotFoundError) {
        nonExistentRejected = true;
      }
    }
    assert(nonExistentRejected, "19. Nonexistent worker user ID is rejected with NotFoundError");

    // Agent Profile ID test (PROFILE-B passed instead of USER-B)
    if (workerB.agentProfile && workerB.agentProfile.id !== workerB.id) {
      let profileIdRejected = false;
      try {
        await dhundhotsavService.updateRegistration(
          regId,
          {
            selectedAgentId: workerB.agentProfile.id,
          },
          adminActor
        );
      } catch (e) {
        if (e instanceof NotFoundError || e instanceof BadRequestError) {
          profileIdRejected = true;
        }
      }
      assert(profileIdRejected, "20. Agent Profile ID is rejected when passed as worker user ID (preserves User.id FK)");
    } else {
      // Non-UUID invalid ID
      let invalidUuidRejected = false;
      try {
        await dhundhotsavService.updateRegistration(
          regId,
          {
            selectedAgentId: "invalid-uuid-string",
          },
          adminActor
        );
      } catch (e) {
        if (e instanceof BadRequestError) {
          invalidUuidRejected = true;
        }
      }
      assert(invalidUuidRejected, "20. Non-UUID worker ID is rejected with BadRequestError");
    }

    console.log("\n================================================================================");
    console.log(`🎉 ALL ${passedCount}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
    console.log("================================================================================");

  } finally {
    // Clean up created test registrations
    if (createdRecordIds.length > 0) {
      console.log(`[CLEANUP] Deleting ${createdRecordIds.length} test registration(s)...`);
      await prisma.dhundhotsavRegistration.deleteMany({
        where: { id: { in: createdRecordIds } },
      });
    }
    // Clean up created test users
    if (createdUserIds.length > 0) {
      console.log(`[CLEANUP] Deleting ${createdUserIds.length} test user(s)...`);
      await prisma.agentProfile.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }

    await prisma.$disconnect();
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
