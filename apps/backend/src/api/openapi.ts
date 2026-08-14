import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import type { OpenAPIV3 } from "openapi-types";

type Schema = OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject;

const ref = (name: string): { $ref: string } => ({
  $ref: `#/components/schemas/${name}`,
});

const jsonBody = (
  schema: Schema,
  required = true,
): OpenAPIV3.RequestBodyObject => ({
  required,
  content: { "application/json": { schema } },
});

const jsonResponse = (
  description: string,
  schema: Schema,
): OpenAPIV3.ResponseObject => ({
  description,
  content: { "application/json": { schema } },
});

const pathParameter = (
  name: string,
  description: string,
): OpenAPIV3.ParameterObject => ({
  name,
  in: "path",
  required: true,
  description,
  schema: { type: "string", minLength: 1, maxLength: 64 },
});

const idParameter = (description: string): OpenAPIV3.ParameterObject =>
  pathParameter("id", description);

/**
 * Paging is server-owned (§9.4): the page size is fixed and the cursor is opaque,
 * so only `filter` and a previously issued cursor are accepted.
 */
const feedParameters: OpenAPIV3.ParameterObject[] = [
  {
    name: "filter",
    in: "query",
    required: false,
    description:
      "`all` (default) or `mine` — threads whose root is yours, that reply to a post of yours, or that mention your handle. `mine` requires a session.",
    schema: { type: "string", enum: ["all", "mine"], default: "all" },
  },
  {
    name: "cursor",
    in: "query",
    required: false,
    description: "Opaque cursor returned as `nextCursor` by the previous page.",
    schema: { type: "string", maxLength: 512 },
  },
];

const errorResponses = {
  "400": { $ref: "#/components/responses/BadRequest" },
  "404": { $ref: "#/components/responses/NotFound" },
  "409": { $ref: "#/components/responses/Conflict" },
  "500": { $ref: "#/components/responses/InternalError" },
};

/** OpenAPI marker for routes guarded by the httpOnly session cookie. */
const sessionSecurity: OpenAPIV3.SecurityRequirementObject[] = [{ cookieAuth: [] }];

