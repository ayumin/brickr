import { MAX_POST_LENGTH } from "@enjo/shared";
import { z } from "zod";

/**
 * Request validation at the HTTP boundary (CLAUDE.md §55).
 *
 * Ids are validated as non-empty strings only; existence is checked against the
 * database, which returns a 404 rather than a validation error.
 */

const id = z.string().trim().min(1).max(64);

export const createSimulationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export const createPostSchema = z.object({
  content: z.string().trim().min(1).max(MAX_POST_LENGTH),
  responderIds: z.array(id).max(20).optional(),
  replyTo: id.optional(),
  quoteOf: id.optional(),
});

export const idParams = z.object({ id });
