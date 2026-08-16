import { describe, expect, it } from "vitest";
import type { Character } from "../characters/character.js";
import type { LLMClient } from "../llm/llm-client.js";
import type { LLMGenerateRequest, LLMGenerateResult, ProviderId } from "../llm/provider.js";
import { LLMError } from "../llm/provider.js";
import type { ModelProfile } from "../model-profiles/model-profile.js";
import type { ModelProfileRepository } from "../model-profiles/model-profile-repository.js";
import type { Post } from "../posts/post.js";
import type { ResponseAction } from "../simulation/simulation.js";
import { AgentService, CharacterModelProfileMissingError } from "./agent-service.js";

type ClientCall = { providerId: ProviderId; request: LLMGenerateRequest };

type Responder = (providerId: ProviderId, request: LLMGenerateRequest) => string;

/**
 * Stands in for the whole LLM layer. Proves the simulation side never needs a
 * provider SDK, an API key or a network call.
 */
function makeFakeClient(
  respond: Responder,
  usage?: LLMGenerateResult["usage"],
): { client: LLMClient; calls: ClientCall[] } {
  const calls: ClientCall[] = [];

  const fake = {
    generate(providerId: ProviderId, request: LLMGenerateRequest): Promise<LLMGenerateResult> {
      calls.push({ providerId, request });
      return Promise.resolve({
        text: respond(providerId, request),
        model: request.model,
        providerId,
        ...(usage ? { usage } : {}),
      });
    },
  };

  // Test-only cast. `LLMClient` is a class with private fields and a
  // registry-shaped constructor, so a structural fake is not assignable to it
  // without routing through `unknown`. This is the only cast of its kind here.
  return { client: fake as unknown as LLMClient, calls };
}

function makeFakeModelProfiles(profiles: readonly ModelProfile[]): {
  repository: ModelProfileRepository;
  lookups: string[];
} {
  const lookups: string[] = [];

  const fake = {
    findById(id: string): Promise<ModelProfile | null> {
      lookups.push(id);
      return Promise.resolve(profiles.find((profile) => profile.id === id) ?? null);
    },
    findAll(): Promise<ModelProfile[]> {
      return Promise.resolve([...profiles]);
    },
  };

  // Test-only cast, same reason as above: the repository holds a private Prisma
  // client field. No database is touched.
  return { repository: fake as unknown as ModelProfileRepository, lookups };
}

function makeCharacter(overrides: Partial<Character> & { id: string }): Character {
  return {
    handle: overrides.id,
    displayName: "設計者",
    description: "論点を整理する",
    rolePrompt: "議論の論点を整理する。",
    tonePrompt: "冷静で簡潔。",
    interests: ["設計", "運用"],
    activityLevel: 0.7,
    responseProbability: 0.7,
    replyProbability: 0.6,
    quoteProbability: 0.2,
    influence: 0.6,
    modelProfileId: "openai-default",
    ...overrides,
  };
}

function makePost(overrides: Partial<Post> & { id: string }): Post {
  return {
    roomId: "sim-1",
    authorId: "user-1",
    content: "RAGって本当に必要？",
    mentions: [],
    replyTo: null,
    quoteOf: null,
    threadRootId: overrides.id,
    threadActivityAt: new Date("2026-01-01T00:00:01Z"),
    createdAt: new Date("2026-01-01T00:00:01Z"),
    ...overrides,
  };
}

const OPENAI_PROFILE: ModelProfile = {
  id: "openai-default",
  providerId: "openai",
  model: "test-openai-model",
};

const ANTHROPIC_PROFILE: ModelProfile = {
  id: "anthropic-default",
  providerId: "anthropic",
  model: "test-anthropic-model",
};

const architect = makeCharacter({ id: "architect" });
const targetPost = makePost({ id: "post-1" });

function makeRequest(
  character: Character,
  action: ResponseAction = "reply",
): Parameters<AgentService["generate"]>[0] {
  return {
    character,
    target: targetPost,
    posts: [targetPost],
    action,
    resolveHandle: (authorId: string) => (authorId === "you" ? "you" : authorId),
  };
}