export const openApiDocument: OpenAPIV3.Document = {
  openapi: "3.0.3",
  info: {
    title: "Brickr API",
    version: "0.1.0",
    description:
      "Brickr — Post something. Watch the AIs bicker. Backend REST and Server-Sent Events API.\n\n" +
      "Protected operations use the `brickr_session` httpOnly cookie issued by `/api/auth/login` or " +
      "`/api/auth/signup`. They answer 401 without a valid session. Account administration, invite " +
      "codes and application settings additionally require an administrator; character and simulation " +
      "lifecycle changes may require the creator or an administrator. Timeline/profile reads and the " +
      "event stream are public unless an operation explicitly declares `cookieAuth` below.",
  },
  servers: [{ url: "/", description: "Current Backend origin" }],
  tags: [
    { name: "System", description: "Backend status" },
    { name: "Auth", description: "Invite-only signup, login and session lifecycle" },
    { name: "Users", description: "Admin-only account management" },
    { name: "Characters", description: "AI character profiles and bulk management" },
    { name: "Models", description: "Available LLM provider/model profiles" },
    { name: "User", description: "Editable human user profile" },
    { name: "Simulations", description: "Simulation lifecycle" },
    { name: "Posts", description: "Timeline posts, replies and quotes" },
    { name: "Events", description: "Realtime simulation events" },
    { name: "Handles", description: "Handle namespace shared by users and characters" },
  ],
  paths: {
    "/api/health": {
      get: {
        operationId: "getHealth",
        tags: ["System"],
        summary: "Get backend health",
        responses: {
          "200": jsonResponse("Backend is available", {
            type: "object",
            required: ["status", "providers"],
            properties: {
              status: { type: "string", enum: ["ok"] },
              providers: { type: "array", items: { type: "string" } },
            },
          }),
        },
      },
    },
    "/api/auth/session": {
      get: {
        operationId: "getAuthSession",
        tags: ["Auth"],
        summary: "Get the signed-in user",
        description:
          "Resolves the session cookie. Returns `user: null` when signed out, so the frontend can bootstrap without treating a missing session as an error.",
        responses: {
          "200": jsonResponse("Current session", ref("SessionResponse")),
        },
      },
    },
    "/api/auth/signup": {
      post: {
        operationId: "signup",
        tags: ["Auth"],
        summary: "Create an account with an invite code",
        description:
          "Signup is invite-only. The invite code is consumed on success. Applicants under 18 are refused. On success a httpOnly session cookie is set.",
        requestBody: jsonBody(ref("SignupRequest")),
        responses: {
          "201": {
            ...jsonResponse("Account created and signed in", ref("AuthUserResponse")),
            headers: {
              "Set-Cookie": {
                description: "httpOnly, SameSite=Lax session cookie",
                schema: { type: "string" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "409": { $ref: "#/components/responses/Conflict" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/auth/login": {
      post: {
        operationId: "login",
        tags: ["Auth"],
        summary: "Sign in with email and password",
        description:
          "Unknown emails and wrong passwords return the same 401, so the response cannot be used to enumerate accounts.",
        requestBody: jsonBody(ref("LoginRequest")),
        responses: {
          "200": {
            ...jsonResponse("Signed in", ref("AuthUserResponse")),
            headers: {
              "Set-Cookie": {
                description: "httpOnly, SameSite=Lax session cookie",
                schema: { type: "string" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/auth/logout": {
      post: {
        operationId: "logout",
        tags: ["Auth"],
        summary: "Sign out",
        description:
          "Deletes the session row and clears the cookie. Idempotent: signing out without a session still succeeds.",
        responses: {
          "200": jsonResponse("Signed out", ref("SessionResponse")),
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/users/management": {
      get: {
        operationId: "listUserManagement",
        security: sessionSecurity,
        tags: ["Users"],
        summary: "List and search accounts for the admin management table",
        description:
          "Admin-only (CLAUDE.md 66.15). Paginated at a fixed page size of 100; `search` matches handle, display name or email.",
        parameters: [
          {
            name: "page",
            in: "query",
            required: false,
            description: "1-based page number, defaults to 1",
            schema: { type: "integer", minimum: 1 },
          },
          {
            name: "search",
            in: "query",
            required: false,
            schema: { type: "string", minLength: 1, maxLength: 254 },
          },
        ],
        responses: {
          "200": jsonResponse("Accounts page", ref("UserManagementResponse")),
          "400": errorResponses["400"],
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "500": errorResponses["500"],
        },
      },
    },
    "/api/users/{id}": {
      get: {
        operationId: "getUser",
        security: sessionSecurity,
        tags: ["Users"],
        summary: "Get one account for the admin management table",
        description: "Admin-only (CLAUDE.md 66.15).",
        parameters: [idParameter("User id")],
        responses: {
          "200": jsonResponse("Account", ref("UserDetailResponse")),
          "400": errorResponses["400"],
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": errorResponses["404"],
          "500": errorResponses["500"],
        },
      },
    },
    "/api/users/{id}/suspend": {
      post: {
        operationId: "suspendUser",
        security: sessionSecurity,
        tags: ["Users"],
        summary: "Suspend an account",
        description:
          "Admin-only (CLAUDE.md 66.12). Blocks future logins and immediately revokes every existing session for the account.",
        parameters: [idParameter("User id")],
        responses: {
          "200": jsonResponse("Account suspended", ref("UserDetailResponse")),
          "400": errorResponses["400"],
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": errorResponses["404"],
          "500": errorResponses["500"],
        },
      },
    },
    "/api/users/{id}/reactivate": {
      post: {
        operationId: "reactivateUser",
        security: sessionSecurity,
        tags: ["Users"],
        summary: "Reactivate a suspended account",
        description: "Admin-only (CLAUDE.md 66.12).",
        parameters: [idParameter("User id")],
        responses: {
          "200": jsonResponse("Account reactivated", ref("UserDetailResponse")),
          "400": errorResponses["400"],
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": errorResponses["404"],
          "500": errorResponses["500"],
        },
      },
    },
    "/api/users/{id}/reset-password": {
      post: {
        operationId: "resetUserPassword",
        security: sessionSecurity,
        tags: ["Users"],
        summary: "Issue a temporary password",
        description:
          "Admin-only (CLAUDE.md 66.10). There is no self-service reset; the admin relays this password to the user out of band. It is returned once and never logged. All existing sessions for the account are revoked immediately.",
        parameters: [idParameter("User id")],
        responses: {
          "200": jsonResponse("Temporary password issued", ref("ResetPasswordResponse")),
          "400": errorResponses["400"],
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": errorResponses["404"],
          "500": errorResponses["500"],
        },
      },
    },
    "/api/users/{id}/characters": {
      get: {
        operationId: "listUserCharacters",
        security: sessionSecurity,
        tags: ["Users"],
        summary: "List characters created by this account",
        description: "Admin-only (CLAUDE.md 66.5, 66.15). Includes the account's deleted characters too.",
        parameters: [idParameter("User id")],
        responses: {
          "200": jsonResponse("Characters created by this account", ref("UserCharactersResponse")),
          "400": errorResponses["400"],
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": errorResponses["404"],
          "500": errorResponses["500"],
        },
      },
    },
    "/api/users/{id}/token-usage": {
      get: {
        operationId: "getUserTokenUsage",
        security: sessionSecurity,
        tags: ["Users"],
        summary: "Get this account's LLM token usage",
        description:
          "Admin-only (CLAUDE.md 66.4, 66.15). Zeroed, not 404, for a user who has never triggered a generation.",
        parameters: [idParameter("User id")],
        responses: {
          "200": jsonResponse("Token usage totals", ref("UserTokenUsageResponse")),
          "400": errorResponses["400"],
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": errorResponses["404"],
          "500": errorResponses["500"],
        },
      },
    },
    "/api/invite-codes": {
      post: {
        operationId: "createInviteCode",
        security: sessionSecurity,
        tags: ["Auth"],
        summary: "Issue a single-use invite code",
        description:
          "Admin-only (CLAUDE.md 66.9). The code is returned once; the admin relays it out of band. Signup consumes it, so it works exactly once.",
        requestBody: jsonBody(ref("CreateInviteCodeRequest"), false),
        responses: {
          "201": jsonResponse("Invite code issued", ref("CreateInviteCodeResponse")),
          "400": errorResponses["400"],
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "500": errorResponses["500"],
        },
      },
      get: {
        operationId: "listInviteCodes",
        security: sessionSecurity,
        tags: ["Auth"],
        summary: "List issued invite codes and their usage status",
        description: "Admin-only (CLAUDE.md 66.9, 66.15).",
        responses: {
          "200": jsonResponse("Issued invite codes", ref("InviteCodesResponse")),
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "500": errorResponses["500"],
        },
      },
    },
    "/api/handles/{handle}": {
      get: {
        operationId: "resolveHandle",
        tags: ["Handles"],
        summary: "Resolve a handle to its owner",
        description:
          "Users and characters share one handle namespace. Resolves without a simulation loaded, so a direct visit to `/handle` or a reload can render the timeline. A leading `@` is accepted. Soft-deleted characters still resolve, because their past posts keep naming them as the author.",
        parameters: [
          {
            name: "handle",
            in: "path",
            required: true,
            description: "Handle without the `@`, lower-cased",
            schema: { type: "string", pattern: "^@?[A-Za-z0-9_]{3,32}$" },
          },
        ],
        responses: {
          "200": jsonResponse("Resolved handle owner", ref("HandleResponse")),
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/application-settings": {
      get: {
        operationId: "getApplicationSettings",
        security: sessionSecurity,
        tags: ["System", "Models"],
        summary: "Get safe application settings and in-process LLM usage",
        description:
          "Admin-only (CLAUDE.md 66.16). Returns an allowlisted view of environment configuration. API key values and database credentials are never included. Token usage resets when the backend process restarts.",
        responses: {
          "200": jsonResponse("Application settings", ref("ApplicationSettingsResponse")),
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "500": errorResponses["500"],
        },
      },
      put: {
        operationId: "updateApplicationSettings",
        security: sessionSecurity,
        tags: ["System", "Models"],
        summary: "Save or remove editable application setting overrides",
        description: "Admin-only (CLAUDE.md 66.16).",
        requestBody: jsonBody(ref("UpdateApplicationSettingsRequest")),
        responses: {
          "200": jsonResponse("Updated application settings", ref("ApplicationSettingsResponse")),
          "400": errorResponses["400"],
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "500": errorResponses["500"],
        },
      },
    },
    "/api/characters": {
      get: {
        operationId: "listCharacters",
        tags: ["Characters"],
        summary: "List public character profiles",
        responses: {
          "200": jsonResponse("Character profiles", {
            type: "object",
            required: ["characters"],
            properties: { characters: { type: "array", items: ref("Character") } },
          }),
          "500": errorResponses["500"],
        },
      },
      post: {
        operationId: "createCharacter",
        security: sessionSecurity,
        tags: ["Characters"],
        summary: "Create a character",
        description:
          "The signed-in caller becomes createdByUserId (CLAUDE.md 66.5), which is never accepted from the request body.",
        requestBody: jsonBody(ref("SaveCharacter")),
        responses: {
          "201": jsonResponse("Created character", {
            type: "object",
            required: ["character"],
            properties: { character: ref("CharacterConfig") },
          }),
          "401": { $ref: "#/components/responses/Unauthorized" },
          ...errorResponses,
          "502": { $ref: "#/components/responses/BadGateway" },
        },
      },
    },
    "/api/characters/management": {
      get: {
        operationId: "listCharactersForManagement",
        tags: ["Characters"],
        summary: "List active and logically deleted character management rows",
        responses: {
          "200": jsonResponse("Character management rows", {
            type: "object",
            required: ["characters"],
            properties: {
              characters: { type: "array", items: ref("CharacterManagement") },
            },
          }),
          "500": errorResponses["500"],
        },
      },
    },
    "/api/characters/export": {
      get: {
        operationId: "exportCharactersCsv",
        tags: ["Characters"],
        summary: "Export all characters as CSV including post counts and deletion status",
        responses: {
          "200": jsonResponse("CSV export", {
            type: "object",
            required: ["filename", "csv"],
            properties: {
              filename: { type: "string" },
              csv: { type: "string" },
            },
          }),
          "500": errorResponses["500"],
        },
      },
    },
    "/api/characters/import": {
      post: {
        operationId: "importCharactersCsv",
        security: sessionSecurity,
        tags: ["Characters"],
        summary: "Create or update characters from an exported CSV",
        description:
          "Requires a signed-in user. Matches existing characters by ID or handle and ignores the postCount column. The current import service is a trusted bulk-maintenance operation: it does not apply per-row owner checks and imported new rows are system-owned.",
        requestBody: jsonBody({
          type: "object",
          required: ["csv"],
          properties: { csv: { type: "string" } },
        }),
        responses: {
          "200": jsonResponse("Import summary", {
            type: "object",
            required: ["importedCount", "createdCount", "updatedCount"],
            properties: {
              importedCount: { type: "integer", minimum: 0 },
              createdCount: { type: "integer", minimum: 0 },
              updatedCount: { type: "integer", minimum: 0 },
            },
          }),
          "400": errorResponses["400"],
          "401": { $ref: "#/components/responses/Unauthorized" },
          "500": errorResponses["500"],
        },
      },
    },
    "/api/characters/{id}": {
      get: {
        operationId: "getCharacter",
        tags: ["Characters"],
        summary: "Get a public character profile",
        parameters: [idParameter("Character ID")],
        responses: {
          "200": jsonResponse("Character profile", {
            type: "object",
            required: ["character"],
            properties: { character: ref("Character") },
          }),
          ...errorResponses,
        },
      },
      put: {
        operationId: "updateCharacter",
        security: sessionSecurity,
        tags: ["Characters"],
        summary: "Update a character",
        description: "The creator or an admin only (CLAUDE.md 66.5).",
        parameters: [idParameter("Character ID")],
        requestBody: jsonBody(ref("SaveCharacter")),
        responses: {
          "200": jsonResponse("Updated character", {
            type: "object",
            required: ["character"],
            properties: { character: ref("CharacterConfig") },
          }),
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          ...errorResponses,
        },
      },
      delete: {
        operationId: "deleteCharacter",
        security: sessionSecurity,
        tags: ["Characters"],
        summary: "Delete a character",
        description: "The creator or an admin only (CLAUDE.md 66.5).",
        parameters: [
          idParameter("Character ID"),
          {
            name: "mode",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["soft", "hard"], default: "soft" },
          },
        ],
        responses: {
          "200": jsonResponse("Deleted character ID", {
            type: "object",
            required: ["deletedId"],
            properties: { deletedId: { type: "string" } },
          }),
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          ...errorResponses,
        },
      },
    },
    "/api/characters/{id}/config": {
      get: {
        operationId: "getCharacterConfig",
        tags: ["Characters"],
        summary: "Get editable character configuration",
        description:
          "Public read. createdByUserId rides along only for the creator or an admin (CLAUDE.md 66.5).",
        parameters: [idParameter("Character ID")],
        responses: {
          "200": jsonResponse("Character configuration", {
            type: "object",
            required: ["character"],
            properties: { character: ref("CharacterConfig") },
          }),
          ...errorResponses,
        },
      },
    },
    "/api/characters/{id}/restore": {
      post: {
        operationId: "restoreCharacter",
        security: sessionSecurity,
        tags: ["Characters"],
        summary: "Restore a logically deleted character",
        description: "The creator or an admin only (CLAUDE.md 66.5).",
        parameters: [idParameter("Character ID")],
        responses: {
          "200": jsonResponse("Restored character ID", {
            type: "object",
            required: ["restoredId"],
            properties: { restoredId: { type: "string" } },
          }),
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          ...errorResponses,
        },
      },
    },
    "/api/characters/bulk-create": {
      post: {
        operationId: "bulkCreateCharacters",
        security: sessionSecurity,
        tags: ["Characters"],
        summary: "Start bulk character generation",
        description:
          "The signed-in caller becomes createdByUserId for every generated character (CLAUDE.md 66.5).",
        requestBody: jsonBody({
          type: "object",
          required: ["count"],
          properties: { count: { type: "integer", minimum: 1, maximum: 100 } },
        }),
        responses: {
          "202": jsonResponse("Bulk creation job accepted", {
            type: "object",
            required: ["job"],
            properties: { job: ref("CharacterBulkCreationJob") },
          }),
          "400": errorResponses["400"],
          "401": { $ref: "#/components/responses/Unauthorized" },
          "500": errorResponses["500"],
        },
      },
    },
    "/api/character-bulk-jobs/{id}": {
      get: {
        operationId: "getCharacterBulkCreationJob",
        tags: ["Characters"],
        summary: "Get bulk character generation progress",
        parameters: [idParameter("Bulk creation job ID")],
        responses: {
          "200": jsonResponse("Bulk creation job", {
            type: "object",
            required: ["job"],
            properties: { job: ref("CharacterBulkCreationJob") },
          }),
          ...errorResponses,
        },
      },
    },
    "/api/characters/bulk-delete": {
      post: {
        operationId: "bulkDeleteCharacters",
        security: sessionSecurity,
        tags: ["Characters"],
        summary: "Delete multiple characters",
        description:
          "Silently drops any id the caller did not create and is not an admin for, rather than rejecting the whole batch (CLAUDE.md 66.5).",
        requestBody: jsonBody({
          type: "object",
          required: ["ids"],
          properties: {
            ids: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: { type: "string", minLength: 1, maxLength: 64 },
            },
            mode: { type: "string", enum: ["soft", "hard"], default: "soft" },
          },
        }),
        responses: {
          "200": jsonResponse("Deleted character IDs", {
            type: "object",
            required: ["deletedIds"],
            properties: {
              deletedIds: { type: "array", items: { type: "string" } },
            },
          }),
          "400": errorResponses["400"],
          "401": { $ref: "#/components/responses/Unauthorized" },
          "500": errorResponses["500"],
        },
      },
    },
    "/api/model-profiles": {
      get: {
        operationId: "listModelProfiles",
        tags: ["Models"],
        summary: "List available provider/model profiles",
        responses: {
          "200": jsonResponse("Model profiles", {
            type: "object",
            required: ["modelProfiles"],
            properties: {
              modelProfiles: { type: "array", items: ref("ModelProfile") },
            },
          }),
          "500": errorResponses["500"],
        },
      },
    },
    "/api/user-profile": {
      get: {
        operationId: "getUserProfile",
        security: sessionSecurity,
        tags: ["User"],
        summary: "Get the human user profile",
        responses: {
          "200": jsonResponse("User profile", {
            type: "object",
            required: ["profile"],
            properties: { profile: ref("UserProfile") },
          }),
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": errorResponses["500"],
        },
      },
      put: {
        operationId: "updateUserProfile",
        security: sessionSecurity,
        tags: ["User"],
        summary: "Update the human user profile",
        requestBody: jsonBody(ref("SaveUserProfile")),
        responses: {
          "200": jsonResponse("Updated user profile", {
            type: "object",
            required: ["profile"],
            properties: { profile: ref("UserProfile") },
          }),
          "400": errorResponses["400"],
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": errorResponses["404"],
          "500": errorResponses["500"],
        },
      },
    },
    "/api/user-profile/token-usage": {
      get: {
        operationId: "getOwnTokenUsage",
        security: sessionSecurity,
        tags: ["User"],
        summary: "Get the signed-in user's own LLM token usage",
        description:
          "Self-service counterpart to the admin-only GET /api/users/{id}/token-usage (CLAUDE.md 66.4). Always the caller's own totals; there is no id parameter to substitute another account.",
        responses: {
          "200": jsonResponse("Token usage totals", ref("UserTokenUsageResponse")),
          "401": { $ref: "#/components/responses/Unauthorized" },
          "500": errorResponses["500"],
        },
      },
    },
    "/api/simulations": {
      get: {
        operationId: "listSimulations",
        tags: ["Simulations"],
        summary: "List simulation history",
        responses: {
          "200": jsonResponse("Simulation history", {
            type: "object",
            required: ["simulations"],
            properties: {
              simulations: { type: "array", items: ref("SimulationSummary") },
            },
          }),
          "500": errorResponses["500"],
        },
      },
      post: {
        operationId: "createSimulation",
        security: sessionSecurity,
        tags: ["Simulations"],
        summary: "Create a simulation",
        requestBody: jsonBody(
          {
            type: "object",
            properties: { title: { type: "string", minLength: 1, maxLength: 120 } },
          },
          false,
        ),
        responses: {
          "201": jsonResponse("Created simulation", {
            type: "object",
            required: ["simulation"],
            properties: { simulation: ref("Simulation") },
          }),
          "400": errorResponses["400"],
          "401": { $ref: "#/components/responses/Unauthorized" },
          "500": errorResponses["500"],
        },
      },
    },
    "/api/simulations/{id}": {
      get: {
        operationId: "getSimulation",
        tags: ["Simulations"],
        summary: "Get a simulation and its posts",
        parameters: [idParameter("Simulation ID")],
        responses: {
          "200": jsonResponse("Simulation and posts", {
            type: "object",
            required: ["simulation", "posts"],
            properties: {
              simulation: ref("Simulation"),
              posts: { type: "array", items: ref("Post") },
            },
          }),
          ...errorResponses,
        },
      },
      put: {
        operationId: "updateSimulation",
        security: sessionSecurity,
        tags: ["Simulations"],
        summary: "Rename a simulation",
        description: "Creator or admin only (CLAUDE.md 66.6).",
        parameters: [idParameter("Simulation ID")],
        requestBody: jsonBody({
          type: "object",
          required: ["title"],
          properties: { title: { type: "string", minLength: 1, maxLength: 120 } },
        }),
        responses: {
          "200": jsonResponse("Renamed simulation", {
            type: "object",
            required: ["simulation"],
            properties: { simulation: ref("Simulation") },
          }),
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          ...errorResponses,
        },
      },
    },
    "/api/simulations/{id}/analysis": {
      get: {
        operationId: "analyzeSimulation",
        security: sessionSecurity,
        tags: ["Simulations"],
        summary: "Analyze posts in a simulation",
        description:
          "Unlike the simulation itself, the analysis is not public: only the creator or an admin may view it (CLAUDE.md 66.6).",
        parameters: [idParameter("Simulation ID")],
        responses: {
          "200": jsonResponse("Simulation analysis", {
            type: "object",
            required: ["analysis"],
            properties: { analysis: ref("SimulationAnalysis") },
          }),
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          ...errorResponses,
        },
      },
    },
    "/api/simulations/{id}/stop": {
      post: {
        operationId: "stopSimulation",
        security: sessionSecurity,
        tags: ["Simulations"],
        summary: "Stop response generation",
        description: "Creator or admin only (CLAUDE.md 66.6).",
        parameters: [idParameter("Simulation ID")],
        responses: {
          "200": jsonResponse("Stopped simulation", {
            type: "object",
            required: ["simulation"],
            properties: { simulation: ref("Simulation") },
          }),
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          ...errorResponses,
        },
      },
    },
    "/api/simulations/{id}/resume": {
      post: {
        operationId: "resumeSimulation",
        security: sessionSecurity,
        tags: ["Simulations"],
        summary: "Resume response generation",
        description: "Creator or admin only (CLAUDE.md 66.6).",
        parameters: [idParameter("Simulation ID")],
        responses: {
          "200": jsonResponse("Resumed simulation", {
            type: "object",
            required: ["simulation"],
            properties: { simulation: ref("Simulation") },
          }),
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          ...errorResponses,
        },
      },
    },
    "/api/feed": {
      get: {
        operationId: "getFeed",
        tags: ["Feed"],
        summary: "Read the unified feed",
        description:
          "Threads from every simulation, including the reserved global one, ordered by last activity. " +
          "Readable without a session: an anonymous reader gets the same posts and capabilities that " +
          "permit nothing. Posts from stopped rooms remain listed, but nobody may reply to or quote them. " +
          "`filter=mine` requires a session and answers 401 without one.",
        parameters: feedParameters,
        responses: {
          "200": jsonResponse("One page of threads", ref("FeedPage")),
          "401": { $ref: "#/components/responses/Unauthorized" },
          ...errorResponses,
        },
      },
    },
    "/api/simulations/{id}/feed": {
      get: {
        operationId: "getSimulationFeed",
        security: sessionSecurity,
        tags: ["Feed"],
        summary: "Read one simulation's feed",
        description:
          "Same ordering, paging and reply previews as the unified feed, restricted to one simulation. " +
          "The reserved global simulation is not available here — use `/api/feed`. A stopped simulation " +
          "answers 404 unless the caller created it or is an administrator, so the endpoint cannot be " +
          "used to discover it.",
        parameters: [idParameter("Simulation ID"), ...feedParameters],
        responses: {
          "200": jsonResponse("One page of threads", ref("FeedPage")),
          "401": { $ref: "#/components/responses/Unauthorized" },
          ...errorResponses,
        },
      },
    },
    "/api/simulations/{id}/posts": {
      get: {
        operationId: "listSimulationPosts",
        tags: ["Posts"],
        summary: "List posts in a simulation",
        parameters: [idParameter("Simulation ID")],
        responses: {
          "200": jsonResponse("Simulation posts", {
            type: "object",
            required: ["posts"],
            properties: { posts: { type: "array", items: ref("Post") } },
          }),
          ...errorResponses,
        },
      },
      post: {
        operationId: "createPost",
        security: sessionSecurity,
        tags: ["Posts"],
        summary: "Create a user post and start AI responses",
        description:
          "Images are accepted only on top-level posts. Replies and quotes cannot contain imageUrl.",
        parameters: [idParameter("Simulation ID")],
        requestBody: jsonBody(ref("CreatePost")),
        responses: {
          "201": jsonResponse("Created post", {
            type: "object",
            required: ["post"],
            properties: { post: ref("Post") },
          }),
          "401": { $ref: "#/components/responses/Unauthorized" },
          ...errorResponses,
        },
      },
    },
    "/api/posts/{id}": {
      get: {
        operationId: "getPostThread",
        tags: ["Posts"],
        summary: "Get a post by ID",
        parameters: [idParameter("Post ID")],
        responses: {
          "200": jsonResponse("Root post and related posts", {
            type: "object",
            required: ["post"],
            properties: { post: ref("Post") },
          }),
          ...errorResponses,
        },
      },
    },
    "/api/posts/{threadRootId}/replies": {
      get: {
        operationId: "listThreadReplies",
        security: sessionSecurity,
        tags: ["Feed"],
        summary: "List every reply in a thread",
        description:
          "All transitive replies of a thread root, oldest first — what the feed's two-reply preview " +
          "leaves out. Requires a session, and answers 404 for a reply id, an unknown thread, or a " +
          "stopped room the caller neither created nor administers.",
        parameters: [pathParameter("threadRootId", "Thread root post ID")],
        responses: {
          "200": jsonResponse("Replies in the thread", {
            type: "object",
            required: ["posts"],
            properties: { posts: { type: "array", items: ref("Post") } },
          }),
          "401": { $ref: "#/components/responses/Unauthorized" },
          ...errorResponses,
        },
      },
    },
    "/api/simulations/{id}/events": {
      get: {
        operationId: "streamSimulationEvents",
        tags: ["Events"],
        summary: "Stream simulation events",
        description:
          "Server-Sent Events stream. Event names: post.created, character.processing, character.skipped, character.failed, simulation.completed and simulation.failed.",
        parameters: [idParameter("Simulation ID")],
        responses: {
          "200": {
            description: "Named Server-Sent Events stream",
            content: { "text/event-stream": { schema: { type: "string" } } },
          },
          ...errorResponses,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "brickr_session",
        description:
          "Opaque httpOnly session cookie issued by signup/login. Browsers attach it automatically; clients must preserve cookies between requests.",
      },
    },
    responses: {
      BadRequest: jsonResponse("Invalid request parameters or body", ref("ApiError")),
      Unauthorized: jsonResponse("Authentication is required or has failed", ref("ApiError")),
      Forbidden: jsonResponse("Signed in but not allowed to perform this action", ref("ApiError")),
      NotFound: jsonResponse("Requested resource was not found", ref("ApiError")),
      Conflict: jsonResponse("Resource state conflict", ref("ApiError")),
      BadGateway: jsonResponse("Upstream LLM request failed", ref("ApiError")),
      InternalError: jsonResponse("Unexpected server error", ref("ApiError")),
    },
    schemas: {
      ApiError: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              details: {},
            },
          },
        },
      },
      AvatarUrl: {
        type: "string",
        description: "HTTP(S) URL or base64 PNG/JPEG/WebP data URL (maximum 1 MiB)",
      },
      PostImageUrl: {
        type: "string",
        description: "Base64 PNG/JPEG/GIF/WebP data URL (maximum 5 MiB)",
      },
      HandleResponse: {
        type: "object",
        required: ["owner"],
        properties: { owner: ref("HandleOwner") },
      },
      HandleOwner: {
        type: "object",
        description:
          "Owner of a handle. `user` is present when ownerType is user, `character` when it is character. The user arm is the public profile: email, admin flag and status are never included (CLAUDE.md 66.1).",
        required: ["ownerType"],
        properties: {
          ownerType: { type: "string", enum: ["user", "character"] },
          user: ref("UserProfile"),
          character: ref("Character"),
        },
      },
      Character: {
        type: "object",
        required: ["id", "handle", "displayName", "description"],
        properties: {
          id: { type: "string" },
          handle: { type: "string" },
          displayName: { type: "string" },
          description: { type: "string" },
          avatarUrl: ref("AvatarUrl"),
        },
      },
      CharacterConfig: {
        allOf: [
          ref("Character"),
          {
            type: "object",
            required: [
              "rolePrompt",
              "tonePrompt",
              "interests",
              "activityLevel",
              "responseProbability",
              "replyProbability",
              "quoteProbability",
              "influence",
              "modelProfileId",
            ],
            properties: {
              rolePrompt: { type: "string" },
              tonePrompt: { type: "string" },
              dialectPrompt: { type: "string" },
              interests: { type: "array", items: { type: "string" } },
              activityLevel: { type: "number", minimum: 0, maximum: 1 },
              responseProbability: { type: "number", minimum: 0, maximum: 1 },
              replyProbability: { type: "number", minimum: 0, maximum: 1 },
              quoteProbability: { type: "number", minimum: 0, maximum: 1 },
              influence: { type: "number", minimum: 0, maximum: 1 },
              modelProfileId: { type: "string" },
              createdByUserId: {
                type: "string",
                description:
                  "Present only for the creator or an admin (CLAUDE.md 66.5); omitted for everyone else and for System-owned (seed) characters.",
              },
            },
          },
        ],
      },
      CharacterManagement: {
        allOf: [
          ref("Character"),
          {
            type: "object",
            required: [
              "isDeleted",
              "postCount",
              "activityLevel",
              "responseProbability",
              "replyProbability",
              "quoteProbability",
              "influence",
              "modelProfileId",
            ],
            properties: {
              isDeleted: {
                type: "boolean",
                description: "Whether the character is logically deleted (stopped)",
              },
              postCount: { type: "integer", minimum: 0 },
              activityLevel: { type: "number", minimum: 0, maximum: 1 },
              responseProbability: { type: "number", minimum: 0, maximum: 1 },
              replyProbability: { type: "number", minimum: 0, maximum: 1 },
              quoteProbability: { type: "number", minimum: 0, maximum: 1 },
              influence: { type: "number", minimum: 0, maximum: 1 },
              modelProfileId: { type: "string" },
              createdByUserId: {
                type: "string",
                description:
                  "Present only for the creator or an admin (CLAUDE.md 66.5); omitted for everyone else and for System-owned (seed) characters.",
              },
            },
          },
        ],
      },
      SaveCharacter: {
        type: "object",
        required: [
          "handle",
          "displayName",
          "description",
          "rolePrompt",
          "tonePrompt",
          "interests",
          "activityLevel",
          "responseProbability",
          "replyProbability",
          "quoteProbability",
          "influence",
          "modelProfileId",
        ],
        properties: {
          handle: { type: "string", pattern: "^[a-z0-9_]{3,32}$" },
          displayName: { type: "string", minLength: 1, maxLength: 80 },
          description: { type: "string", minLength: 1, maxLength: 500 },
          rolePrompt: { type: "string", minLength: 1, maxLength: 4000 },
          tonePrompt: { type: "string", minLength: 1, maxLength: 4000 },
          dialectPrompt: { type: "string", maxLength: 2000 },
          interests: {
            type: "array",
            maxItems: 20,
            items: { type: "string", minLength: 1, maxLength: 80 },
          },
          activityLevel: { type: "number", minimum: 0, maximum: 1 },
          responseProbability: { type: "number", minimum: 0, maximum: 1 },
          replyProbability: { type: "number", minimum: 0, maximum: 1 },
          quoteProbability: { type: "number", minimum: 0, maximum: 1 },
          influence: { type: "number", minimum: 0, maximum: 1 },
          modelProfileId: { type: "string", minLength: 1, maxLength: 64 },
          avatarUrl: ref("AvatarUrl"),
        },
      },
      CharacterBulkCreationJob: {
        type: "object",
        required: ["id", "status", "completed", "total", "createdCount"],
        properties: {
          id: { type: "string" },
          status: {
            type: "string",
            enum: ["generating", "saving", "completed", "failed"],
          },
          completed: { type: "integer", minimum: 0 },
          total: { type: "integer", minimum: 1 },
          createdCount: { type: "integer", minimum: 0 },
          error: { type: "string" },
        },
      },
      ModelProfile: {
        type: "object",
        required: ["id", "providerId", "model"],
        properties: {
          id: { type: "string" },
          providerId: { type: "string", enum: ["openai", "anthropic", "gemini", "mock"] },
          model: { type: "string" },
        },
      },
      EnvironmentSetting: {
        type: "object",
        required: ["name", "description", "value", "secret", "editable", "source", "inputType"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          value: { type: "string" },
          secret: {
            type: "boolean",
            description: "True when value only reports configured/unconfigured state.",
          },
          editable: { type: "boolean" },
          source: { type: "string", enum: ["environment", "override"] },
          inputType: { type: "string", enum: ["text", "number", "toggle"] },
        },
      },
      LLMProviderSetting: {
        type: "object",
        required: ["providerId", "available", "defaultModel"],
        properties: {
          providerId: { type: "string", enum: ["openai", "anthropic", "gemini", "mock"] },
          available: { type: "boolean" },
          defaultModel: { type: "string" },
        },
      },
      LLMTokenUsage: {
        type: "object",
        required: [
          "providerId",
          "model",
          "requestCount",
          "inputTokens",
          "outputTokens",
          "totalTokens",
          "estimatedCostUsd",
        ],
        properties: {
          providerId: { type: "string", enum: ["openai", "anthropic", "gemini", "mock"] },
          model: { type: "string" },
          requestCount: { type: "integer", minimum: 0 },
          inputTokens: { type: "integer", minimum: 0 },
          outputTokens: { type: "integer", minimum: 0 },
          totalTokens: { type: "integer", minimum: 0 },
          estimatedCostUsd: {
            type: "number",
            minimum: 0,
            nullable: true,
            description: "Null when the model has no price entry.",
          },
        },
      },
      ApplicationSettingsResponse: {
        type: "object",
        required: ["environment", "llm"],
        properties: {
          environment: { type: "array", items: ref("EnvironmentSetting") },
          llm: {
            type: "object",
            required: ["providers", "models", "usage"],
            properties: {
              providers: { type: "array", items: ref("LLMProviderSetting") },
              models: { type: "array", items: ref("ModelProfile") },
              usage: {
                type: "object",
                required: ["trackedSince", "entries"],
                properties: {
                  trackedSince: { type: "string", format: "date-time" },
                  entries: { type: "array", items: ref("LLMTokenUsage") },
                },
              },
            },
          },
        },
      },
      UpdateApplicationSettingsRequest: {
        type: "object",
        required: ["overrides"],
        properties: {
          overrides: {
            type: "object",
            minProperties: 1,
            additionalProperties: false,
            description:
              "A string saves an override; null removes it and restores the environment value. Numeric settings are represented as decimal strings.",
            properties: {
              OPENAI_MODEL: { type: "string", nullable: true, maxLength: 200 },
              ANTHROPIC_MODEL: { type: "string", nullable: true, maxLength: 200 },
              GEMINI_MODEL: { type: "string", nullable: true, maxLength: 200 },
              LLM_TIMEOUT_MS: { type: "string", nullable: true, maxLength: 200 },
              LLM_MAX_RETRIES: { type: "string", nullable: true, maxLength: 200 },
              MIN_RESPONDERS: { type: "string", nullable: true, maxLength: 200 },
              MAX_RESPONDERS: { type: "string", nullable: true, maxLength: 200 },
              CONTEXT_POST_LIMIT: { type: "string", nullable: true, maxLength: 200 },
              MAX_CONCURRENT_CHARACTERS: { type: "string", nullable: true, maxLength: 200 },
              MAX_CASCADE_DEPTH: { type: "string", nullable: true, maxLength: 200 },
            },
          },
        },
      },
      AuthUser: {
        type: "object",
        description:
          "The signed-in user. Email and birthdate are private and never returned (CLAUDE.md 66.1).",
        required: ["id", "handle", "displayName", "description", "isAdmin", "status", "interests"],
        properties: {
          id: { type: "string" },
          handle: { type: "string" },
          displayName: { type: "string" },
          description: { type: "string" },
          avatarUrl: ref("AvatarUrl"),
          isAdmin: { type: "boolean" },
          status: { type: "string", enum: ["active", "suspended"] },
          country: { type: "string" },
          region: { type: "string" },
          interests: { type: "array", items: { type: "string" } },
          occupation: { type: "string" },
          xHandle: { type: "string" },
        },
      },
      AuthUserResponse: {
        type: "object",
        required: ["user"],
        properties: { user: ref("AuthUser") },
      },
      SessionResponse: {
        type: "object",
        required: ["user"],
        properties: { user: { allOf: [ref("AuthUser")], nullable: true } },
      },
      SignupRequest: {
        type: "object",
        required: ["inviteCode", "email", "password", "handle", "displayName", "birthdate"],
        properties: {
          inviteCode: { type: "string", minLength: 1, maxLength: 64 },
          email: { type: "string", format: "email", maxLength: 254 },
          password: { type: "string", minLength: 12, maxLength: 128 },
          handle: { type: "string", pattern: "^[a-z0-9_]{3,32}$" },
          displayName: { type: "string", minLength: 1, maxLength: 50 },
          birthdate: {
            type: "string",
            format: "date",
            description: "Self-declared. Signup is refused below 18. Never returned.",
          },
          description: { type: "string", maxLength: 280 },
          country: { type: "string", maxLength: 60 },
          region: { type: "string", maxLength: 60 },
          interests: { type: "array", items: { type: "string" }, maxItems: 20 },
          occupation: { type: "string", maxLength: 60 },
          xHandle: { type: "string", pattern: "^[A-Za-z0-9_]{1,15}$" },
        },
      },
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
        },
      },
      UserManagement: {
        type: "object",
        description:
          "Admin-only view of an account (CLAUDE.md 66.15). Unlike AuthUser, this includes the email.",
        required: ["id", "handle", "displayName", "email", "isAdmin", "status"],
        properties: {
          id: { type: "string" },
          handle: { type: "string" },
          displayName: { type: "string" },
          avatarUrl: ref("AvatarUrl"),
          email: { type: "string", format: "email" },
          isAdmin: { type: "boolean" },
          status: { type: "string", enum: ["active", "suspended"] },
        },
      },
      UserManagementResponse: {
        type: "object",
        required: ["users", "page", "pageSize", "totalCount"],
        properties: {
          users: { type: "array", items: ref("UserManagement") },
          page: { type: "integer", minimum: 1 },
          pageSize: { type: "integer", minimum: 1 },
          totalCount: { type: "integer", minimum: 0 },
        },
      },
      UserDetailResponse: {
        type: "object",
        required: ["user"],
        properties: { user: ref("UserManagement") },
      },
      ResetPasswordResponse: {
        type: "object",
        description:
          "The temporary password, returned once in clear text for the admin to relay out of band (66.10). Never logged or stored anywhere else.",
        required: ["temporaryPassword"],
        properties: {
          temporaryPassword: { type: "string" },
        },
      },
      UserCharactersResponse: {
        type: "object",
        description:
          "Characters created by the selected account, including logically deleted rows. Available to administrators only.",
        required: ["characters"],
        properties: {
          characters: { type: "array", items: ref("CharacterManagement") },
        },
      },
      UserTokenUsageResponse: {
        type: "object",
        description:
          "Persistent running totals for generations triggered by this user. Returns zeroes when no usage has been recorded.",
        required: ["totalInputTokens", "totalOutputTokens", "totalTokens"],
        properties: {
          totalInputTokens: { type: "integer", minimum: 0 },
          totalOutputTokens: { type: "integer", minimum: 0 },
          totalTokens: { type: "integer", minimum: 0 },
        },
      },
      InviteCode: {
        type: "object",
        description:
          "Admin-only view of an invite code (66.9, 66.15). `status` is derived from usedById/expiresAt, not stored separately.",
        required: ["code", "issuedById", "createdAt", "status"],
        properties: {
          code: { type: "string" },
          issuedById: { type: "string" },
          usedById: { type: "string" },
          usedAt: { type: "string", format: "date-time" },
          expiresAt: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
          status: { type: "string", enum: ["unused", "used", "expired"] },
        },
      },
      CreateInviteCodeRequest: {
        type: "object",
        properties: {
          expiresInDays: {
            type: "integer",
            minimum: 1,
            maximum: 365,
            description: "Omit for a code that never expires.",
          },
        },
      },
      CreateInviteCodeResponse: {
        type: "object",
        required: ["inviteCode"],
        properties: { inviteCode: ref("InviteCode") },
      },
      InviteCodesResponse: {
        type: "object",
        required: ["inviteCodes"],
        properties: {
          inviteCodes: { type: "array", items: ref("InviteCode") },
        },
      },
      UserProfile: {
        type: "object",
        required: ["id", "handle", "displayName", "description"],
        properties: {
          id: { type: "string" },
          handle: { type: "string" },
          displayName: { type: "string" },
          description: { type: "string" },
          avatarUrl: ref("AvatarUrl"),
        },
      },
      SaveUserProfile: {
        type: "object",
        required: ["displayName", "description"],
        properties: {
          displayName: { type: "string", minLength: 1, maxLength: 80 },
          description: { type: "string", maxLength: 500 },
          avatarUrl: ref("AvatarUrl"),
        },
      },
      Simulation: {
        type: "object",
        required: ["id", "title", "status", "createdAt"],
        properties: {
          id: { type: "string" },
          title: { type: "string", nullable: true },
          status: { type: "string", enum: ["active", "stopped"] },
          createdAt: { type: "string", format: "date-time" },
          createdByUserId: {
            type: "string",
            description:
              "Public to everyone, unlike Character ownership (CLAUDE.md 66.6). Omitted for simulations created before login existed.",
          },
        },
      },
      SimulationSummary: {
        allOf: [
          ref("Simulation"),
          {
            type: "object",
            required: ["postCount"],
            properties: { postCount: { type: "integer", minimum: 0 } },
          },
        ],
      },
      SimulationAnalysis: {
        type: "object",
        required: ["simulation", "summary", "postCount", "authorCount", "replyCount", "repostCount", "ranking", "authorRanking"],
        properties: {
          simulation: ref("Simulation"),
          summary: ref("SimulationContentSummary"),
          postCount: { type: "integer", minimum: 0 },
          authorCount: { type: "integer", minimum: 0 },
          replyCount: { type: "integer", minimum: 0 },
          repostCount: { type: "integer", minimum: 0 },
          ranking: { type: "array", items: ref("SimulationPostRanking") },
          authorRanking: { type: "array", items: ref("SimulationAuthorRanking") },
        },
      },
      SimulationContentSummary: {
        type: "object",
        required: ["overallTopics", "postOverview", "highEngagementTopics", "lowEngagementTopics"],
        properties: {
          overallTopics: { type: "string" },
          postOverview: { type: "string" },
          highEngagementTopics: { type: "string" },
          lowEngagementTopics: { type: "string" },
        },
      },
      SimulationPostRanking: {
        type: "object",
        required: ["postId", "content", "author", "replyCount", "repostCount", "score", "createdAt"],
        properties: {
          postId: { type: "string" },
          content: { type: "string" },
          author: ref("PostAuthor"),
          replyCount: { type: "integer", minimum: 0 },
          repostCount: { type: "integer", minimum: 0 },
          score: { type: "integer", minimum: 0 },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      SimulationAuthorRanking: {
        type: "object",
        required: ["author", "postCount", "replyCount", "repostCount", "receivedReactionCount"],
        properties: {
          author: ref("PostAuthor"),
          postCount: { type: "integer", minimum: 0 },
          replyCount: { type: "integer", minimum: 0 },
          repostCount: { type: "integer", minimum: 0 },
          receivedReactionCount: { type: "integer", minimum: 0 },
        },
      },
      /**
       * One shape for people and characters alike: no field says which, because
       * that is exactly what the feed must not reveal (Brickr-ux-refine §9.1).
       */
      PostAuthor: {
        type: "object",
        required: ["id", "handle", "displayName"],
        properties: {
          id: { type: "string" },
          handle: { type: "string" },
          displayName: { type: "string" },
          avatarUrl: ref("AvatarUrl"),
        },
      },
      QuotedPost: {
        type: "object",
        required: ["id", "author", "content", "createdAt"],
        properties: {
          id: { type: "string" },
          author: ref("PostAuthor"),
          content: { type: "string" },
          imageUrl: ref("PostImageUrl"),
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Post: {
        type: "object",
        required: [
          "id",
          "simulationId",
          "author",
          "content",
          "mentions",
          "replyTo",
          "quoteOf",
          "quotedPost",
          "createdAt",
        ],
        properties: {
          id: { type: "string" },
          simulationId: { type: "string" },
          author: ref("PostAuthor"),
          content: { type: "string" },
          imageUrl: ref("PostImageUrl"),
          mentions: { type: "array", items: { type: "string" } },
          replyTo: { type: "string", nullable: true },
          quoteOf: { type: "string", nullable: true },
          quotedPost: { allOf: [ref("QuotedPost")], nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      CreatePost: {
        type: "object",
        required: ["content"],
        properties: {
          content: { type: "string", maxLength: 500 },
          imageUrl: ref("PostImageUrl"),
          responderIds: {
            type: "array",
            maxItems: 20,
            deprecated: true,
            description: "Retained for API compatibility; mentions select responders in the UI.",
            items: { type: "string", minLength: 1, maxLength: 64 },
          },
          replyTo: { type: "string", minLength: 1, maxLength: 64 },
          quoteOf: { type: "string", minLength: 1, maxLength: 64 },
        },
        anyOf: [
          { required: ["content"], properties: { content: { minLength: 1 } } },
          { required: ["imageUrl"] },
        ],
      },
    },
  },
};

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    mode: "static",
    specification: { document: openApiDocument },
  });
  await app.register(swaggerUi, {
    routePrefix: "/documentation",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      displayRequestDuration: true,
    },
    staticCSP: true,
    theme: { title: "Brickr API Documentation" },
  });
}
