import type { Character } from "../characters/character.js";
import type { LLMClient } from "../llm/llm-client.js";
import { LLMError } from "../llm/provider.js";
import type { ModelProfileRepository } from "../model-profiles/model-profile-repository.js";
import type { Post } from "../posts/post.js";
import type { ResponseAction } from "../simulation/simulation.js";
import type { HandleResolver } from "./prompt-builder.js";
import { buildMessages, buildSystemPrompt } from "./prompt-builder.js";
import { sanitizeGeneratedPost } from "./sanitize.js";

/** Posts are short; this is generous headroom, not a target. */
const MAX_OUTPUT_TOKENS = 400;

/**
 * A character points at a model profile that does not exist.
 *
 * This is a seed/configuration mistake, not a provider failure, so it is
 * deliberately NOT an `LLMError` — reporting it as one would attribute a config
 * bug to whichever provider happened to be named, and make it look retryable.
 */
export class ModelProfileNotFoundError extends Error {
  constructor(
    readonly modelProfileId: string,
    readonly characterId: string,
  ) {
    super(
      `character "${characterId}" references unknown model profile "${modelProfileId}"`,
    );
    this.name = "ModelProfileNotFoundError";
  }
}

export type GenerateRequest = {
  character: Character;
  target: Post;
  posts: Post[];
  action: ResponseAction;
  resolveHandle: HandleResolver;
};

export type GeneratedPost = {
  content: string;
  action: ResponseAction;
  providerId: string;
  model: string;
  /** Absent when the provider does not report usage (CLAUDE.md §66.4). */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

/**
 * Turns a character plus a thread into post text.
 *
 * Owns the Character → ModelProfile → provider indirection so callers never
 * touch provider ids or model names.
 */
export class AgentService {
  constructor(
    private readonly llm: LLMClient,
    private readonly modelProfiles: ModelProfileRepository,
  ) {}

  async generate(request: GenerateRequest): Promise<GeneratedPost> {
    const profile = await this.modelProfiles.findById(request.character.modelProfileId);
    if (!profile) {
      throw new ModelProfileNotFoundError(
        request.character.modelProfileId,
        request.character.id,
      );
    }

    const result = await this.llm.generate(profile.providerId, {
      model: profile.model,
      systemPrompt: buildSystemPrompt(request.character),
      messages: buildMessages(request),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // Some warmth in the sampling keeps characters from converging.
      // Providers that reject `temperature` ignore this.
      temperature: 0.9,
    });

    const content = sanitizeGeneratedPost(result.text, request.character.handle);
    if (content.length === 0) {
      throw new LLMError("generated post was empty after cleanup", profile.providerId, true);
    }

    return {
      content,
      action: request.action,
      providerId: result.providerId,
      model: result.model,
      ...(result.usage ? { usage: result.usage } : {}),
    };
  }
}
