import { prisma, PRISMA_TX_OPTIONS, PrismaTransactionClient } from "../../config/db";
import { BadRequestError, NotFoundError, ConflictError, ForbiddenError } from "../../utils/errors";
import {
  EPinLifecycleStatus,
  EPinInventoryFilter,
  EPinGenerateInput,
  EPinAssignInput,
  EPinValidateInput,
  EPinConsumeInput,
  EPinBurnInput,
  EPinAuditQueryInput,
} from "./epins.types";
import crypto from "crypto";
import { EPinStatus, Prisma } from "@prisma/client";

export class EpinsService {

  /**
   * Generates a cryptographically random, collision-resistant E-PIN code.
   * Format: EPIN-XXXX-XXXX-XXXX (Alphanumeric uppercase, omitting ambiguous characters 0, 1, I, O)
   */
  public generatePinCode(): string {
    const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let result = "EPIN-";
    for (let part = 0; part < 3; part++) {
      let segment = "";
      for (let i = 0; i < 4; i++) {
        const randIdx = crypto.randomInt(0, chars.length);
        segment += chars[randIdx];
      }
      result += segment + (part < 2 ? "-" : "");
    }
    return result;
  }

  /**
   * Validate whether a state transition from `currentStatus` to `nextStatus` is strictly permitted.
   * Allowed transitions:
   * 1. ACTIVE   -> ASSIGNED (Admin allocates PIN to Agent)
   * 2. ACTIVE   -> BURNT    (Admin cancels/revokes active unassigned PIN)
   * 3. ASSIGNED -> USED     (PIN consumed for applicant registration)
   * 4. ASSIGNED -> BURNT    (Admin revokes assigned PIN before usage)
   *
   * All other transitions are strictly rejected.
   */
  public validateTransition(currentStatus: EPinLifecycleStatus, nextStatus: EPinLifecycleStatus): boolean {
    if (currentStatus === nextStatus) {
      throw new ConflictError(`E-PIN is already in status '${currentStatus}'`);
    }

    const ALLOWED_TRANSITIONS: Record<EPinLifecycleStatus, EPinLifecycleStatus[]> = {
      ACTIVE: ["ASSIGNED", "BURNT", "USED"],
      ASSIGNED: ["USED", "BURNT"],
      USED: [],   // Terminal state
      BURNT: [],  // Terminal state
    };

    const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(nextStatus)) {
      throw new ConflictError(
        `Invalid E-PIN state transition from '${currentStatus}' to '${nextStatus}'. Permitted next states for '${currentStatus}': [${allowed.join(", ") || "None (Terminal State)"}].`
      );
    }

