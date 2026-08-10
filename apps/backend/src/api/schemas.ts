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

const probability = z.number().min(0).max(1);

export const saveCharacterSchema = z.object({
  handle: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,32}$/u),
  displayName: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  rolePrompt: z.string().trim().min(1).max(4_000),
  tonePrompt: z.string().trim().min(1).max(4_000),
  dialectPrompt: z.string().trim().max(2_000).optional(),
  interests: z.array(z.string().trim().min(1).max(80)).max(20),
  activityLevel: probability,
  responseProbability: probability,
  replyProbability: probability,
  quoteProbability: probability,
  influence: probability,
  modelProfileId: id,
  avatarUrl: z.string().trim().url().max(2_048).optional(),
});

export const saveUserProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500),
  avatarUrl: z.string().trim().url().max(2_048).optional(),
});

export const idParams = z.object({ id });
