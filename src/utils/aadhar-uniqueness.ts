import { prisma } from "../config/db";
import { ConflictError } from "./errors";

type AadharCheckClient = Pick<
  typeof prisma,
  | "generalApplication"
  | "insuranceApplication"
  | "mayraRegistration"
  | "disabilityCycle"
  | "marriageSewingMachine"
  | "sewingMachineCamp"
>;

export type AadharSourceModel =
  | "generalApplication"
  | "insuranceApplication"
  | "mayraRegistration"
  | "disabilityCycle"
  | "marriageSewingMachine"
  | "sewingMachineCamp";

export const AADHAR_SCHEME_LABELS: Record<AadharSourceModel, string> = {
  generalApplication: "General Application",
  insuranceApplication: "Insurance Application",
  mayraRegistration: "Mayra Registration",
  disabilityCycle: "Disability Cycle",
  marriageSewingMachine: "Marriage Sewing Machine",
  sewingMachineCamp: "Sewing Machine Camp",
};

const AADHAR_SOURCE_MODELS = Object.keys(AADHAR_SCHEME_LABELS) as AadharSourceModel[];

/**
 * Aadhaar numbers must be unique across the whole app, not just within one scheme, so
 * every create/update needs to check all six aadhaar-collecting tables, not just its own —
 * with one carve-out: Mayra Registration is its own island and only checks against other
 * Mayra Registration records, since General Application and Mayra are run as unrelated
 * schemes and legitimately share applicants/Aadhaar numbers.
 * Looks up which scheme (if any) already holds this Aadhaar among live (non-soft-deleted)
 * records. `exclude` lets an edit keep its own current Aadhaar without flagging itself.
 */
export async function findAadharOwner(
  client: AadharCheckClient,
  aadharNumber: string,
  exclude?: { model: AadharSourceModel; id: string },
  sourceModel?: AadharSourceModel
): Promise<{ model: AadharSourceModel; label: string; id: string } | null> {
  const searchModels: AadharSourceModel[] =
    sourceModel === "mayraRegistration"
      ? ["mayraRegistration"]
      : sourceModel === "marriageSewingMachine" || sourceModel === "sewingMachineCamp"
      ? ["marriageSewingMachine", "sewingMachineCamp"]
      : AADHAR_SOURCE_MODELS;
  for (const model of searchModels) {
    const match = await (client[model] as any).findFirst({
      where: { aadharNumber, deletedAt: null },
      select: { id: true },
    });
    if (match && !(exclude && exclude.model === model && exclude.id === match.id)) {
      return { model, label: AADHAR_SCHEME_LABELS[model], id: match.id };
    }
  }
  return null;
}

export async function assertAadharAvailable(
  client: AadharCheckClient,
  aadharNumber: string,
  exclude?: { model: AadharSourceModel; id: string },
  sourceModel?: AadharSourceModel
): Promise<void> {
  const owner = await findAadharOwner(client, aadharNumber, exclude, sourceModel);
  if (owner) {
    throw new ConflictError(
      `This Aadhaar number is already registered under ${owner.label}. Duplicate Aadhaar numbers are not allowed. / यह आधार नंबर पहले से "${owner.label}" में दर्ज है। डुप्लीकेट आधार नंबर की अनुमति नहीं है।`
    );
  }
}
