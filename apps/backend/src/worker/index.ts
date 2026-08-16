/**
 * Worker process entry point.
 *
 * Runs as a separate process alongside the API server. Polls the
 * `scheduled_events` table, claims events atomically, executes them, and
 * applies exponential backoff retry on failure.
 *
 * Multiple replicas can run concurrently: the atomic claim (FOR UPDATE SKIP
 * LOCKED) ensures each event is processed by exactly one worker.
 *
 * Lifecycle:
 *   1. Start the health HTTP server.
 *   2. Enter the poll loop.
 *   3. On SIGTERM / SIGINT: stop accepting new events, finish the current one,
 *      then exit cleanly.
 *
 * Usage (development):
 *   pnpm --filter @brickr/backend worker
 *
 * Usage (Docker):
 *   CMD ["pnpm", "worker"]
 */

import { hostname } from "node:os";
import { AgentService } from "../agents/agent-service.js";
import { CharacterRepository } from "../characters/character-repository.js";
import { LLMClient } from "../llm/llm-client.js";
import { LLMUsageTracker } from "../llm/usage-tracker.js";
import { createProviderRegistry } from "../llm/provider-registry.js";
import { ModelProfileRepository } from "../model-profiles/model-profile-repository.js";
import { prisma } from "../persistence/prisma.js";
import { PostRepository } from "../posts/post-repository.js";
import { PostService } from "../posts/post-service.js";
import { ThreadService } from "../posts/thread-service.js";
import { ScheduledEventRepository } from "../scheduled-events/scheduled-event-repository.js";
import type { ScheduledEvent } from "../scheduled-events/scheduled-event.js";
import { SimulationRepository } from "../simulation/simulation-repository.js";
import { UserProfileRepository } from "../user-profile/user-profile-repository.js";
import { RuntimeSettings } from "../settings/runtime-settings.js";
import { workerConfig, RETRY_DELAYS_MS } from "./config.js";
import { processEvent } from "./event-processor.js";
import { startHealthServer } from "./health-server.js";
import { createLogger } from "./logger.js";
import type { WorkerHealthState } from "./health-server.js";
import { waitForCurrentWork } from "./graceful-shutdown.js";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const logger = createLogger(workerConfig.logLevel);

/**
 * Unique identifier for this worker replica.
 * Combines hostname and PID so replicas on the same host are distinguishable.
 */
const workerId = `worker-${hostname()}-${process.pid}`;

logger.info({ workerId }, "worker starting");

// ---------------------------------------------------------------------------
// Dependency wiring (mirrors services.ts but without the API/SSE layer)
// ---------------------------------------------------------------------------

const characterRepository = new CharacterRepository(prisma);
const modelProfileRepository = new ModelProfileRepository(prisma);
const userProfileRepository = new UserProfileRepository(prisma);
const postRepo = new PostRepository(prisma);
const simulationRepository = new SimulationRepository(prisma);
const scheduledEventRepository = new ScheduledEventRepository(prisma);

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

const agentService = new AgentService(llmClient, modelProfileRepository);

const postService = new PostService(postRepo, characterRepository, userProfileRepository);

const threadService = new ThreadService(
  postRepo,
  () => runtime.values.simulation.contextPostLimit,
);

const processorDeps = {
  simulations: simulationRepository,
  characters: characterRepository,
  posts: postService,
  threads: threadService,
  agents: agentService,
  logger,
};

// ---------------------------------------------------------------------------
// Health state (mutated in place by the poll loop)
// ---------------------------------------------------------------------------

const healthState: WorkerHealthState = {
  workerId,
  lastPollAt: null,
  lastSuccessAt: null,
};

const healthServer = startHealthServer(
  workerConfig.healthHost,
  workerConfig.healthPort,
  healthState,
  scheduledEventRepository,
  logger,
);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

let shuttingDown = false;
let currentWork: Promise<void> | null = null;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  logger.info({ signal, workerId }, "worker shutting down");
  shuttingDown = true;
  healthServer.close();
  const finished = await waitForCurrentWork(currentWork, 10_000);
  if (!finished) {
    logger.warn({ workerId }, "shutdown grace period elapsed with work still in flight");
  }
  await prisma.$disconnect();
  logger.info({ workerId }, "worker stopped");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitteredPollInterval(): number {
  return workerConfig.pollIntervalMs + Math.random() * workerConfig.pollJitterMs;
}

/**
 * Returns the delay (ms) before the next retry attempt.
 * `attempts` is the total number of attempts so far (already incremented by
 * the repository's claim query).
 */
function retryDelayMs(attempts: number): number {
  const index = Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 300_000;
}

async function runPollLoop(): Promise<void> {
  logger.info({ workerId }, "poll loop started");

  while (!shuttingDown) {
    const iteration = runPollIteration();
    currentWork = iteration;
    await iteration;
    if (currentWork === iteration) currentWork = null;
  }
}

async function runPollIteration(): Promise<void> {
  healthState.lastPollAt = new Date().toISOString();

  let event: ScheduledEvent | null;
  try {
    event = await scheduledEventRepository.claimEvent(workerId);
  } catch (err) {
    logger.error(
      { workerId, err: err instanceof Error ? err.message : String(err) },
      "failed to claim event — will retry after poll interval",
    );
    await sleep(jitteredPollInterval());
    return;
  }

  if (!event) {
    // No eligible event; back off and poll again.
    await sleep(jitteredPollInterval());
    return;
  }

  logger.info(
    { workerId, eventId: event.id, type: event.type, attempts: event.attempts },
    "claimed event",
  );

  try {
    await processEvent(event, processorDeps);
    await scheduledEventRepository.markCompleted(event.id);
    healthState.lastSuccessAt = new Date().toISOString();
    logger.info({ workerId, eventId: event.id }, "event completed");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.warn(
      { workerId, eventId: event.id, attempts: event.attempts, err: errorMessage },
      "event processing failed",
    );

    try {
      await scheduledEventRepository.markFailed(event.id, errorMessage);

      if (event.attempts < workerConfig.maxAttempts) {
        const delay = retryDelayMs(event.attempts);
        const retryAt = new Date(Date.now() + delay);
        await scheduledEventRepository.resetForRetry(event.id, retryAt);
        logger.info(
          { workerId, eventId: event.id, retryAt: retryAt.toISOString(), delay },
          "event scheduled for retry",
        );
      } else {
        logger.warn(
          { workerId, eventId: event.id, attempts: event.attempts },
          "event exceeded max attempts — permanently failed",
        );
      }
    } catch (repoErr) {
      logger.error(
        {
          workerId,
          eventId: event.id,
          err: repoErr instanceof Error ? repoErr.message : String(repoErr),
        },
        "failed to update event status after processing failure",
      );
    }
  }

  // The caller immediately polls again. Jitter only applies when the queue is empty.
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

runPollLoop().catch((err: unknown) => {
  logger.error(
    { workerId, err: err instanceof Error ? err.message : String(err) },
    "poll loop crashed — exiting",
  );
  process.exit(1);
});
