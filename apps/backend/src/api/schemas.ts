import {
  EDITABLE_APPLICATION_SETTING_NAMES,
  FEED_FILTERS,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  MAX_AVATAR_DATA_URL_LENGTH,
  MAX_AVATAR_IMAGE_BYTES,
  MAX_IMAGE_DATA_URL_LENGTH,
  MAX_IMAGE_BYTES,
  MAX_POST_LENGTH,
  isReservedHandle,
} from "@brickr/shared";
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

export const updateSimulationSchema = z.object({
  title: z.string().trim().min(1).max(120),
});

const imageDataUrl = z
  .string()
  .max(MAX_IMAGE_DATA_URL_LENGTH)
  .regex(/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/u)
  .refine((value) => decodedImageSize(value) <= MAX_IMAGE_BYTES, "image exceeds 5 MiB");

const avatarDataUrl = z
  .string()
  .max(MAX_AVATAR_DATA_URL_LENGTH)
  .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u)
  .refine(
    (value) => decodedImageSize(value) <= MAX_AVATAR_IMAGE_BYTES,
    "avatar exceeds 1 MiB",
  );

// Remote URLs already stored before avatar upload was introduced remain valid
// for edits, while the UI only offers cropped image upload from now on.
const legacyRemoteAvatarUrl = z
  .string()
  .trim()
  .url()
  .max(2_048)
  .refine((value) => /^https?:\/\//u.test(value), "avatar URL must use HTTP or HTTPS");
const avatarSource = z.union([legacyRemoteAvatarUrl, avatarDataUrl]);

function decodedImageSize(dataUrl: string): number {
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return Math.floor((encoded.length * 3) / 4) - padding;
}

export const createPostSchema = z
  .object({
    content: z.string().trim().max(MAX_POST_LENGTH),
    imageUrl: imageDataUrl.optional(),
    responderIds: z.array(id).max(20).optional(),
    replyTo: id.optional(),
    quoteOf: id.optional(),
  })
  .superRefine((post, context) => {
    if (post.content.length === 0 && !post.imageUrl) {
      context.addIssue({ code: "custom", message: "content or image is required" });
    }
    if (post.imageUrl && (post.replyTo || post.quoteOf)) {
      context.addIssue({
        code: "custom",
        path: ["imageUrl"],
        message: "images are not allowed on replies or quotes",
      });
    }
  });

const probability = z.number().min(0).max(1);

export const saveCharacterSchema = z.object({
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,32}$/u)
    .refine((value) => !isReservedHandle(value), "handle is reserved"),
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
  avatarUrl: avatarSource.optional(),
});

export const bulkDeleteCharactersSchema = z.object({
  ids: z.array(id).min(1).max(100),
  mode: z.enum(["soft", "hard"]).optional(),
});

export const deleteCharacterQuerySchema = z.object({
  mode: z.enum(["soft", "hard"]).optional(),
});

export const importCharactersCsvSchema = z.object({
  csv: z.string().min(1).max(50 * 1024 * 1024),
});

export const bulkCreateCharactersSchema = z.object({
  count: z.number().int().min(1).max(100),
});

export const saveUserProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500),
  avatarUrl: avatarSource.optional(),
});

export const updateApplicationSettingsSchema = z.object({
  overrides: z
    .partialRecord(
      z.enum(EDITABLE_APPLICATION_SETTING_NAMES),
      z.union([z.string().max(200), z.null()]),
    )
    .refine((value) => Object.keys(value).length > 0, "at least one override is required"),
});

export const idParams = z.object({ id });

export const threadRootParams = z.object({ threadRootId: id });

/**
 * `GET /api/feed` and `GET /api/simulations/:id/feed` (§9.4, §10.1).
 *
 * The page size is not accepted here: it is fixed server-side so a client cannot
 * ask for a page that makes the feed slow. The cursor is passed through as an
 * opaque string — only the feed service knows how to read it, and an unreadable
 * one answers 400 from there rather than being validated into a different shape.
 */
export const feedQuerySchema = z.object({
  filter: z.enum(FEED_FILTERS).optional(),
  cursor: z.string().trim().min(1).max(512).optional(),
});

// -- auth ------------------------------------------------------------------

/** Same shape as a character handle: users and characters share one namespace (§66.13). */
const handle = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,32}$/u)
  .refine((value) => !isReservedHandle(value), "handle is reserved");

const email = z.string().trim().toLowerCase().email().max(254);

/**
 * Only a length floor is enforced. Composition rules push people towards
 * predictable passwords, and there is no reset flow to fall back on (§66.10).
 */
const password = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);

/** Calendar validity and the 18+ gate are checked in the auth service (§66.1). */
const birthdate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const signupSchema = z.object({
  inviteCode: z.string().trim().min(1).max(64),
  email,
  password,
  handle,
  displayName: z.string().trim().min(1).max(50),
  birthdate,
  description: z.string().trim().max(280).optional(),
  country: z.string().trim().max(60).optional(),
  region: z.string().trim().max(60).optional(),
  interests: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  occupation: z.string().trim().max(60).optional(),
  xHandle: z
    .string()
    .trim()
    .transform((value) => value.replace(/^@/u, ""))
    .pipe(z.string().regex(/^[A-Za-z0-9_]{1,15}$/u))
    .optional(),
});

/**
 * Path parameter for handle resolution. A display form such as `@Architect` is
 * accepted and normalized, since that is what a user copies out of a timeline.
 */
export const handleParams = z.object({
  handle: z
    .string()
    .trim()
    .transform((value) => value.replace(/^@/u, "").toLowerCase())
    .pipe(z.string().regex(/^[a-z0-9_]{3,32}$/u)),
});

export const loginSchema = z.object({
  email,
  // Not length-checked: an old password shorter than today's floor must still
  // be able to sign in, and the answer is the same generic error either way.
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

/** `GET /api/users/management` (§66.15). Page size is fixed server-side, not accepted here. */
export const userManagementQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  search: z.string().trim().min(1).max(254).optional(),
});

export const createInviteCodeSchema = z.object({
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
