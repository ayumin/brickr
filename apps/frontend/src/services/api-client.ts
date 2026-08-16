/**
 * The only place in the frontend that talks to the network.
 *
 * Components must never call `fetch` directly, and this client only ever
 * talks to our own backend — no LLM SDKs, no API keys (CLAUDE.md §8, §55).
 */
import type {
  ApplicationSettingsResponse,
  UpdateApplicationSettingsRequest,
  AuthUserDto,
  AuthUserResponse,
  BulkDeleteCharactersResponse,
  CharacterDto,
  CharacterConfigDto,
  CharacterBulkCreationJobDto,
  CharacterBulkCreationJobResponse,
  CharacterConfigResponse,
  CharacterManagementDto,
  CharacterManagementResponse,
  CharacterDeletionMode,
  CharactersResponse,
  CreateInviteCodeRequest,
  CreateInviteCodeResponse,
  CreatePostRequest,
  CreatePostResponse,
  CreateRoomRequest,
  CreateRoomResponse,
  DeleteCharacterResponse,
  ExportCharactersCsvResponse,
  FeedFilter,
  FeedPageDto,
  ImportCharactersCsvResponse,
  InviteCodeDto,
  InviteCodesResponse,
  LoginRequest,
  ModelProfileDto,
  ModelProfilesResponse,
  PostDto,
  PostsPageResponse,
  PostsResponse,
  PublicProfileDto,
  PublicProfileResponse,
  ResetPasswordResponse,
  RestoreCharacterResponse,
  RoomListResponse,
  RoomMembershipDto,
  SaveCharacterRequest,
  SaveUserProfileRequest,
  SessionResponse,
  SignupRequest,
  RoomAnalysisDto,
  RoomAnalysisResponse,
  RoomDto,
  RoomResponse,
  UpdateRoomRequest,
  UserCharactersResponse,
  UserDetailResponse,
  UserManagementDto,
  UserManagementResponse,
  UserProfileDto,
  UserProfileResponse,
  UserTokenUsageResponse,
} from "@brickr/shared";

const DEFAULT_BASE_URL = "http://localhost:3000";

const configuredBaseUrl: string | undefined = import.meta.env.VITE_API_BASE_URL;

/** Backend origin, without a trailing slash. */
export const API_BASE_URL = (configuredBaseUrl ?? DEFAULT_BASE_URL).replace(
  /\/+$/,
  "",
);

/** Status used for "the request never reached the backend". */
export const NETWORK_ERROR_STATUS = 0;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isNetworkError(): boolean {
    return this.status === NETWORK_ERROR_STATUS;
  }
}

/** True when a rejection came from an aborted fetch rather than the backend. */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** True when the backend rejected the request for lacking (or losing) a session. */
export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** True when the backend rejected the request as not permitted for a signed-in caller. */
export function isForbiddenError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

/** Human readable message for anything we might catch in the UI. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "不明なエラーが発生しました。";
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractApiError(
  body: unknown,
  status: number,
): { code: string; message: string } {
  if (typeof body === "object" && body !== null && "error" in body) {
    const inner = (body as { error: unknown }).error;
    if (typeof inner === "object" && inner !== null) {
      const record = inner as Record<string, unknown>;
      const code = typeof record.code === "string" ? record.code : "api_error";
      const message =
        typeof record.message === "string" && record.message.length > 0
          ? record.message
          : `リクエストが失敗しました (${String(status)})`;
      return { code, message };
    }
  }
  return {
    code: "api_error",
    message: `リクエストが失敗しました (${String(status)})`,
  };
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
};

/**
 * Validates that a path is a relative API path starting with /api/ and matching allowed patterns.
 * This prevents SSRF attacks by ensuring paths cannot be absolute URLs or protocol-relative.
 *
 * @param path - The path to validate
 * @throws Error if path is not a valid relative API path
 */
function validateApiPath(path: string): void {
  if (!path.startsWith("/api/")) {
    throw new Error("Invalid API path: path must start with /api/");
  }
  if (path.includes("://")) {
    throw new Error("Invalid API path: path must not contain protocol specifiers");
  }
  if (path.includes("//")) {
    throw new Error("Invalid API path: path must not contain protocol-relative URLs");
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  validateApiPath(path);

  const { method = "GET", body, signal } = options;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      // The session cookie (CLAUDE.md §66.11) is otherwise never sent, since
      // frontend and backend are different origins in dev (:5173 vs :3000).
      credentials: "include",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    if (isAbortError(cause)) {
      throw cause;
    }
    throw new ApiError(
      NETWORK_ERROR_STATUS,
      "network_error",
      "バックエンドに接続できませんでした。サーバーが起動しているか確認してください。",
    );
  }

  if (!response.ok) {
    const body = await readJson(response);
    const { code, message } = extractApiError(body, response.status);
    throw new ApiError(response.status, code, message);
  }

  // Every 2xx response in this API is a JSON object.
  return (await response.json()) as T;
}

