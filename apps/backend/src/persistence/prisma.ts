import { PrismaClient, type Prisma } from "@prisma/client";

export const prisma = new PrismaClient();

export type Db = PrismaClient;

/**
 * The client handed to an interactive `$transaction` callback. Repositories that
 * must write more than one table atomically pass this around.
 */
export type DbTransaction = Prisma.TransactionClient;

/**
 * Duck-typed so callers do not depend on Prisma's error classes. `P2002` is the
 * code Prisma reports for a unique constraint violation.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
