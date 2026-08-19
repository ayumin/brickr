/**
 * Room analysis snapshot service (issue #166).
 *
 * Responsibilities:
 *   - Retrieve the current snapshot for a room (active members + owner).
 *   - Generate a new snapshot on demand (owner only).
 *   - Change detection: skip generation when postCount and latestPostId are
 *     unchanged since the last completed snapshot.
 *   - LLM summary: summarise the most recent N posts using the preferred
 *     provider; fall back to a plain text summary when no provider is available.
 *   - Archived rooms: refuse to update the snapshot.
 *   - Failure recovery: when the current snapshot has status "failed", include
 *     the most recent completed snapshot in the response so the caller can
 *     still display useful data.
 *
 * Permission model:
 *   - GET  (view):   active members of the room, or the owner/admin.
 *   - POST (update): owner or admin only.
 *   - Archived rooms: update is refused for everyone.
 */
import { z } from "zod";
import type { PostDto, RoomAnalysisSnapshotDto } from "@brickr/shared";
import { DomainError } from "../domain-error.js";
import type { LLMClient } from "../llm/llm-client.js";
import type { LLMProviderRegistry } from "../llm/provider-registry.js";
import type { PostService } from "../posts/post-service.js";
import type { RoomAnalysisSnapshotRepository } from "./room-analysis-snapshot-repository.js";
import type { RoomAnalysisSnapshot } from "./room-analysis-snapshot-repository.js";
import type { RoomMembershipRepository } from "./room-membership-repository.js";
import type { RoomRepository } from "./room-repository.js";
import type { SignedInActor } from "./room.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of recent posts to include in the LLM summary. */
const SNAPSHOT_POST_LIMIT = 50;

/** Maximum characters of post content to include per post in the transcript. */
const SNAPSHOT_CONTENT_LIMIT = 500;

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export class SnapshotRoomNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "room_not_found" as const;
  constructor(id: string) {
    super(`room "${id}" not found`);
  }
}

export class SnapshotForbiddenError extends DomainError {
  readonly httpStatus = 403;
  readonly errorCode = "forbidden" as const;
  constructor(id: string) {
    super(`not allowed to access snapshot for room "${id}"`);
  }
}

export class SnapshotRoomArchivedError extends DomainError {
  readonly httpStatus = 409;
  readonly errorCode = "room_archived" as const;
  constructor(id: string) {
    super(`room "${id}" is archived; snapshot cannot be updated`);
  }
}

export class SnapshotNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "snapshot_not_found" as const;
  constructor(id: string) {
    super(`no snapshot found for room "${id}"`);
  }
}

// ---------------------------------------------------------------------------
// LLM summary schema
// ---------------------------------------------------------------------------

const snapshotSummarySchema = z.object({
  overallTopics: z.string().trim().min(1),
  postOverview: z.string().trim().min(1),
  highEngagementTopics: z.string().trim().min(1),
  lowEngagementTopics: z.string().trim().min(1),
});

const snapshotSummaryJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    overallTopics: { type: "string" },
    postOverview: { type: "string" },
    highEngagementTopics: { type: "string" },
    lowEngagementTopics: { type: "string" },
  },
  required: ["overallTopics", "postOverview", "highEngagementTopics", "lowEngagementTopics"],
};

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

