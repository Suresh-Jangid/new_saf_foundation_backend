import { prisma, PRISMA_TX_OPTIONS, PrismaTransactionClient } from "../../config/db";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { EPinLifecycleStatus, EPinCreateInput, EPinAssignInput, EPinUseInput, EPinBurnInput } from "./configuration.types";
import crypto from "crypto";
import { EPinStatus } from "@prisma/client";

export class EPinService {
  /**
   * Generates a cryptographically random, collision-resistant E-PIN code.
   * Format: EPIN-XXXX-XXXX-XXXX (Alphanumeric uppercase, omitting ambiguous characters)
   */
  private generatePinCode(): string {
    const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // Omits 0, 1, I, O to prevent visual ambiguity
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
      throw new BadRequestError(`E-PIN is already in status '${currentStatus}'`);
    }

    const ALLOWED_TRANSITIONS: Record<EPinLifecycleStatus, EPinLifecycleStatus[]> = {
      ACTIVE: ["ASSIGNED", "BURNT", "USED"],
      ASSIGNED: ["USED", "BURNT"],
      USED: [],   // Terminal state
      BURNT: [],  // Terminal state
    };

    const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(nextStatus)) {
      throw new BadRequestError(
        `Invalid E-PIN state transition from '${currentStatus}' to '${nextStatus}'. Permitted next states for '${currentStatus}': [${allowed.join(", ") || "None (Terminal State)"}].`
      );
    }

    return true;
  }

  /**
   * Generate one or more E-PINs in ACTIVE status (Admin only)
   */
  public async generateEPins(input: EPinCreateInput, txClient?: PrismaTransactionClient) {
    const count = Math.min(Math.max(input.count || 1, 1), 500);
    if (input.amount <= 0 || !Number.isFinite(input.amount)) {
      throw new BadRequestError("E-PIN amount must be a positive number");
    }

    const schemeCode = input.schemeCode.toUpperCase().trim();
    const slabCode = input.slabCode ? input.slabCode.toUpperCase().trim() : null;

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
            amount: input.amount,
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
            remarks: `Generated E-PIN for scheme ${schemeCode} of amount ₹${input.amount}`,
          },
        });

        generatedPins.push(epin);
      }

      const formattedPins = generatedPins.map((p) => ({
        id: p.id,
        pinNumber: p.pinCode,
        pinCode: p.pinCode,
        schemeCode: p.schemeCode,
        schemeTypeId: p.schemeCode,
        slabCode: p.slabCode,
        poolId: p.slabCode,
        amount: Number(p.amount),
        schemeAmount: Number(p.amount),
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
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }));

      return {
        success: true,
        count: generatedPins.length,
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
   * Assign ACTIVE E-PINs to an Agent (ACTIVE -> ASSIGNED)
   */
  public async assignEPins(input: EPinAssignInput) {
    if (input.pinCodes.length === 0) {
      throw new BadRequestError("No pin codes provided for assignment");
    }

    // Validate target agent exists
    const agent = await prisma.user.findFirst({
      where: { id: input.assignedToId, deletedAt: null },
    });
    if (!agent) {
      throw new NotFoundError("Target agent not found");
    }

    return prisma.$transaction(async (tx) => {
      const pins = await tx.ePin.findMany({
        where: { pinCode: { in: input.pinCodes } },
      });

      if (pins.length !== input.pinCodes.length) {
        const foundCodes = new Set(pins.map((p) => p.pinCode));
        const missing = input.pinCodes.filter((c) => !foundCodes.has(c));
        throw new NotFoundError(`E-PIN(s) not found: ${missing.join(", ")}`);
      }

      const updatedPins = [];
      const now = new Date();

      for (const pin of pins) {
        this.validateTransition(pin.status as EPinLifecycleStatus, "ASSIGNED");

        const updated = await tx.ePin.update({
          where: { id: pin.id },
          data: {
            status: "ASSIGNED",
            assignedToId: input.assignedToId,
            assignedAt: now,
          },
        });

        await tx.ePinAuditLog.create({
          data: {
            epinId: pin.id,
            fromStatus: pin.status as EPinStatus,
            toStatus: "ASSIGNED",
            performedById: input.performedById,
            remarks: `Assigned E-PIN to Agent: ${agent.name} (${agent.mobile})`,
          },
        });

        updatedPins.push(updated);
      }

      return {
        success: true,
        assignedCount: updatedPins.length,
        assignedTo: { id: agent.id, name: agent.name, mobile: agent.mobile },
      };
    }, PRISMA_TX_OPTIONS);
  }

  /**
   * Validate and consume an ASSIGNED E-PIN for applicant registration (ASSIGNED -> USED).
   * Verifies schemeCode matching, amount matching, and atomic status lock.
   */
  public async useEPin(input: EPinUseInput, txClient?: PrismaTransactionClient) {
    const execute = async (tx: PrismaTransactionClient) => {
      const pin = await tx.ePin.findUnique({
        where: { pinCode: input.pinCode },
      });

      if (!pin) {
        throw new NotFoundError(`E-PIN code '${input.pinCode}' not found`);
      }

      // 1. Validate State Transition
      this.validateTransition(pin.status as EPinLifecycleStatus, "USED");

      // 2. Validate Scheme and Amount consistency (if provided)
      if (input.expectedSchemeCode && pin.schemeCode !== input.expectedSchemeCode.toUpperCase()) {
        throw new BadRequestError(
          `E-PIN scheme mismatch. E-PIN is for '${pin.schemeCode}', expected '${input.expectedSchemeCode.toUpperCase()}'`
        );
      }

      if (input.expectedAmount !== undefined && Number(pin.amount) !== Number(input.expectedAmount)) {
        throw new BadRequestError(
          `E-PIN amount mismatch. E-PIN value is ₹${Number(pin.amount)}, expected ₹${input.expectedAmount}`
        );
      }

      // 3. Atomically consume PIN
      const now = new Date();
      const updated = await tx.ePin.update({
        where: { id: pin.id },
        data: {
          status: "USED",
          usedById: input.usedById,
          usedAt: now,
          usedInModule: input.usedInModule,
          usedEntityId: input.usedEntityId,
        },
      });

      await tx.ePinAuditLog.create({
        data: {
          epinId: pin.id,
          fromStatus: pin.status as EPinStatus,
          toStatus: "USED",
          performedById: input.usedById,
          remarks: `Consumed E-PIN in module '${input.usedInModule}' for entity ID ${input.usedEntityId}`,
        },
      });

      return {
        success: true,
        id: updated.id,
        pinCode: updated.pinCode,
        amount: Number(updated.amount),
        schemeCode: updated.schemeCode,
        slabCode: updated.slabCode,
        usedAt: updated.usedAt,
      };
    };

    if (txClient) {
      return execute(txClient);
    }
    return prisma.$transaction(execute, PRISMA_TX_OPTIONS);
  }

  /**
   * Burn / Revoke E-PINs (ACTIVE/ASSIGNED -> BURNT)
   */
  public async burnEPins(input: EPinBurnInput) {
    if (input.pinCodes.length === 0) {
      throw new BadRequestError("No pin codes provided for burning");
    }

    return prisma.$transaction(async (tx) => {
      const pins = await tx.ePin.findMany({
        where: { pinCode: { in: input.pinCodes } },
      });

      if (pins.length !== input.pinCodes.length) {
        const foundCodes = new Set(pins.map((p) => p.pinCode));
        const missing = input.pinCodes.filter((c) => !foundCodes.has(c));
        throw new NotFoundError(`E-PIN(s) not found: ${missing.join(", ")}`);
      }

      const burntPins = [];
      const now = new Date();

      for (const pin of pins) {
        this.validateTransition(pin.status as EPinLifecycleStatus, "BURNT");

        const updated = await tx.ePin.update({
          where: { id: pin.id },
          data: {
            status: "BURNT",
            burntById: input.burntById,
            burntAt: now,
            burnReason: input.burnReason,
          },
        });

        await tx.ePinAuditLog.create({
          data: {
            epinId: pin.id,
            fromStatus: pin.status as EPinStatus,
            toStatus: "BURNT",
            performedById: input.burntById,
            remarks: `Burnt/Revoked E-PIN. Reason: ${input.burnReason}`,
          },
        });

        burntPins.push(updated);
      }

      return {
        success: true,
        burntCount: burntPins.length,
        reason: input.burnReason,
      };
    }, PRISMA_TX_OPTIONS);
  }

  /**
   * Query E-PIN status, allocation, and audit history
   */
  public async getEPinDetails(pinCode: string) {
    const pin = await prisma.ePin.findUnique({
      where: { pinCode: pinCode.trim() },
      include: {
        auditLogs: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!pin) {
      throw new NotFoundError(`E-PIN code '${pinCode}' not found`);
    }

    return {
      id: pin.id,
      pinCode: pin.pinCode,
      schemeCode: pin.schemeCode,
      slabCode: pin.slabCode,
      amount: Number(pin.amount),
      status: pin.status,
      generatedById: pin.generatedById,
      assignedToId: pin.assignedToId,
      assignedAt: pin.assignedAt,
      usedById: pin.usedById,
      usedAt: pin.usedAt,
      usedInModule: pin.usedInModule,
      usedEntityId: pin.usedEntityId,
      burntById: pin.burntById,
      burntAt: pin.burntAt,
      burnReason: pin.burnReason,
      createdAt: pin.createdAt,
      auditHistory: pin.auditLogs.map((log) => ({
        id: log.id,
        fromStatus: log.fromStatus,
        toStatus: log.toStatus,
        performedById: log.performedById,
        remarks: log.remarks,
        timestamp: log.createdAt,
      })),
    };
  }
}
