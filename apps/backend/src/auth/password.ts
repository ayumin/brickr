import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing (CLAUDE.md §66.8).
 *
 * scrypt from `node:crypto` rather than a bcrypt package: it is a memory-hard
 * KDF of the same class, and §60 tells us not to add dependencies the MVP can
 * do without. The parameters are encoded into the stored string so they can be
 * raised later without invalidating existing hashes.
 */

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const COST = 2 ** 15;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/** Roughly 2x the memory scrypt needs at the parameters above. */
function maxmemFor(cost: number, blockSize: number): number {
  return 256 * cost * blockSize * 2;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEY_BYTES, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
    maxmem: maxmemFor(COST, BLOCK_SIZE),
  });
  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Constant-time verification. Returns false for malformed stored values instead
 * of throwing, so a corrupt row cannot turn a login into a 500.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const cost = Number.parseInt(parts[1] ?? "", 10);
  const blockSize = Number.parseInt(parts[2] ?? "", 10);
  const parallelization = Number.parseInt(parts[3] ?? "", 10);
  if (!Number.isFinite(cost) || !Number.isFinite(blockSize) || !Number.isFinite(parallelization)) {
    return false;
  }

  const salt = Buffer.from(parts[4] ?? "", "base64");
  const expected = Buffer.from(parts[5] ?? "", "base64");
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = await scrypt(password, salt, expected.length, {
    N: cost,
    r: blockSize,
    p: parallelization,
    maxmem: maxmemFor(cost, blockSize),
  });
  return timingSafeEqual(derived, expected);
}

/**
 * Temporary password handed out by an admin reset (§66.10). Base64url of random
 * bytes: readable enough to relay to a user, long enough not to be guessed.
 */
export function generateTemporaryPassword(): string {
  return randomBytes(18).toString("base64url");
}
