import { isValidUuid } from "./compat-helpers";

export type NormalizedListFilters = {
  search?: string;
  gender?: string;
  category?: string;
  address?: string;
  village?: string;
  tehsil?: string;
  reason?: string;
  addedById?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
  /** Opt-in sort override. Only "lastAdded" is recognized today; anything
   *  else falls back to each endpoint's default createdAt-desc ordering. */
  sortBy?: string;
};

/** Normalize frontend filter param names into a consistent shape for services. */
export function normalizeListFilters(raw: Record<string, unknown> = {}): NormalizedListFilters {
  const out: NormalizedListFilters = {};

  const search = raw.search;
  if (search && String(search).trim()) {
    out.search = String(search).trim();
  }

  const genderRaw = raw.gender;
  if (genderRaw && String(genderRaw) !== "all") {
    const g = String(genderRaw);
    out.gender = g.charAt(0).toUpperCase() + g.slice(1).toLowerCase();
  }

  const category = raw.category ?? raw.type;
  if (category && String(category) !== "all") {
    out.category = String(category);
  }

  const village = raw.village;
  if (village && String(village) !== "all") {
    out.village = String(village);
  }

  const address = raw.address;
  if (address && String(address) !== "all") {
    out.address = String(address);
  }

  const tehsil = raw.tehsil;
  if (tehsil && String(tehsil) !== "all") {
    out.tehsil = String(tehsil);
  }

  const reason = raw.reason;
  if (reason && String(reason) !== "all") {
    out.reason = String(reason);
  }

  const addedBy = raw.addedById ?? raw.addedby_id ?? raw.addedbyId;
  if (isValidUuid(String(addedBy))) {
    out.addedById = String(addedBy);
  }

  const fromDate = raw.fromDate ?? raw.dateFrom ?? raw.from;
  const toDate = raw.toDate ?? raw.dateTo ?? raw.to;
  if (fromDate && String(fromDate).trim()) {
    out.fromDate = String(fromDate).trim().split("T")[0];
  }
  if (toDate && String(toDate).trim()) {
    out.toDate = String(toDate).trim().split("T")[0];
  }

  if (raw.page !== undefined && raw.page !== null && raw.page !== "") {
    out.page = parseInt(String(raw.page), 10);
  }
  if (raw.limit !== undefined && raw.limit !== null && raw.limit !== "") {
    out.limit = parseInt(String(raw.limit), 10);
  }

  if (raw.sortBy && String(raw.sortBy).trim()) {
    out.sortBy = String(raw.sortBy).trim();
  }

  return out;
}

export function applyDateRangeToField(
  where: Record<string, unknown>,
  field: string,
  fromDate?: string,
  toDate?: string
) {
  if (!fromDate && !toDate) return;
  const range: Record<string, Date> = {};
  if (fromDate) range.gte = new Date(fromDate);
  if (toDate) {
    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);
    range.lte = end;
  }
  where[field] = range;
}

export function applyAddressContains(
  where: Record<string, unknown>,
  value: string | undefined,
  field = "address"
) {
  if (!value) return;
  where[field] = { contains: value, mode: "insensitive" };
}

/**
 * Standard list ordering: newest first by `createdAt`, with `id` (a random
 * UUID) as a tiebreaker for rows that share the exact same createdAt —
 * common with legacy bulk imports inserted in one batch under a single
 * timestamp. The tiebreaker is only there for pagination stability; being
 * random, tied rows can display in a jumbled order.
 *
 * `createdAt` tracks when a row was written to *this* database, which for
 * backfilled/migrated records can be long after — and in a different order
 * than — the record's real-world registration sequence. A row digitized
 * today for a form filled out months ago will jump to the top of a
 * createdAt-desc list ahead of genuinely newer registrations, which reads
 * as a bug even though the sort is doing exactly what it says.
 *
 * Callers that opt in via `sortBy: "lastAdded"` (currently only
 * payment-management list pages) get `numberField` as the PRIMARY sort key
 * instead — a sequential form/registration number that reflects true
 * registration order regardless of when the row was written to the DB —
 * with createdAt kept as a secondary tiebreak.
 */