describe("AgentService.generate", () => {
  describe("model profile resolution (CLAUDE.md §23)", () => {
    it("resolves the character's modelProfileId", async () => {
      const { client } = makeFakeClient(() => "本文です。");
      const { repository, lookups } = makeFakeModelProfiles([OPENAI_PROFILE, ANTHROPIC_PROFILE]);

      await new AgentService(client, repository).generate(makeRequest(architect));

      expect(lookups).toEqual(["openai-default"]);
    });

    it("passes the profile's providerId and model to the LLM client", async () => {
      const { client, calls } = makeFakeClient(() => "本文です。");
      const { repository } = makeFakeModelProfiles([OPENAI_PROFILE, ANTHROPIC_PROFILE]);

      await new AgentService(client, repository).generate(makeRequest(architect));

      expect(calls).toHaveLength(1);
      const call = calls[0];
      expect(call).toBeDefined();
      expect(call?.providerId).toBe("openai");
      expect(call?.request.model).toBe("test-openai-model");
    });

    it("echoes back the provider and model that served the request", async () => {
      const { client } = makeFakeClient(() => "本文です。");
      const { repository } = makeFakeModelProfiles([OPENAI_PROFILE, ANTHROPIC_PROFILE]);

      const generated = await new AgentService(client, repository).generate(
        makeRequest(makeCharacter({ id: "architect", modelProfileId: "anthropic-default" })),
      );

      expect(generated.providerId).toBe("anthropic");
      expect(generated.model).toBe("test-anthropic-model");
    });

    it("passes the provider's token usage through for per-user tracking (CLAUDE.md §66.4)", async () => {
      const usage = { inputTokens: 120, outputTokens: 40, totalTokens: 160 };
      const { client } = makeFakeClient(() => "本文です。", usage);
      const { repository } = makeFakeModelProfiles([OPENAI_PROFILE]);

      const generated = await new AgentService(client, repository).generate(
        makeRequest(architect),
      );

      expect(generated.usage).toEqual(usage);
    });

    it("omits usage when the provider does not report it", async () => {
      const { client } = makeFakeClient(() => "本文です。");
      const { repository } = makeFakeModelProfiles([OPENAI_PROFILE]);

      const generated = await new AgentService(client, repository).generate(
        makeRequest(architect),
      );

      expect(generated).not.toHaveProperty("usage");
    });

    it("changes provider and model without changing the persona prompt", async () => {
      const { client, calls } = makeFakeClient(() => "本文です。");
      const { repository } = makeFakeModelProfiles([OPENAI_PROFILE, ANTHROPIC_PROFILE]);
      const service = new AgentService(client, repository);

      await service.generate(makeRequest(architect));
      await service.generate(
        makeRequest({ ...architect, modelProfileId: "anthropic-default" }),
      );

      expect(calls).toHaveLength(2);
      const first = calls[0];
      const second = calls[1];
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(first?.providerId).toBe("openai");
      expect(second?.providerId).toBe("anthropic");
      expect(second?.request.systemPrompt).toBe(first?.request.systemPrompt);
    });

    it("throws CharacterModelProfileMissingError when the model profile does not exist", async () => {
      const { client, calls } = makeFakeClient(() => "本文です。");
      const { repository } = makeFakeModelProfiles([OPENAI_PROFILE]);

      const promise = new AgentService(client, repository).generate(
        makeRequest(makeCharacter({ id: "architect", modelProfileId: "missing-profile" })),
      );

      // A config mistake must not masquerade as a (retryable) provider failure.
      await expect(promise).rejects.toBeInstanceOf(CharacterModelProfileMissingError);
      await expect(promise).rejects.not.toBeInstanceOf(LLMError);
      await expect(promise).rejects.toThrow(/missing-profile/u);
      expect(calls).toHaveLength(0);
    });
  });

  describe("prompt hand-off", () => {
    it("sends a non-empty system prompt that identifies the character", async () => {
      const { client, calls } = makeFakeClient(() => "本文です。");
      const { repository } = makeFakeModelProfiles([OPENAI_PROFILE]);

      await new AgentService(client, repository).generate(makeRequest(architect));

      const systemPrompt = calls[0]?.request.systemPrompt ?? "";
      expect(systemPrompt.length).toBeGreaterThan(0);
      expect(systemPrompt).toContain(architect.handle);
    });

    it("sends at least one user message describing the thread", async () => {
      const { client, calls } = makeFakeClient(() => "本文です。");
      const { repository } = makeFakeModelProfiles([OPENAI_PROFILE]);

      await new AgentService(client, repository).generate(makeRequest(architect));

      const messages = calls[0]?.request.messages ?? [];
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]?.role).toBe("user");
      expect(messages[0]?.content).toContain(targetPost.content);
    });

    it("sends attached post images to the LLM with a matching transcript label", async () => {
      const { client, calls } = makeFakeClient(() => "画像を見ると、この構成は分かりやすいです。");
      const { repository } = makeFakeModelProfiles([OPENAI_PROFILE]);
      const imagePost = makePost({
        id: "image-post",
        content: "この図をどう思う？",
        imageUrl: "data:image/png;base64,aGVsbG8=",
      });

      await new AgentService(client, repository).generate({
        ...makeRequest(architect),
        target: imagePost,
        posts: [imagePost],
      });

      const message = calls[0]?.request.messages[0];
      expect(message?.content).toContain("[添付画像1]");
      expect(message?.images).toEqual([
        { mediaType: "image/png", data: "aGVsbG8=" },
      ]);
    });

    it("bounds the generated length and never sends credential-shaped fields", async () => {
      const { client, calls } = makeFakeClient(() => "本文です。");
      const { repository } = makeFakeModelProfiles([OPENAI_PROFILE]);

      await new AgentService(client, repository).generate(makeRequest(architect));

      const request = calls[0]?.request;
      expect(request).toBeDefined();
      expect(request?.maxOutputTokens).toBeGreaterThan(0);

      const keys = Object.keys(request ?? {});
      expect(keys.sort()).toEqual(
        ["maxOutputTokens", "messages", "model", "systemPrompt", "temperature"].sort(),
      );
      for (const key of keys) {
        expect(key.toLowerCase()).not.toContain("key");
        expect(key.toLowerCase()).not.toContain("secret");
        expect(key.toLowerCase()).not.toContain("credential");
      }
    });
  });

  describe("sanitisation of the generated text", () => {
    it("unwraps quotes the model added around the post", async () => {
      const { client } = makeFakeClient(() => "「小規模なら単純検索から始めてもよいと思います。」");
      const { repository } = makeFakeModelProfiles([OPENAI_PROFILE]);

      const generated = await new AgentService(client, repository).generate(
        makeRequest(architect),
      );

      expect(generated.content).toBe("小規模なら単純検索から始めてもよいと思います。");
    });

    it("strips a byline the model prepended with its own handle", async () => {
      const { client } = makeFakeClient(() => "@architect: 本文です。");
      const { repository } = makeFakeModelProfiles([OPENAI_PROFILE]);

      const generated = await new AgentService(client, repository).generate(
        makeRequest(architect),
      );

      expect(generated.content).toBe("本文です。");
    });

    it("throws LLMError when the response sanitises down to nothing", async () => {
      const { client } = makeFakeClient(() => "   \n\n  ");
      const { repository } = makeFakeModelProfiles([OPENAI_PROFILE]);

      const promise = new AgentService(client, repository).generate(makeRequest(architect));

      await expect(promise).rejects.toBeInstanceOf(LLMError);
      await expect(promise).rejects.toMatchObject({ providerId: "openai", retryable: true });
    });
  });

  describe("result shape", () => {
    it("echoes the requested action back unchanged", async () => {
      const { client } = makeFakeClient(() => "本文です。");
      const { repository } = makeFakeModelProfiles([OPENAI_PROFILE]);
      const service = new AgentService(client, repository);

      for (const action of ["reply", "quote", "post"] as const) {
        const generated = await service.generate(makeRequest(architect, action));
        expect(generated.action).toBe(action);
      }
    });
  });
});
