import { AgentService } from "./agents/agent-service.js";
import { AuthService } from "./auth/auth-service.js";
import { InviteCodeRepository } from "./auth/invite-code-repository.js";
import { InviteCodeService } from "./auth/invite-code-service.js";
import { SessionRepository } from "./auth/session-repository.js";
import { UserAccountRepository } from "./auth/user-account-repository.js";
import { UserAdminService } from "./auth/user-admin-service.js";
import { env } from "./config/env.js";
import { CharacterRepository } from "./characters/character-repository.js";
import { LLMCharacterPersonaGenerator } from "./characters/character-generator.js";
import { CharacterService } from "./characters/character-service.js";
import { FeedRepository } from "./feed/feed-repository.js";
import { FeedService } from "./feed/feed-service.js";
import { HandleRepository } from "./handles/handle-repository.js";
import { LLMClient } from "./llm/llm-client.js";
import { LLMUsageTracker } from "./llm/usage-tracker.js";
import type { LLMProviderRegistry } from "./llm/provider-registry.js";
import { createProviderRegistry } from "./llm/provider-registry.js";
import { TokenUsageRepository } from "./llm/token-usage-repository.js";
import { TokenUsageService } from "./llm/token-usage-service.js";
import { LLMBudgetRepository } from "./llm/llm-budget-repository.js";
import { LLMBudgetService } from "./llm/llm-budget-service.js";
import { ModelProfileRepository } from "./model-profiles/model-profile-repository.js";
import { ModelProfileService } from "./model-profiles/model-profile-service.js";
import type { Db } from "./persistence/prisma.js";
import { PostRepository } from "./posts/post-repository.js";
import { PostService } from "./posts/post-service.js";
import { ProfileRepository } from "./profiles/profile-repository.js";
import { ProfileService } from "./profiles/profile-service.js";
import { ThreadService } from "./posts/thread-service.js";
import { CastParticipationResolver } from "./rooms/cast-participation-resolver.js";
import { EventHub } from "./rooms/event-hub.js";
import { RoomMembershipRepository } from "./rooms/room-membership-repository.js";
import { RoomMembershipService } from "./rooms/room-membership-service.js";
import { RoomService } from "./rooms/room-service.js";
import { RoomAnalysisSnapshotRepository } from "./rooms/room-analysis-snapshot-repository.js";
import { RoomAnalysisSnapshotService } from "./rooms/room-analysis-snapshot-service.js";
import { RoomRepository } from "./rooms/room-repository.js";
import { RoomAnalysisService } from "./rooms/room-analysis-service.js";
import type { RoomRuntimeLogger } from "./rooms/room-runtime-service.js";
import { RoomRuntimeService } from "./rooms/room-runtime-service.js";
import { UserProfileRepository } from "./user-profile/user-profile-repository.js";
import { UserProfileService } from "./user-profile/user-profile-service.js";
import { ApplicationSettingsService } from "./settings/application-settings-service.js";
import { ApplicationSettingRepository } from "./settings/application-setting-repository.js";
import { RuntimeSettings } from "./settings/runtime-settings.js";

export type AppServices = {
  auth: AuthService;
  userAdmin: UserAdminService;
  inviteCodes: InviteCodeService;
  characters: CharacterService;
  profiles: ProfileService;
  modelProfiles: ModelProfileService;
  userProfile: UserProfileService;
  posts: PostService;
  feed: FeedService;
  roomRuntime: RoomRuntimeService;
  roomAnalysis: RoomAnalysisService;
  rooms: RoomService;
  roomMemberships: RoomMembershipService;
  roomAnalysisSnapshot: RoomAnalysisSnapshotService;
  events: EventHub;
  providerRegistry: LLMProviderRegistry;
  applicationSettings: ApplicationSettingsService;
  tokenUsage: TokenUsageService;
  llmBudget: LLMBudgetService;
};

/**
 * Single composition root. Nothing else constructs repositories or services, so
 * swapping a dependency (e.g. a fake LLM in tests) happens here.
 */
