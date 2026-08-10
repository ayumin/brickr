/**
 * Initial ModelProfiles.
 *
 * Model names come from the environment so the provider/model behind a profile
 * can change without editing character data.
 */
import { env } from "../config/env.js";
import type { ModelProfile } from "./model-profile.js";

export const MODEL_PROFILE_SEEDS: ModelProfile[] = [
  {
    id: "openai-default",
    providerId: "openai",
    model: env.openai.model,
  },
  {
    id: "anthropic-default",
    providerId: "anthropic",
    model: env.anthropic.model,
  },
  {
    id: "gemini-default",
    providerId: "gemini",
    model: env.gemini.model,
  },
];
