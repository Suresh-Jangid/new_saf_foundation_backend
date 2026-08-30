import { parseDateInput } from "./parse-date";

function formatAssociationDuration(start: Date, end: Date): string {
  const from = start <= end ? start : end;
  const to = start <= end ? end : start;

  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  let days = to.getDate() - from.getDate();
  if (days < 0) {
    const lastMonth = new Date(to.getFullYear(), to.getMonth(), 0);
    days = lastMonth.getDate() - from.getDate() + to.getDate();
    months -= 1;
    if (months < 0) {
      years -= 1;
      months += 12;
    }
  }

  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? "साल" : "साल"}`);
  if (months > 0) parts.push(`${months} ${months === 1 ? "महीना" : "महीने"}`);
  if (days > 0) parts.push(`${days} ${days === 1 ? "दिन" : "दिन"}`);
  return parts.join(" ") || "0 दिन";
}

/** Resolves the free-text `associatedUntil` field: an explicit non-date string
 * override wins, otherwise it's computed as the duration between
 * membershipJoinDate and date. */
export function resolveAssociatedUntilText(data: Record<string, unknown>): string {
  const raw = data.associatedUntil;
  if (typeof raw === "string" && raw.trim()) {
    const trimmed = raw.trim();
    if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return trimmed;
    }
  }

  try {
    const join = parseDateInput(data.membershipJoinDate, "membershipJoinDate");
    const event = parseDateInput(data.date, "date");
    const duration = formatAssociationDuration(join, event);
    if (duration) return duration;
  } catch {
    // Fall through to default below.
  }

  return "—";
}