    return true;
  }

  /**
   * 1. INVENTORY: Query paginated E-PINs with status summary counts & agent isolation
   */
  public async getInventory(filter: EPinInventoryFilter, actor: { userId: string; role: "ADMIN" | "AGENT" }) {
    const page = Math.max(filter.page || 1, 1);
    const limit = Math.min(Math.max(filter.limit || 50, 1), 500);
    const skip = (page - 1) * limit;

    const where: Prisma.EPinWhereInput = {};

    // Agent RBAC Isolation: Agents can ONLY see E-PINs assigned to them
    if (actor.role === "AGENT") {
      where.assignedToId = actor.userId;
    } else if (filter.assignedAgentId || filter.agentId) {
      where.assignedToId = filter.assignedAgentId || filter.agentId;
    }

    const pinLookup = filter.pinNumber || filter.pinCode;
    if (pinLookup) {
      where.pinCode = { contains: pinLookup.trim(), mode: "insensitive" };
    }

    if (filter.status) {
      where.status = filter.status as EPinStatus;
    }

    const schemeLookup = filter.schemeTypeId || filter.schemeCode;
    if (schemeLookup) {
      where.schemeCode = { equals: schemeLookup.toUpperCase().trim() };
    }

    const slabLookup = filter.poolId || filter.slabCode;
    if (slabLookup) {
      where.slabCode = { equals: slabLookup.toUpperCase().trim() };
    }

    // Global summary counts scoped to actor's permission boundary
    const summaryWhere: Prisma.EPinWhereInput = actor.role === "AGENT" ? { assignedToId: actor.userId } : {};

    const [totalMatching, epinRows, activeCount, assignedCount, usedCount, burntCount] = await Promise.all([
      prisma.ePin.count({ where }),
      prisma.ePin.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.ePin.count({ where: { ...summaryWhere, status: "ACTIVE" } }),
      prisma.ePin.count({ where: { ...summaryWhere, status: "ASSIGNED" } }),
      prisma.ePin.count({ where: { ...summaryWhere, status: "USED" } }),
      prisma.ePin.count({ where: { ...summaryWhere, status: "BURNT" } }),
    ]);

    // Fetch assigned agent names for enriched responses
    const assignedUserIds = [...new Set(epinRows.map((r) => r.assignedToId).filter((id): id is string => Boolean(id)))];
    const agents = assignedUserIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: assignedUserIds } },
          select: { id: true, name: true, mobile: true },
        })
      : [];
    const agentMap = new Map(agents.map((a) => [a.id, a]));

    const data = epinRows.map((pin) => {
      const assignedAgent = pin.assignedToId ? agentMap.get(pin.assignedToId) : undefined;
      return {
        id: pin.id,
        pinNumber: pin.pinCode,
        pinCode: pin.pinCode,
        schemeAmount: Number(pin.amount),
        amount: Number(pin.amount),
        schemeTypeId: pin.schemeCode,
        schemeCode: pin.schemeCode,
        slabCode: pin.slabCode,
        poolId: pin.slabCode,
        status: pin.status,
        generatedById: pin.generatedById,
        assignedToId: pin.assignedToId,
        assignedAgentId: pin.assignedToId,
        assignedAgentName: assignedAgent ? `${assignedAgent.name} (${assignedAgent.mobile})` : null,
        assignedAt: pin.assignedAt,
        usedById: pin.usedById,
        usedAt: pin.usedAt,
        usedInModule: pin.usedInModule,
        usedEntityId: pin.usedEntityId,
        applicationId: pin.usedEntityId,
        burntById: pin.burntById,
        burntAt: pin.burntAt,
        burnReason: pin.burnReason,
        createdAt: pin.createdAt,
        updatedAt: pin.updatedAt,
      };
    });

    const summaryTotal = activeCount + assignedCount + usedCount + burntCount;

    return {
      success: true,
      data,
      summary: {
        total: summaryTotal,
        active: activeCount,
        assigned: assignedCount,
        used: usedCount,
        burnt: burntCount,
      },
      pagination: {
        total: totalMatching,
        page,
        limit,
        totalPages: Math.ceil(totalMatching / limit) || 1,
      },
    };
  }

  /**
   * 2. BATCH GENERATION: Generate batch of cryptographically secure E-PINs (Admin Only)
   */
  public async generateEPins(input: EPinGenerateInput, txClient?: PrismaTransactionClient) {
    const count = Math.min(Math.max(input.count || 1, 1), 500);
    const amount = Number(input.schemeAmount ?? input.amount);

    if (isNaN(amount) || amount <= 0 || !Number.isFinite(amount)) {
      throw new BadRequestError("Valid positive schemeAmount or amount is required");
    }

    const schemeCode = (input.schemeTypeId || input.schemeCode || "GENERAL_MARRIAGE").toUpperCase().trim();
    const slabCode = (input.poolId || input.slabCode) ? (input.poolId || input.slabCode)!.toUpperCase().trim() : null;

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const batchEntropy = crypto.randomBytes(3).toString("hex").toUpperCase();
    const batchNumber = `BATCH-${dateStr}-${batchEntropy}`;

    const execute = async (tx: PrismaTransactionClient) => {
      const generatedPins = [];

      for (let i = 0; i < count; i++) {
        let pinCode = "";
        let isUnique = false;
        let attempts = 0;

        while (!isUnique && attempts < 10) {
          pinCode = this.generatePinCode();
          const existing = await tx.ePin.findUnique({ where: { pinCode } });
          if (!existing) isUnique = true;
          attempts++;
        }

        if (!isUnique) {
          throw new Error("Failed to generate unique E-PIN code after multiple attempts");
        }

        const epin = await tx.ePin.create({
          data: {
            pinCode,
            schemeCode,
            slabCode,
            amount,
            status: "ACTIVE",
            generatedById: input.generatedById,
          },
        });

        await tx.ePinAuditLog.create({
          data: {
            epinId: epin.id,
            fromStatus: null,
            toStatus: "ACTIVE",
            performedById: input.generatedById,
            remarks: input.remarks ? `${input.remarks} (${batchNumber})` : `Batch generated (${batchNumber}) for scheme ${schemeCode} of amount ₹${amount}`,
          },
        });

        generatedPins.push(epin);
      }

      const formattedPins = generatedPins.map((p) => ({
        id: p.id,
        pinNumber: p.pinCode,
        pinCode: p.pinCode,
        schemeAmount: Number(p.amount),
        amount: Number(p.amount),
        schemeTypeId: p.schemeCode,
        schemeCode: p.schemeCode,
        slabCode: p.slabCode,
        poolId: p.slabCode,
        status: p.status,
        generatedById: p.generatedById,
        assignedToId: null,
        assignedAgentId: null,
        assignedAgentName: null,
        assignedAt: null,
        usedById: null,
        usedAt: null,
        usedInModule: null,
        usedEntityId: null,
        applicationId: null,
        burntById: null,
        burntAt: null,
        burnReason: null,
        batchNumber,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }));

      return {
        success: true,
        message: `Successfully generated ${generatedPins.length} E-PIN(s)`,
        count: generatedPins.length,
        batchNumber,
        data: formattedPins,
        pins: formattedPins,
        epin: formattedPins[0] || null,
      };
    };

    if (txClient) {
      return execute(txClient);
    }
    return prisma.$transaction(execute, PRISMA_TX_OPTIONS);
  }

  /**
   * 3. AGENT ASSIGNMENT: Assign ACTIVE E-PINs to Agent (Admin Only)
   */
  public async assignEPins(input: EPinAssignInput) {
    const targetAgent = await prisma.user.findFirst({
      where: { id: input.agentId, deletedAt: null },
    });

    if (!targetAgent) {
      throw new NotFoundError("Target agent not found");
    }

    if (targetAgent.role !== "AGENT" && targetAgent.role !== "ADMIN") {
      throw new BadRequestError("E-PINs can only be assigned to valid registered agents");
    }

    const pinLookups = input.pinNumbers || input.pinCodes || [];
    const idLookups = input.epinIds || [];

    return prisma.$transaction(async (tx) => {
      const pins = await tx.ePin.findMany({
        where: {
          OR: [
            ...(idLookups.length > 0 ? [{ id: { in: idLookups } }] : []),
            ...(pinLookups.length > 0 ? [{ pinCode: { in: pinLookups } }] : []),
          ],
        },
      });

      if (pins.length === 0) {
        throw new NotFoundError("No matching E-PINs found to assign");
      }

      const now = new Date();
      const updatedPins = [];

      for (const pin of pins) {
        this.validateTransition(pin.status as EPinLifecycleStatus, "ASSIGNED");

        const updated = await tx.ePin.update({
          where: { id: pin.id },
          data: {
            status: "ASSIGNED",
            assignedToId: input.agentId,
            assignedAt: now,
          },
        });

        await tx.ePinAuditLog.create({
          data: {
            epinId: pin.id,
            fromStatus: pin.status as EPinStatus,
            toStatus: "ASSIGNED",
            performedById: input.performedById,
            remarks: input.remarks || `Assigned E-PIN to Agent: ${targetAgent.name} (${targetAgent.mobile})`,
          },
        });

        updatedPins.push(updated);
      }

      return {
        success: true,
        message: `Successfully assigned ${updatedPins.length} E-PIN(s) to ${targetAgent.name}`,
        assignedCount: updatedPins.length,
        assignedTo: {
          id: targetAgent.id,
          name: targetAgent.name,
          mobile: targetAgent.mobile,
        },
      };
    }, PRISMA_TX_OPTIONS);
  }

  /**
   * 4. VALIDATION: Check E-PIN validity, status, and agent ownership without state mutation
   */
  public async validateEPin(
    input: EPinValidateInput,
    actor: { userId: string; role: "ADMIN" | "AGENT" },
    txClient?: PrismaTransactionClient
  ) {
    const rawCode = (input.pinNumber || input.pinCode || "").trim();
    if (!rawCode) {
      return {
        success: false,
        valid: false,
        message: "PIN number/code is required",
      };
    }

    const client = txClient || prisma;
    const pin = await client.ePin.findUnique({
      where: { pinCode: rawCode },
    });

    if (!pin) {
      return {
        success: false,
        valid: false,
        message: `E-PIN '${rawCode}' not found`,
      };
    }

    const effectiveAgentId = input.agentId || (actor.role === "AGENT" ? actor.userId : undefined);

    // Check agent ownership rule for already-assigned PINs
    if (effectiveAgentId && pin.assignedToId && pin.assignedToId !== effectiveAgentId) {
      return {
        success: true,
        valid: false,
        status: pin.status,
        pinNumber: pin.pinCode,
        pinCode: pin.pinCode,
        schemeAmount: Number(pin.amount),
        amount: Number(pin.amount),
        schemeTypeId: pin.schemeCode,
        schemeCode: pin.schemeCode,
        slabCode: pin.slabCode,
        poolId: pin.slabCode,
        assignedAgentId: pin.assignedToId,
        message: "E-PIN is assigned to another agent and cannot be used by you",
      };
    }

    if (pin.status === "ACTIVE") {
      if (actor.role === "AGENT" && pin.assignedToId !== actor.userId) {
        return {
          success: true,
          valid: false,
          status: pin.status,
          pinNumber: pin.pinCode,
          pinCode: pin.pinCode,
          schemeAmount: Number(pin.amount),
          amount: Number(pin.amount),
          schemeTypeId: pin.schemeCode,
          schemeCode: pin.schemeCode,
          slabCode: pin.slabCode,
          poolId: pin.slabCode,
          assignedAgentId: pin.assignedToId,
          message: "E-PIN is currently unassigned. Please contact Admin to assign this E-PIN to your account",
        };
      }
      return {
        success: true,
        valid: true,
        status: pin.status,
        pinNumber: pin.pinCode,
        pinCode: pin.pinCode,
        schemeAmount: Number(pin.amount),
        amount: Number(pin.amount),
        schemeTypeId: pin.schemeCode,
        schemeCode: pin.schemeCode,
        slabCode: pin.slabCode,
        poolId: pin.slabCode,
        assignedAgentId: pin.assignedToId,
        message: "E-PIN is active and ready for registration assignment",
      };
    }

    if (pin.status === "USED") {
      return {
        success: true,
        valid: false,
        status: pin.status,
        pinNumber: pin.pinCode,
        pinCode: pin.pinCode,
        schemeAmount: Number(pin.amount),
        amount: Number(pin.amount),
        schemeTypeId: pin.schemeCode,
        schemeCode: pin.schemeCode,
        slabCode: pin.slabCode,
        poolId: pin.slabCode,
        assignedAgentId: pin.assignedToId,
        message: "E-PIN has already been used and cannot be reused",
      };
    }

    if (pin.status === "BURNT") {
      return {
        success: true,
        valid: false,
        status: pin.status,
        pinNumber: pin.pinCode,
        pinCode: pin.pinCode,
        schemeAmount: Number(pin.amount),
        amount: Number(pin.amount),
        schemeTypeId: pin.schemeCode,
        schemeCode: pin.schemeCode,
        slabCode: pin.slabCode,
        poolId: pin.slabCode,
        assignedAgentId: pin.assignedToId,
        message: `E-PIN has been revoked/burnt: ${pin.burnReason || "No reason specified"}`,
      };
    }

    return {
      success: true,
      valid: true,
      status: pin.status,
      pinNumber: pin.pinCode,
      pinCode: pin.pinCode,
      schemeAmount: Number(pin.amount),
      amount: Number(pin.amount),
      schemeTypeId: pin.schemeCode,
      schemeCode: pin.schemeCode,
      slabCode: pin.slabCode,
      poolId: pin.slabCode,
      assignedAgentId: pin.assignedToId,
      message: "E-PIN is valid and ready for consumption",
    };
  }

  /**
   * 5. CONSUMPTION: Atomically consume an E-PIN with optional registration-time agent assignment
   */
  public async consumeEPin(
    input: EPinConsumeInput,
    actor: { userId: string; role: "ADMIN" | "AGENT" },
    txClient?: PrismaTransactionClient
  ) {
    const rawCode = (input.pinNumber || input.pinCode || "").trim();
    if (!rawCode) {
      throw new BadRequestError("pinNumber or pinCode is required");
    }

    const execute = async (tx: PrismaTransactionClient) => {
      const pin = await tx.ePin.findUnique({
        where: { pinCode: rawCode },
      });

      if (!pin) {
        throw new NotFoundError(`E-PIN code '${rawCode}' not found`);
      }

      // Terminal state checks
      if (pin.status === "USED") {
        throw new ConflictError("E-PIN has already been used and cannot be consumed again");
      }

      if (pin.status === "BURNT") {
        throw new ConflictError(`E-PIN is burnt/revoked: ${pin.burnReason || "Revoked"}`);
      }

      const targetAgentId = input.agentId || input.selectedAgentId || (actor.role === "AGENT" ? actor.userId : null);

      let updated;
      const now = new Date();

      if (pin.status === "ACTIVE") {
        if (actor.role === "ADMIN") {
          if (targetAgentId) {
            // Validate target agent exists
            const targetAgent = await tx.user.findFirst({
              where: { id: targetAgentId, deletedAt: null },
            });
            if (!targetAgent) {
              throw new NotFoundError("Target agent for E-PIN assignment was not found");
            }

            // Step 1: Registration-time atomic assignment (ACTIVE -> ASSIGNED)
            await tx.ePinAuditLog.create({
              data: {
                epinId: pin.id,
                fromStatus: "ACTIVE",
                toStatus: "ASSIGNED",
                performedById: actor.userId,
                remarks: `Registration-time assigned to Agent: ${targetAgent.name} (${targetAgent.mobile})`,
              },
            });

            // Step 2: Immediate consumption (ASSIGNED -> USED)
            updated = await tx.ePin.update({
              where: { id: pin.id },
              data: {
                status: "USED",
                assignedToId: targetAgentId,
                assignedAt: now,
                usedById: actor.userId,
                usedAt: now,
                usedInModule: input.module || "APPLICATIONS",
                usedEntityId: input.applicationId,
              },
            });

            await tx.ePinAuditLog.create({
              data: {
                epinId: pin.id,
                fromStatus: "ASSIGNED",
                toStatus: "USED",
                performedById: actor.userId,
                remarks: input.remarks || `Consumed for application ${input.applicationId} (${input.applicantName || "Beneficiary"})`,
              },
            });
          } else {
            // Admin direct consumption without agent assignment (ACTIVE -> USED)
            updated = await tx.ePin.update({
              where: { id: pin.id },
              data: {
                status: "USED",
                usedById: actor.userId,
                usedAt: now,
                usedInModule: input.module || "APPLICATIONS",
                usedEntityId: input.applicationId,
              },
            });

            await tx.ePinAuditLog.create({
              data: {
                epinId: pin.id,
                fromStatus: "ACTIVE",
                toStatus: "USED",
                performedById: actor.userId,
                remarks: input.remarks || `Consumed for application ${input.applicationId} (${input.applicantName || "Beneficiary"})`,
              },
            });
          }
        } else {
          // Agent role cannot claim unassigned E-PINs directly
          throw new ForbiddenError("E-PIN is currently unassigned. Please contact Admin to assign this E-PIN to your account");
        }
      } else if (pin.status === "ASSIGNED") {
        if (targetAgentId && pin.assignedToId && pin.assignedToId !== targetAgentId) {
          throw new ConflictError("E-PIN is assigned to another agent and cannot be used for this registration");
        }

        if (actor.role === "AGENT" && pin.assignedToId !== actor.userId) {
          throw new ForbiddenError("You do not have permission to consume this E-PIN (not assigned to you)");
        }

        // Transition ASSIGNED -> USED
        updated = await tx.ePin.update({
          where: { id: pin.id },
          data: {
            status: "USED",
            usedById: actor.userId,
            usedAt: now,
            usedInModule: input.module || "APPLICATIONS",
            usedEntityId: input.applicationId,
          },
        });

        await tx.ePinAuditLog.create({
          data: {
            epinId: pin.id,
            fromStatus: "ASSIGNED",
            toStatus: "USED",
            performedById: actor.userId,
            remarks: input.remarks || `Consumed for application ${input.applicationId} (${input.applicantName || "Beneficiary"})`,
          },
        });
      } else {
        throw new ConflictError(`Invalid E-PIN state '${pin.status}' for consumption`);
      }

      return {
        success: true,
        message: "E-PIN consumed successfully",
        data: {
          id: updated.id,
          pinNumber: updated.pinCode,
          pinCode: updated.pinCode,
          schemeAmount: Number(updated.amount),
          amount: Number(updated.amount),
          schemeTypeId: updated.schemeCode,
          schemeCode: updated.schemeCode,
          status: updated.status,
          applicationId: input.applicationId,
          applicantName: input.applicantName || null,
          usedAt: updated.usedAt,
        },
      };
    };

    if (txClient) {
      return execute(txClient);
    }
    return prisma.$transaction(execute, PRISMA_TX_OPTIONS);
  }

  /**
   * 6. BURN / REVOKE: Irreversibly burn active or assigned E-PIN (Admin Only)
   */
  public async burnEPin(input: EPinBurnInput, actor: { userId: string; role: "ADMIN" | "AGENT" }) {
    if (!input.reason || input.reason.trim().length < 3) {
      throw new BadRequestError("A valid mandatory reason (at least 3 characters) is required to burn an E-PIN");
    }

    const pinLookup = (input.pinNumber || input.pinCode || "").trim();

    return prisma.$transaction(async (tx) => {
      const pin = await tx.ePin.findFirst({
        where: {
          OR: [
            ...(input.epinId ? [{ id: input.epinId }] : []),
            ...(pinLookup ? [{ pinCode: pinLookup }] : []),
          ],
        },
      });

      if (!pin) {
        throw new NotFoundError("E-PIN not found to burn");
      }

      this.validateTransition(pin.status as EPinLifecycleStatus, "BURNT");

      const now = new Date();
      const updated = await tx.ePin.update({
        where: { id: pin.id },
        data: {
          status: "BURNT",
          burntById: actor.userId,
          burntAt: now,
          burnReason: input.reason.trim(),
        },
      });

      await tx.ePinAuditLog.create({
        data: {
          epinId: pin.id,
          fromStatus: pin.status as EPinStatus,
          toStatus: "BURNT",
          performedById: actor.userId,
          remarks: `Burnt/Revoked: ${input.reason.trim()}`,
        },
      });

      return {
        success: true,
        message: "E-PIN burnt successfully",
        burntCount: 1,
        pinNumber: updated.pinCode,
        reason: input.reason.trim(),
      };
    }, PRISMA_TX_OPTIONS);
  }

  /**
   * 7. AUDIT: Query chronological E-PIN audit history
   */
  public async getAuditHistory(input: EPinAuditQueryInput, actor: { userId: string; role: "ADMIN" | "AGENT" }) {
    const page = Math.max(input.page || 1, 1);
    const limit = Math.min(Math.max(input.limit || 50, 1), 500);
    const skip = (page - 1) * limit;

    const where: Prisma.EPinAuditLogWhereInput = {};
    const epinWhere: Prisma.EPinWhereInput = {};

    if (input.epinId) {
      where.epinId = input.epinId;
    }

    const pinLookup = input.pinNumber || input.pinCode;
    if (pinLookup) {
      epinWhere.pinCode = { contains: pinLookup.trim(), mode: "insensitive" };
    }

    if (actor.role === "AGENT") {
      epinWhere.assignedToId = actor.userId;
    } else if (input.agentId) {
      epinWhere.assignedToId = input.agentId;
    }

    if (input.applicationId) {
      epinWhere.usedEntityId = input.applicationId;
    }

    if (Object.keys(epinWhere).length > 0) {
      where.epin = epinWhere;
    }

    const [total, logs] = await Promise.all([
      prisma.ePinAuditLog.count({ where }),
      prisma.ePinAuditLog.findMany({
        where,
        include: {
          epin: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    const actorIds = [...new Set(logs.map((l) => l.performedById))];
    const actors = actorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true, role: true, mobile: true },
        })
      : [];
    const actorMap = new Map(actors.map((a) => [a.id, a]));

    const data = logs.map((log) => {
      const performer = actorMap.get(log.performedById);
      return {
        id: log.id,
        epinId: log.epinId,
        pinNumber: log.epin?.pinCode || null,
        pinCode: log.epin?.pinCode || null,
        schemeCode: log.epin?.schemeCode || null,
        schemeAmount: log.epin ? Number(log.epin.amount) : null,
        fromStatus: log.fromStatus,
        toStatus: log.toStatus,
        performedById: log.performedById,
        performedBy: performer
          ? {
              id: performer.id,
              name: performer.name,
              role: performer.role,
              mobile: performer.mobile,
            }
          : { id: log.performedById, name: "System/Admin", role: "ADMIN" },
        remarks: log.remarks,
        applicationId: log.epin?.usedEntityId || null,
        agentId: log.epin?.assignedToId || null,
        timestamp: log.createdAt,
        createdAt: log.createdAt,
      };
    });

    return {
      success: true,
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}