export type HealthResponse = { status: string };

export const api = {
  health(signal?: AbortSignal): Promise<HealthResponse> {
    return request<HealthResponse>("/api/health", signal ? { signal } : {});
  },

  /** Never rejects with 401: `user` is just `null` while signed out (CLAUDE.md §66.11). */
  async getSession(signal?: AbortSignal): Promise<AuthUserDto | null> {
    const data = await request<SessionResponse>(
      "/api/auth/session",
      signal ? { signal } : {},
    );
    return data.user;
  },

  async signup(body: SignupRequest): Promise<AuthUserDto> {
    const data = await request<AuthUserResponse>("/api/auth/signup", {
      method: "POST",
      body,
    });
    return data.user;
  },

  async login(body: LoginRequest): Promise<AuthUserDto> {
    const data = await request<AuthUserResponse>("/api/auth/login", {
      method: "POST",
      body,
    });
    return data.user;
  },

  async logout(): Promise<void> {
    await request<SessionResponse>("/api/auth/logout", { method: "POST" });
  },

  getApplicationSettings(signal?: AbortSignal): Promise<ApplicationSettingsResponse> {
    return request<ApplicationSettingsResponse>(
      "/api/application-settings",
      signal ? { signal } : {},
    );
  },

  updateApplicationSettings(
    body: UpdateApplicationSettingsRequest,
  ): Promise<ApplicationSettingsResponse> {
    return request<ApplicationSettingsResponse>("/api/application-settings", {
      method: "PUT",
      body,
    });
  },

  async getCharacters(signal?: AbortSignal): Promise<CharacterDto[]> {
    const data = await request<CharactersResponse>(
      "/api/characters",
      signal ? { signal } : {},
    );
    return data.characters;
  },

  async getCharacter(id: string, signal?: AbortSignal): Promise<CharacterDto> {
    const data = await request<{ character: CharacterDto }>(
      `/api/characters/${encodeURIComponent(id)}`,
      signal ? { signal } : {},
    );
    return data.character;
  },

  async getCharacterManagement(
    signal?: AbortSignal,
  ): Promise<CharacterManagementDto[]> {
    const data = await request<CharacterManagementResponse>(
      "/api/characters/management",
      signal ? { signal } : {},
    );
    return data.characters;
  },

  async getCharacterConfig(
    id: string,
    signal?: AbortSignal,
  ): Promise<CharacterConfigDto> {
    const data = await request<CharacterConfigResponse>(
      `/api/characters/${encodeURIComponent(id)}/config`,
      signal ? { signal } : {},
    );
    return data.character;
  },

  async createCharacter(body: SaveCharacterRequest): Promise<CharacterConfigDto> {
    const data = await request<CharacterConfigResponse>("/api/characters", {
      method: "POST",
      body,
    });
    return data.character;
  },

  async startCharacterBulkCreation(
    count: number,
  ): Promise<CharacterBulkCreationJobDto> {
    const data = await request<CharacterBulkCreationJobResponse>(
      "/api/characters/bulk-create",
      { method: "POST", body: { count } },
    );
    return data.job;
  },

  async getCharacterBulkCreationJob(
    id: string,
  ): Promise<CharacterBulkCreationJobDto> {
    const data = await request<CharacterBulkCreationJobResponse>(
      `/api/character-bulk-jobs/${encodeURIComponent(id)}`,
    );
    return data.job;
  },

  async updateCharacter(
    id: string,
    body: SaveCharacterRequest,
  ): Promise<CharacterConfigDto> {
    const data = await request<CharacterConfigResponse>(
      `/api/characters/${encodeURIComponent(id)}`,
      { method: "PUT", body },
    );
    return data.character;
  },

  async deleteCharacter(
    id: string,
    mode: CharacterDeletionMode = "soft",
  ): Promise<string> {
    const data = await request<DeleteCharacterResponse>(
      `/api/characters/${encodeURIComponent(id)}?mode=${encodeURIComponent(mode)}`,
      { method: "DELETE" },
    );
    return data.deletedId;
  },

  async restoreCharacter(id: string): Promise<string> {
    const data = await request<RestoreCharacterResponse>(
      `/api/characters/${encodeURIComponent(id)}/restore`,
      { method: "POST" },
    );
    return data.restoredId;
  },

  async deleteCharacters(
    ids: string[],
    mode: CharacterDeletionMode = "soft",
  ): Promise<string[]> {
    const data = await request<BulkDeleteCharactersResponse>(
      "/api/characters/bulk-delete",
      { method: "POST", body: { ids, mode } },
    );
    return data.deletedIds;
  },

  exportCharactersCsv(): Promise<ExportCharactersCsvResponse> {
    return request<ExportCharactersCsvResponse>("/api/characters/export");
  },

  importCharactersCsv(csv: string): Promise<ImportCharactersCsvResponse> {
    return request<ImportCharactersCsvResponse>("/api/characters/import", {
      method: "POST",
      body: { csv },
    });
  },

  /**
   * The public profile behind a handle — what a direct `/handle` visit or a
   * reload needs, with no simulation loaded (CLAUDE.md §66.2).
   *
   * One shape for people and cast members alike (§10.6). The endpoint this
   * replaced, `GET /api/handles/:handle`, answered with an owner type, which told
   * every caller whether a handle belonged to a person or to an AI (§25).
   */
  async resolveProfile(handle: string, signal?: AbortSignal): Promise<PublicProfileDto> {
    const data = await request<PublicProfileResponse>(
      `/api/profiles/${encodeURIComponent(handle)}`,
      signal ? { signal } : {},
    );
    return data.profile;
  },

  /** This account's posts across every room the caller may see, oldest page last (§10.6, §21). */
  getProfilePosts(
    handle: string,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<PostsPageResponse> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return request<PostsPageResponse>(
      `/api/profiles/${encodeURIComponent(handle)}/posts${query}`,
      signal ? { signal } : {},
    );
  },

  async getModelProfiles(signal?: AbortSignal): Promise<ModelProfileDto[]> {
    const data = await request<ModelProfilesResponse>(
      "/api/model-profiles",
      signal ? { signal } : {},
    );
    return data.modelProfiles;
  },

  async getUserProfile(signal?: AbortSignal): Promise<UserProfileDto> {
    const data = await request<UserProfileResponse>(
      "/api/user-profile",
      signal ? { signal } : {},
    );
    return data.profile;
  },

  async updateUserProfile(body: SaveUserProfileRequest): Promise<UserProfileDto> {
    const data = await request<UserProfileResponse>("/api/user-profile", {
      method: "PUT",
      body,
    });
    return data.profile;
  },

  async getMyTokenUsage(signal?: AbortSignal): Promise<UserTokenUsageResponse> {
    return request<UserTokenUsageResponse>(
      "/api/user-profile/token-usage",
      signal ? { signal } : {},
    );
  },

  async createSimulation(
    body: CreateRoomRequest = {},
    signal?: AbortSignal,
  ): Promise<RoomDto> {
    const data = await request<CreateRoomResponse>("/api/rooms", {
      method: "POST",
      body,
      ...(signal ? { signal } : {}),
    });
    return data.simulation;
  },

  /**
   * Visibility-aware room list (issue #155). Returns full entries for
   * public/open rooms and restricted entries for closed rooms where the
   * caller is not an active member.
   */
  async listRooms(signal?: AbortSignal): Promise<RoomListResponse> {
    return request<RoomListResponse>("/api/rooms", signal ? { signal } : {});
  },

  /**
   * Archives a room (owner/admin only). The room must be active.
   * Use `deleteRoom` to permanently remove an archived room.
   */
  async archiveRoom(id: string): Promise<RoomDto> {
    const data = await request<{ simulation: RoomDto }>(
      `/api/rooms/${encodeURIComponent(id)}/archive`,
      { method: "POST" },
    );
    return data.simulation;
  },

  /**
   * Hard-deletes an archived room (owner/admin only).
   * The room must already be archived — call `archiveRoom` first.
   */
  async deleteRoom(id: string): Promise<void> {
    await request<Record<string, never>>(
      `/api/rooms/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  },

  /**
   * Requests to join a room. For public rooms this auto-joins; for open rooms
   * it creates a pending membership awaiting owner approval.
   */
  async joinRoom(id: string): Promise<RoomMembershipDto> {
    const data = await request<{ membership: RoomMembershipDto }>(
      `/api/rooms/${encodeURIComponent(id)}/join`,
      { method: "POST" },
    );
    return data.membership;
  },

  /**
   * Invites a user (by handle) to a room (owner/admin only).
   */
  async inviteUserToRoom(id: string, handle: string): Promise<RoomMembershipDto> {
    const data = await request<{ membership: RoomMembershipDto }>(
      `/api/rooms/${encodeURIComponent(id)}/invite`,
      { method: "POST", body: { handle } },
    );
    return data.membership;
  },

  /**
   * Lists all memberships for a room (owner/admin only).
   */
  async getRoomMemberships(id: string, signal?: AbortSignal): Promise<RoomMembershipDto[]> {
    const data = await request<{ memberships: RoomMembershipDto[] }>(
      `/api/rooms/${encodeURIComponent(id)}/memberships`,
      signal ? { signal } : {},
    );
    return data.memberships;
  },

  /**
   * Approves a pending membership (owner/admin only).
   */
  async approveRoomMembership(roomId: string, memberId: string): Promise<RoomMembershipDto> {
    const data = await request<{ membership: RoomMembershipDto }>(
      `/api/rooms/${encodeURIComponent(roomId)}/memberships/${encodeURIComponent(memberId)}/approve`,
      { method: "POST" },
    );
    return data.membership;
  },

  /**
   * Rejects/removes a membership (owner/admin only).
   */
  async removeRoomMembership(roomId: string, memberId: string): Promise<void> {
    await request<Record<string, never>>(
      `/api/rooms/${encodeURIComponent(roomId)}/memberships/${encodeURIComponent(memberId)}`,
      { method: "DELETE" },
    );
  },

  /**
   * One page of the unified feed, unauthenticated-friendly (§10.1). Only
   * `filter: "mine"` needs a session - the backend 401s if one is missing.
   *
   * `cursor` is the previous page's `nextCursor`, handed straight back: only the
   * server encodes and decodes it (§9.4), so the ordering it describes can change
   * without breaking a client that stored one.
   */
  getFeed(
    filter: FeedFilter,
    cursor?: string | null,
    signal?: AbortSignal,
  ): Promise<FeedPageDto> {
    const query = new URLSearchParams({ filter });
    if (cursor) query.set("cursor", cursor);
    return request<FeedPageDto>(
      `/api/feed?${query.toString()}`,
      signal ? { signal } : {},
    );
  },

  /**
   * One page of a single room's feed (§10.2). Login required, and the reserved
   * global row is not addressable here - the unified feed is what serves it.
   */
  getRoomFeed(
    roomId: string,
    filter: FeedFilter,
    cursor?: string | null,
    signal?: AbortSignal,
  ): Promise<FeedPageDto> {
    const query = new URLSearchParams({ filter });
    if (cursor) query.set("cursor", cursor);
    return request<FeedPageDto>(
      `/api/rooms/${encodeURIComponent(roomId)}/feed?${query.toString()}`,
      signal ? { signal } : {},
    );
  },

  async updateSimulation(
    id: string,
    body: UpdateRoomRequest,
  ): Promise<RoomDto> {
    const data = await request<{ simulation: RoomDto }>(
      `/api/rooms/${encodeURIComponent(id)}`,
      { method: "PUT", body },
    );
    return data.simulation;
  },

  async getSimulationAnalysis(
    id: string,
    signal?: AbortSignal,
  ): Promise<RoomAnalysisDto> {
    const data = await request<RoomAnalysisResponse>(
      `/api/rooms/${encodeURIComponent(id)}/analysis`,
      signal ? { signal } : {},
    );
    return data.analysis;
  },

  getSimulation(
    id: string,
    signal?: AbortSignal,
  ): Promise<RoomResponse> {
    return request<RoomResponse>(
      `/api/rooms/${encodeURIComponent(id)}`,
      signal ? { signal } : {},
    );
  },

  async stopSimulation(
    id: string,
    signal?: AbortSignal,
  ): Promise<RoomDto> {
    const data = await request<{ simulation: RoomDto }>(
      `/api/rooms/${encodeURIComponent(id)}/stop`,
      { method: "POST", ...(signal ? { signal } : {}) },
    );
    return data.simulation;
  },

  async resumeSimulation(
    id: string,
    signal?: AbortSignal,
  ): Promise<RoomDto> {
    const data = await request<{ simulation: RoomDto }>(
      `/api/rooms/${encodeURIComponent(id)}/resume`,
      { method: "POST", ...(signal ? { signal } : {}) },
    );
    return data.simulation;
  },

  async getPosts(simulationId: string, signal?: AbortSignal): Promise<PostDto[]> {
    const data = await request<PostsResponse>(
      `/api/rooms/${encodeURIComponent(simulationId)}/posts`,
      signal ? { signal } : {},
    );
    return data.posts;
  },

  /**
   * Both halves reach the caller: `post` for a flat timeline, `thread` for the
   * feed's optimistic upsert (§13.4). SSE carries only a state-change
   * notification, so this REST response remains the authoritative DTO.
   */
  createPost(
    simulationId: string,
    body: CreatePostRequest,
    signal?: AbortSignal,
  ): Promise<CreatePostResponse> {
    return request<CreatePostResponse>(
      `/api/rooms/${encodeURIComponent(simulationId)}/posts`,
      { method: "POST", body, ...(signal ? { signal } : {}) },
    );
  },

  async getPost(id: string, signal?: AbortSignal): Promise<PostDto> {
    const data = await request<{ post: PostDto }>(
      `/api/posts/${encodeURIComponent(id)}`,
      signal ? { signal } : {},
    );
    return data.post;
  },

  /**
   * All replies the feed preview left out (§12.2). Login required.
   *
   * Returns every transitive reply under `threadRootId`, so the caller can
   * replace the 2-reply preview with the full thread without a separate
   * post-detail navigation.
   */
  async getThreadReplies(threadRootId: string, signal?: AbortSignal): Promise<PostDto[]> {
    const data = await request<{ posts: PostDto[] }>(
      `/api/posts/${encodeURIComponent(threadRootId)}/replies`,
      signal ? { signal } : {},
    );
    return data.posts;
  },

  async getUserManagement(
    query: { page?: number; search?: string } = {},
    signal?: AbortSignal,
  ): Promise<UserManagementResponse> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set("page", String(query.page));
    if (query.search) params.set("search", query.search);
    const queryString = params.toString();
    return request<UserManagementResponse>(
      `/api/users/management${queryString ? `?${queryString}` : ""}`,
      signal ? { signal } : {},
    );
  },

  async getUser(id: string, signal?: AbortSignal): Promise<UserManagementDto> {
    const data = await request<UserDetailResponse>(
      `/api/users/${encodeURIComponent(id)}`,
      signal ? { signal } : {},
    );
    return data.user;
  },

  async suspendUser(id: string): Promise<UserManagementDto> {
    const data = await request<UserDetailResponse>(
      `/api/users/${encodeURIComponent(id)}/suspend`,
      { method: "POST" },
    );
    return data.user;
  },

  async reactivateUser(id: string): Promise<UserManagementDto> {
    const data = await request<UserDetailResponse>(
      `/api/users/${encodeURIComponent(id)}/reactivate`,
      { method: "POST" },
    );
    return data.user;
  },

  async resetUserPassword(id: string): Promise<string> {
    const data = await request<ResetPasswordResponse>(
      `/api/users/${encodeURIComponent(id)}/reset-password`,
      { method: "POST" },
    );
    return data.temporaryPassword;
  },

  async getUserCharacters(
    id: string,
    signal?: AbortSignal,
  ): Promise<CharacterManagementDto[]> {
    const data = await request<UserCharactersResponse>(
      `/api/users/${encodeURIComponent(id)}/characters`,
      signal ? { signal } : {},
    );
    return data.characters;
  },

  async getUserTokenUsage(
    id: string,
    signal?: AbortSignal,
  ): Promise<UserTokenUsageResponse> {
    return request<UserTokenUsageResponse>(
      `/api/users/${encodeURIComponent(id)}/token-usage`,
      signal ? { signal } : {},
    );
  },

  async createInviteCode(body: CreateInviteCodeRequest = {}): Promise<InviteCodeDto> {
    const data = await request<CreateInviteCodeResponse>("/api/invite-codes", {
      method: "POST",
      body,
    });
    return data.inviteCode;
  },

  async getInviteCodes(signal?: AbortSignal): Promise<InviteCodeDto[]> {
    const data = await request<InviteCodesResponse>(
      "/api/invite-codes",
      signal ? { signal } : {},
    );
    return data.inviteCodes;
  },
};

/** URL of the SSE stream for one simulation. */
export function simulationEventsUrl(simulationId: string): string {
  return `${API_BASE_URL}/api/rooms/${encodeURIComponent(simulationId)}/events`;
}

/**
 * URL of the SSE stream behind the unified feed (§11.1).
 *
 * No id: this stream carries every simulation's public events, and it is the one
 * events endpoint a signed-out visitor may open.
 */
export function feedEventsUrl(): string {
  return `${API_BASE_URL}/api/feed/events`;
}
