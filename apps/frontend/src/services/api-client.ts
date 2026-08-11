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
  CreatePostRequest,
  CreatePostResponse,
  CreateSimulationRequest,
  CreateSimulationResponse,
  DeleteCharacterResponse,
  ExportCharactersCsvResponse,
  HandleOwnerDto,
  HandleResponse,
  ImportCharactersCsvResponse,
  LoginRequest,
  ModelProfileDto,
  ModelProfilesResponse,
  PostDto,
  PostsResponse,
  RestoreCharacterResponse,
  SaveCharacterRequest,
  SaveUserProfileRequest,
  SessionResponse,
  SignupRequest,
  SimulationAnalysisDto,
  SimulationAnalysisResponse,
  SimulationDto,
  SimulationResponse,
  SimulationsResponse,
  SimulationSummaryDto,
  UpdateSimulationRequest,
  UserProfileDto,
  UserProfileResponse,
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

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
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

  /** Resolves without any simulation loaded — what a direct `/handle` visit or reload needs (CLAUDE.md §66.2). */
  async resolveHandle(handle: string, signal?: AbortSignal): Promise<HandleOwnerDto> {
    const data = await request<HandleResponse>(
      `/api/handles/${encodeURIComponent(handle)}`,
      signal ? { signal } : {},
    );
    return data.owner;
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

  async createSimulation(
    body: CreateSimulationRequest = {},
    signal?: AbortSignal,
  ): Promise<SimulationDto> {
    const data = await request<CreateSimulationResponse>("/api/simulations", {
      method: "POST",
      body,
      ...(signal ? { signal } : {}),
    });
    return data.simulation;
  },

  async getSimulations(signal?: AbortSignal): Promise<SimulationSummaryDto[]> {
    const data = await request<SimulationsResponse>(
      "/api/simulations",
      signal ? { signal } : {},
    );
    return data.simulations;
  },

  async updateSimulation(
    id: string,
    body: UpdateSimulationRequest,
  ): Promise<SimulationDto> {
    const data = await request<{ simulation: SimulationDto }>(
      `/api/simulations/${encodeURIComponent(id)}`,
      { method: "PUT", body },
    );
    return data.simulation;
  },

  async getSimulationAnalysis(
    id: string,
    signal?: AbortSignal,
  ): Promise<SimulationAnalysisDto> {
    const data = await request<SimulationAnalysisResponse>(
      `/api/simulations/${encodeURIComponent(id)}/analysis`,
      signal ? { signal } : {},
    );
    return data.analysis;
  },

  getSimulation(
    id: string,
    signal?: AbortSignal,
  ): Promise<SimulationResponse> {
    return request<SimulationResponse>(
      `/api/simulations/${encodeURIComponent(id)}`,
      signal ? { signal } : {},
    );
  },

  async stopSimulation(
    id: string,
    signal?: AbortSignal,
  ): Promise<SimulationDto> {
    const data = await request<{ simulation: SimulationDto }>(
      `/api/simulations/${encodeURIComponent(id)}/stop`,
      { method: "POST", ...(signal ? { signal } : {}) },
    );
    return data.simulation;
  },

  async resumeSimulation(
    id: string,
    signal?: AbortSignal,
  ): Promise<SimulationDto> {
    const data = await request<{ simulation: SimulationDto }>(
      `/api/simulations/${encodeURIComponent(id)}/resume`,
      { method: "POST", ...(signal ? { signal } : {}) },
    );
    return data.simulation;
  },

  async getPosts(simulationId: string, signal?: AbortSignal): Promise<PostDto[]> {
    const data = await request<PostsResponse>(
      `/api/simulations/${encodeURIComponent(simulationId)}/posts`,
      signal ? { signal } : {},
    );
    return data.posts;
  },

  async createPost(
    simulationId: string,
    body: CreatePostRequest,
    signal?: AbortSignal,
  ): Promise<PostDto> {
    const data = await request<CreatePostResponse>(
      `/api/simulations/${encodeURIComponent(simulationId)}/posts`,
      { method: "POST", body, ...(signal ? { signal } : {}) },
    );
    return data.post;
  },

  async getPost(id: string, signal?: AbortSignal): Promise<PostDto> {
    const data = await request<{ post: PostDto }>(
      `/api/posts/${encodeURIComponent(id)}`,
      signal ? { signal } : {},
    );
    return data.post;
  },
};

/** URL of the SSE stream for one simulation. */
export function simulationEventsUrl(simulationId: string): string {
  return `${API_BASE_URL}/api/simulations/${encodeURIComponent(simulationId)}/events`;
}