export function buildOrderBy(
  sortBy: string | undefined,
  numberField: string,
  options: { nullable?: boolean } = {}
): Array<Record<string, unknown>> {
  if (sortBy === "formNumber" || sortBy === "formNumberSeq") {
    const primary = options.nullable
      ? { [numberField]: { sort: "desc", nulls: "last" } }
      : { [numberField]: "desc" };
    return [primary, { createdAt: "desc" }];
  }
  return [{ createdAt: "desc" }, { id: "desc" }];
}

/**
 * Extracts the trailing numeric portion of a form-number-style string
 * ("M-1259" -> 1259, "F-001" -> 1). Values with no trailing digits
 * (test/placeholder records) sort last under a descending comparison.
 */
export function extractFormNumberSeq(value: string | null | undefined): number {
  const match = String(value ?? "").match(/(\d+)\s*$/);
  return match ? parseInt(match[1], 10) : -1;
}

/**
 * "lastAdded" is meant to reflect true registration order, but a form
 * number like "M-1259" can't be ORDER BY'd directly at the DB level:
 * Postgres sorts it lexicographically, so "M-1000" < "M-999" (4 digits
 * beats 3 alphabetically, not numerically). Sorting by DB insertion order
 * (srNo/createdAt) instead avoids that bug but reintroduces the original
 * problem it was meant to solve -- bulk imports and backfills routinely
 * write an old, low form number long after newer ones, so nearby form
 * numbers end up scattered across opposite ends of the page list.
 *
 * Since Prisma can't ORDER BY a regex-extracted number on a plain string
 * column, rank every matching row's numeric form-number in JS first, then
 * hydrate only the requested page via `hydrate`.
 */
export async function paginateByFormNumberSeq<T extends { id: string }>(
  candidates: Array<{
    id: string;
    formNumber?: string | null;
    mayraNumber?: string | null;
    bimaNumber?: string | null;
    marriageNumber?: string | null;
    applicationDate?: Date | string | null;
    date?: Date | string | null;
    createdAt: Date | string;
  }>,
  page: number | undefined,
  limit: number | undefined,
  hydrate: (ids: string[]) => Promise<T[]>
): Promise<{ data: T[]; total: number }> {
  const getNumStr = (c: any) =>
    c.formNumber ?? c.mayraNumber ?? c.bimaNumber ?? c.marriageNumber ?? null;
  const getDateVal = (c: any) => c.applicationDate ?? c.date ?? c.createdAt;

  const ranked = [...candidates].sort((a, b) => {
    const rawA = getDateVal(a);
    const rawB = getDateVal(b);
    const timeA = rawA ? new Date(rawA).getTime() : 0;
    const timeB = rawB ? new Date(rawB).getTime() : 0;
    const validA = !isNaN(timeA) ? timeA : 0;
    const validB = !isNaN(timeB) ? timeB : 0;

    const dayA = Math.floor(validA / 86400000);
    const dayB = Math.floor(validB / 86400000);

    if (dayA !== dayB) {
      return dayB - dayA; // Latest date on top
    }
    const numA = extractFormNumberSeq(getNumStr(a));
    const numB = extractFormNumberSeq(getNumStr(b));
    const diff = numB - numA; // Descending numerical sequence
    return diff !== 0 ? diff : validB - validA;
  });
  const total = ranked.length;
  const pageSlice =
    page !== undefined && limit !== undefined
      ? ranked.slice((page - 1) * limit, (page - 1) * limit + limit)
      : ranked;
  const pageIds = pageSlice.map((c) => c.id);
  const hydrated = pageIds.length > 0 ? await hydrate(pageIds) : [];
  const byId = new Map(hydrated.map((r) => [r.id, r]));
  const data = pageIds.map((id) => byId.get(id)).filter((r): r is T => Boolean(r));
  return { data, total };
}
