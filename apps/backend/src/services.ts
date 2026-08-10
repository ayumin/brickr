import { AgentService } from "./agents/agent-service.js";
import { CharacterRepository } from "./characters/character-repository.js";
import { LLMCharacterPersonaGenerator } from "./characters/character-generator.js";
import { CharacterService } from "./characters/character-service.js";
import { env } from "./config/env.js";
import { LLMClient } from "./llm/llm-client.js";
import type { LLMProviderRegistry } from "./llm/provider-registry.js";
import { createProviderRegistry } from "./llm/provider-registry.js";
import { ModelProfileRepository } from "./model-profiles/model-profile-repository.js";
import { ModelProfileService } from "./model-profiles/model-profile-service.js";
import type { Db } from "./persistence/prisma.js";
import { PostRepository } from "./posts/post-repository.js";
import { PostService } from "./posts/post-service.js";
import { ThreadService } from "./posts/thread-service.js";
import { EventHub } from "./simulation/event-hub.js";
import { SimulationRepository } from "./simulation/simulation-repository.js";
import type { SimulationLogger } from "./simulation/simulation-service.js";
import { SimulationService } from "./simulation/simulation-service.js";
import { UserProfileRepository } from "./user-profile/user-profile-repository.js";
import { UserProfileService } from "./user-profile/user-profile-service.js";

export type AppServices = {
  characters: CharacterService;
  modelProfiles: ModelProfileService;
  userProfile: UserProfileService;
  posts: PostService;
  simulations: SimulationService;
  events: EventHub;
  providerRegistry: LLMProviderRegistry;
};

/**
 * Single composition root. Nothing else constructs repositories or services, so
 * swapping a dependency (e.g. a fake LLM in tests) happens here.
 */
export function buildServices(db: Db, logger: SimulationLogger): AppServices {
  const characterRepository = new CharacterRepository(db);
  const modelProfileRepository = new ModelProfileRepository(db);
  const postRepository = new PostRepository(db);
  const simulationRepository = new SimulationRepository(db);
  const userProfileRepository = new UserProfileRepository(db);

  const providerRegistry = createProviderRegistry();
  const llmClient = new LLMClient(
    providerRegistry,
    { timeoutMs: env.llm.timeoutMs, maxRetries: env.llm.maxRetries },
    { debug: (msg) => logger.info({}, msg) },
  );

  const postService = new PostService(
    postRepository,
    characterRepository,
    userProfileRepository,
  );
  const threadService = new ThreadService(postRepository, env.simulation.contextPostLimit);
  const agentService = new AgentService(llmClient, modelProfileRepository);
  const events = new EventHub();

  const simulations = new SimulationService(
    simulationRepository,
    postService,
    characterRepository,
    threadService,
    agentService,
    events,
    {
      minResponders: env.simulation.minResponders,
      maxResponders: env.simulation.maxResponders,
      maxConcurrentCharacters: env.simulation.maxConcurrentCharacters,
      maxCascadeDepth: env.simulation.maxCascadeDepth,
    },
    logger,
  );

  return {
    characters: new CharacterService(
      characterRepository,
      modelProfileRepository,
      new LLMCharacterPersonaGenerator(llmClient),
    ),
    modelProfiles: new ModelProfileService(modelProfileRepository),
    userProfile: new UserProfileService(userProfileRepository),
    posts: postService,
    simulations,
    events,
    providerRegistry,
  };
}
