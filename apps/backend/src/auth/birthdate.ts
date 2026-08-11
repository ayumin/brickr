import { MIN_SIGNUP_AGE_YEARS } from "@brickr/shared";

/**
 * Self-declared birthdate handling (CLAUDE.md §66.1).
 *
 * Nothing here verifies the claim; §66.10 deliberately trusts self-declaration.
 * The only job is a correct calendar age so the 18+ gate does not drift by a day
 * around birthdays or leap years.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** Parses `YYYY-MM-DD` as UTC midnight, rejecting values like `2000-02-31`. */
export function parseBirthdate(value: string): Date | null {
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return roundTrips ? date : null;
}

/** Completed years between the two dates. Negative dates in the future give 0. */
export function ageOn(birthdate: Date, on: Date): number {
  let age = on.getUTCFullYear() - birthdate.getUTCFullYear();
  const beforeBirthday =
    on.getUTCMonth() < birthdate.getUTCMonth() ||
    (on.getUTCMonth() === birthdate.getUTCMonth() && on.getUTCDate() < birthdate.getUTCDate());
  if (beforeBirthday) age -= 1;
  return Math.max(age, 0);
}

export function isOldEnough(birthdate: Date, on: Date = new Date()): boolean {
  if (birthdate.getTime() > on.getTime()) return false;
  return ageOn(birthdate, on) >= MIN_SIGNUP_AGE_YEARS;
}
