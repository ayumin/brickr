import { AgentService } from "./agents/agent-service.js";
import { AuthService } from "./auth/auth-service.js";
import { SessionRepository } from "./auth/session-repository.js";
import { UserAccountRepository } from "./auth/user-account-repository.js";
import { env } from "./config/env.js";
import { CharacterRepository } from "./characters/character-repository.js";
import { LLMCharacterPersonaGenerator } from "./characters/character-generator.js";
import { CharacterService } from "./characters/character-service.js";
import { LLMClient } from "./llm/llm-client.js";
import { LLMUsageTracker } from "./llm/usage-tracker.js";
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
import { SimulationAnalysisService } from "./simulation/simulation-analysis-service.js";
import type { SimulationLogger } from "./simulation/simulation-service.js";
import { SimulationService } from "./simulation/simulation-service.js";
import { UserProfileRepository } from "./user-profile/user-profile-repository.js";
import { UserProfileService } from "./user-profile/user-profile-service.js";
import { ApplicationSettingsService } from "./settings/application-settings-service.js";
import { ApplicationSettingRepository } from "./settings/application-setting-repository.js";
import { RuntimeSettings } from "./settings/runtime-settings.js";

export type AppServices = {
  auth: AuthService;
  characters: CharacterService;
  modelProfiles: ModelProfileService;
  userProfile: UserProfileService;
  posts: PostService;
  simulations: SimulationService;
  simulationAnalysis: SimulationAnalysisService;
  events: EventHub;
  providerRegistry: LLMProviderRegistry;
  applicationSettings: ApplicationSettingsService;
};

/**
 * Single composition root. Nothing else constructs repositories or services, so
 * swapping a dependency (e.g. a fake LLM in tests) happens here.
 */
export async function buildServices(db: Db, logger: SimulationLogger): Promise<AppServices> {
  const characterRepository = new CharacterRepository(db);
  const modelProfileRepository = new ModelProfileRepository(db);
  const postRepository = new PostRepository(db);
  const simulationRepository = new SimulationRepository(db);
  const userProfileRepository = new UserProfileRepository(db);
  const applicationSettingRepository = new ApplicationSettingRepository(db);
  const userAccountRepository = new UserAccountRepository(db);
  const sessionRepository = new SessionRepository(db);
  const runtime = new RuntimeSettings();

  const providerRegistry = createProviderRegistry();
  const usageTracker = new LLMUsageTracker();
  const llmClient = new LLMClient(
    providerRegistry,
    runtime.values.llm,
    { debug: (msg) => logger.info({}, msg) },
    usageTracker,
    (providerId) =>
      providerId === "openai" || providerId === "anthropic" || providerId === "gemini"
        ? runtime.values.models[providerId]
        : undefined,
  );

  const postService = new PostService(
    postRepository,
    characterRepository,
    userProfileRepository,
  );
  const threadService = new ThreadService(
    postRepository,
    () => runtime.values.simulation.contextPostLimit,
  );
  const agentService = new AgentService(llmClient, modelProfileRepository);
  const events = new EventHub();

  const simulations = new SimulationService(
    simulationRepository,
    postService,
    characterRepository,
    threadService,
    agentService,
    events,
    runtime.values.simulation,
    logger,
  );
  const simulationAnalysis = new SimulationAnalysisService(
    simulationRepository,
    postService,
    llmClient,
    providerRegistry,
  );

  const modelProfiles = new ModelProfileService(
    modelProfileRepository,
    providerRegistry,
    logger,
    () => runtime.values.llm.timeoutMs,
  );

  const applicationSettings = new ApplicationSettingsService(
    modelProfiles,
    modelProfileRepository,
    providerRegistry,
    usageTracker,
    applicationSettingRepository,
    runtime,
  );
  await applicationSettings.initialize();

  return {
    auth: new AuthService(userAccountRepository, sessionRepository, {
      sessionTtlMs: env.auth.sessionTtlMs,
    }),
    characters: new CharacterService(
      characterRepository,
      modelProfileRepository,
      new LLMCharacterPersonaGenerator(llmClient),
    ),
    modelProfiles,
    userProfile: new UserProfileService(userProfileRepository),
    posts: postService,
    simulations,
    simulationAnalysis,
    events,
    providerRegistry,
    applicationSettings,
  };
}