export async function buildServices(db: Db, logger: RoomRuntimeLogger): Promise<AppServices> {
  const characterRepository = new CharacterRepository(db);
  const modelProfileRepository = new ModelProfileRepository(db);
  const postRepository = new PostRepository(db);
  const roomMembershipRepository = new RoomMembershipRepository(db);
  const roomRepository = new RoomRepository(db);
  const roomAnalysisSnapshotRepository = new RoomAnalysisSnapshotRepository(db);
  const userProfileRepository = new UserProfileRepository(db);
  const applicationSettingRepository = new ApplicationSettingRepository(db);
  const userAccountRepository = new UserAccountRepository(db);
  const sessionRepository = new SessionRepository(db);
  const inviteCodeRepository = new InviteCodeRepository(db);
  const handleRepository = new HandleRepository(db);
  const tokenUsageRepository = new TokenUsageRepository(db);
  const llmBudgetRepository = new LLMBudgetRepository(db);
  const llmBudget = new LLMBudgetService(llmBudgetRepository);
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
    llmBudget,
  );

  const postService = new PostService(
    postRepository,
    characterRepository,
    userProfileRepository,
  );
  const threadService = new ThreadService(
    postRepository,
    () => runtime.values.room.contextPostLimit,
  );
  const agentService = new AgentService(llmClient, modelProfileRepository);
  const events = new EventHub();
  const tokenUsage = new TokenUsageService(tokenUsageRepository);

  // Built before the room runtime service, which publishes the thread payload the
  // feed assembles (§11.3). The dependency runs one way: the feed knows about
  // rooms, never the other way round.
  const feed = new FeedService(
    new FeedRepository(db),
    postService,
    roomRepository,
    roomMembershipRepository,
  );

  const castResolver = new CastParticipationResolver(
    characterRepository,
    roomMembershipRepository,
  );

  const roomRuntime = new RoomRuntimeService({
    rooms: roomRepository,
    memberships: roomMembershipRepository,
    posts: postService,
    characters: characterRepository,
    threads: threadService,
    agents: agentService,
    events,
    // The same object RuntimeSettings.recompute mutates in place, not a copy —
    // an admin changing a setting must take effect on this already-running
    // service without reconstructing it.
    options: runtime.values.room,
    logger,
    tokenUsage,
    threadActivity: feed,
    llmBudget,
    castResolver,
  });
  const roomAnalysis = new RoomAnalysisService(
    roomRepository,
    postService,
    llmClient,
    providerRegistry,
  );

  const rooms = new RoomService({
    rooms: roomRepository,
    memberships: roomMembershipRepository,
    handles: handleRepository,
    userProfiles: userProfileRepository,
  });

  const roomMemberships = new RoomMembershipService({
    rooms: roomRepository,
    memberships: roomMembershipRepository,
  });

  const roomAnalysisSnapshot = new RoomAnalysisSnapshotService({
    snapshots: roomAnalysisSnapshotRepository,
    rooms: roomRepository,
    memberships: roomMembershipRepository,
    posts: postService,
    llm: llmClient,
    providers: providerRegistry,
  });

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
    userAdmin: new UserAdminService(userAccountRepository, sessionRepository, rooms, logger),
    inviteCodes: new InviteCodeService(inviteCodeRepository),
    characters: new CharacterService(
      characterRepository,
      modelProfileRepository,
      new LLMCharacterPersonaGenerator(llmClient),
      // Only used to label who owns a character in the administrator's list
      // (§20.3); the ordinary list needs no account lookup at all.
      userProfileRepository,
    ),
    profiles: new ProfileService(
      handleRepository,
      characterRepository,
      userProfileRepository,
      new ProfileRepository(db),
      postService,
    ),
    modelProfiles,
    userProfile: new UserProfileService(userProfileRepository),
    posts: postService,
    feed,
    roomRuntime,
    roomAnalysis,
    rooms,
    roomMemberships,
    roomAnalysisSnapshot,
    events,
    providerRegistry,
    applicationSettings,
    tokenUsage,
    llmBudget,
  };
}