function toDto(snapshot: RoomAnalysisSnapshot): RoomAnalysisSnapshotDto {
  const dto: RoomAnalysisSnapshotDto = {
    id: snapshot.id,
    roomId: snapshot.roomId,
    postCount: snapshot.postCount,
    latestPostId: snapshot.latestPostId,
    summary: snapshot.summary,
    status: snapshot.status,
    error: snapshot.error,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };

  // Failed updates retain the previous completed analysis fields in the same
  // row. Re-expose those fields as a completed nested DTO while the outer DTO
  // carries the latest failure status and error.
  if (snapshot.status === "failed" && snapshot.summary !== null) {
    dto.lastSuccessful = {
      ...dto,
      status: "completed",
      error: null,
    };
  }

  return dto;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export type RoomAnalysisSnapshotServiceDeps = {
  snapshots: RoomAnalysisSnapshotRepository;
  rooms: RoomRepository;
  memberships: RoomMembershipRepository;
  posts: PostService;
  llm: LLMClient;
  providers: LLMProviderRegistry;
};

export class RoomAnalysisSnapshotService {
  constructor(private readonly deps: RoomAnalysisSnapshotServiceDeps) {}

  /**
   * Returns the current snapshot for a room.
   *
   * Access: active members of the room, or the owner/admin.
   *
   * When the current snapshot has status "failed", the response includes the
   * most recent completed snapshot in `lastSuccessful` so the caller can still
   * display useful data.
   */
  async get(
    roomId: string,
    actor: SignedInActor,
  ): Promise<{ snapshot: RoomAnalysisSnapshotDto }> {
    const room = await this.requireRoom(roomId);
    await this.assertCanView(room, actor, roomId);

    const snapshot = await this.deps.snapshots.findByRoom(roomId);
    if (!snapshot) throw new SnapshotNotFoundError(roomId);

    return { snapshot: toDto(snapshot) };
  }

  /**
   * Generates (or skips) a new snapshot for a room.
   *
   * Access: owner or admin only.
   * Archived rooms: refused.
   *
   * Change detection: if the room's postCount and latestPostId match the last
   * completed snapshot, no new snapshot is generated and `updated: false` is
   * returned.
   *
   * On LLM failure: the snapshot is saved with status "failed" and the error
   * message. The previous completed snapshot (if any) is included in the
   * response as `snapshot.lastSuccessful`.
   */
  async update(
    roomId: string,
    actor: SignedInActor,
  ): Promise<{ snapshot: RoomAnalysisSnapshotDto; updated: boolean }> {
    const room = await this.requireRoom(roomId);

    // Archived rooms cannot be updated.
    if (room.status === "archived") throw new SnapshotRoomArchivedError(roomId);

    // Only the owner or an admin may trigger an update.
    if (!actor.isAdmin && actor.id !== room.createdByUserId) {
      throw new SnapshotForbiddenError(roomId);
    }

    // Load all posts to compute postCount and latestPostId.
    const posts = await this.deps.posts.listByRoom(roomId);
    const postCount = posts.length;
    const latestPostId = posts.length > 0 ? posts[posts.length - 1]!.id : null;

    // Change detection: skip if nothing has changed since the last completed snapshot.
    const existing = await this.deps.snapshots.findByRoom(roomId);
    if (
      existing?.status === "completed" &&
      existing.postCount === postCount &&
      existing.latestPostId === latestPostId
    ) {
      return { snapshot: toDto(existing), updated: false };
    }

    // Generate the LLM summary.
    let summary: string | null = null;
    let error: string | null = null;
    let status: "completed" | "failed" = "completed";

    try {
      summary = await this.generateSummary(posts, postCount);
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : String(err);
    }

    const snapshot = await this.deps.snapshots.upsert({
      roomId,
      postCount,
      latestPostId,
      summary,
      status,
      error,
    });

    return { snapshot: toDto(snapshot), updated: true };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async requireRoom(roomId: string) {
    const room = await this.deps.rooms.findById(roomId);
    if (!room) throw new SnapshotRoomNotFoundError(roomId);
    return room;
  }

  /**
   * Asserts that the actor may view the snapshot.
   *
   * Active members of the room, the owner, and admins may view.
   * Non-members of closed/private rooms are refused.
   */
  private async assertCanView(
    room: { createdByUserId?: string; status: string; visibility: string },
    actor: SignedInActor,
    roomId: string,
  ): Promise<void> {
    // Admins and the room owner always have access.
    if (actor.isAdmin || actor.id === room.createdByUserId) return;

    // Public/open rooms: any authenticated user may view.
    if (room.visibility === "public" || room.visibility === "open") return;

    // Closed/private rooms: only active members may view.
    const membership = await this.deps.memberships.findOne(roomId, "user", actor.id);
    if (membership?.status === "active") return;

    throw new SnapshotForbiddenError(roomId);
  }

  /**
   * Generates an LLM summary for the room's recent posts.
   *
   * Falls back to a plain text summary when no LLM provider is available.
   * Throws when the LLM call fails so the caller can record the error.
   */
  private async generateSummary(
    posts: PostDto[],
    postCount: number,
  ): Promise<string> {
    if (postCount === 0) {
      return JSON.stringify({
        overallTopics: "まだ話題はありません。",
        postOverview: "このルームにはまだ投稿がありません。",
        highEngagementTopics: "反響を比較できる投稿がありません。",
        lowEngagementTopics: "反響を比較できる投稿がありません。",
      });
    }

    const provider = this.deps.providers.preferred();
    if (!provider) {
      // No LLM provider available — return a minimal summary.
      return JSON.stringify({
        overallTopics: "LLMプロバイダーが設定されていないため、要約を生成できません。",
        postOverview: `合計${String(postCount)}件の投稿があります。`,
        highEngagementTopics: "LLMプロバイダーが必要です。",
        lowEngagementTopics: "LLMプロバイダーが必要です。",
      });
    }

    const sliced = posts.slice(-SNAPSHOT_POST_LIMIT);

    const transcript = sliced
      .map((post) =>
        [
          `@${post.author.handle}`,
          post.content.slice(0, SNAPSHOT_CONTENT_LIMIT) || "[画像のみ]",
        ].join(" | "),
      )
      .join("\n");

    const result = await this.deps.llm.generate(provider.id, {
      model: provider.defaultModel,
      systemPrompt:
        "あなたはSNS上の会話を中立的に分析する編集者です。投稿内容だけを根拠に、ルーム全体を4つの観点で日本語分析してください。JSON以外は返さないでください。",
      messages: [{ role: "user", content: transcript }],
      maxOutputTokens: 500,
      temperature: 0.2,
      structuredOutput: {
        name: "room_snapshot_summary",
        schema: snapshotSummaryJsonSchema,
      },
    });

    // Validate the response shape.
    const text = result.text;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("summary JSON was not found in LLM response");
    snapshotSummarySchema.parse(JSON.parse(text.slice(start, end + 1)));

    return text.slice(start, end + 1);
  }
}

// Re-export for convenience.
export type { RoomAnalysisSnapshotDto };
