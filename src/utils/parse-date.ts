import { BadRequestError } from "./errors";

function utcDate(year: number, month: number, day: number): Date {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BadRequestError("Invalid date");
  }
  return date;
}

/** Parse API date strings (YYYY-MM-DD, DD-MM-YYYY, ISO datetime) into a Prisma-safe Date. */
export function parseDateInput(value: unknown, field = "date"): Date {
  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) return value;
    throw new BadRequestError(`Invalid ${field}`);
  }

  const raw = String(value ?? "").trim();
  if (!raw) {
    throw new BadRequestError(`${field} is required`);
  }

  const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (isoDateOnly) {
    return utcDate(
      Number(isoDateOnly[1]),
      Number(isoDateOnly[2]),
      Number(isoDateOnly[3])
    );
  }

  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw);
  if (dmy) {
    return utcDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  throw new BadRequestError(`Invalid ${field}`);
}

/** Like parseDateInput but returns undefined for empty values. */
export function parseOptionalDateInput(
  value: unknown,
  field = "date"
): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return parseDateInput(value, field);
}
