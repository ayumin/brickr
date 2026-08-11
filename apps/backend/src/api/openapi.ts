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

const idParameter = (description: string): OpenAPIV3.ParameterObject => ({
  name: "id",
  in: "path",
  required: true,
  description,
  schema: { type: "string", minLength: 1, maxLength: 64 },
});

const errorResponses = {
  "400": { $ref: "#/components/responses/BadRequest" },
  "404": { $ref: "#/components/responses/NotFound" },
  "409": { $ref: "#/components/responses/Conflict" },
  "500": { $ref: "#/components/responses/InternalError" },
};

export const openApiDocument: OpenAPIV3.Document = {
  openapi: "3.0.3",
  info: {
    title: "Brickr API",
    version: "0.1.0",
    description:
      "Brickr — Post something. Watch the AIs bicker. Backend REST and Server-Sent Events API.\n\n" +
      "Write operations (creating, updating and deleting posts, simulations and characters, and " +
      "editing the user profile) require the session cookie issued by `/api/auth/login` or " +
      "`/api/auth/signup`, and answer 401 without it. Reads and the event stream are public.",
  },
  servers: [{ url: "/", description: "Current Backend origin" }],
  tags: [
    { name: "System", description: "Backend status" },
    { name: "Auth", description: "Invite-only signup, login and session lifecycle" },
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
            schema: { type: "string", pattern: "^@?[A-Za-z0-9_]{1,32}$" },
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
        tags: ["System", "Models"],
        summary: "Get safe application settings and in-process LLM usage",
        description:
          "Returns an allowlisted view of environment configuration. API key values and database credentials are never included. Token usage resets when the backend process restarts.",
        responses: {
          "200": jsonResponse("Application settings", {
            type: "object",
            required: ["environment", "llm"],
            properties: {
              environment: {
                type: "array",
                items: {
                  type: "object",
                  required: ["name", "description", "value", "secret", "editable", "source", "inputType"],
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    value: { type: "string" },
                    secret: { type: "boolean" },
                    editable: { type: "boolean" },
                    source: { type: "string", enum: ["environment", "override"] },
                    inputType: { type: "string", enum: ["text", "number", "toggle"] },
                  },
                },
              },
              llm: {
                type: "object",
                required: ["providers", "models", "usage"],
                properties: {
                  providers: { type: "array", items: { type: "object" } },
                  models: { type: "array", items: ref("ModelProfile") },
                  usage: {
                    type: "object",
                    required: ["trackedSince", "entries"],
                    properties: {
                      trackedSince: { type: "string", format: "date-time" },
                      entries: { type: "array", items: { type: "object" } },
                    },
                  },
                },
              },
            },
          }),
          "500": errorResponses["500"],
        },
      },
      put: {
        operationId: "updateApplicationSettings",
        tags: ["System", "Models"],
        summary: "Save or remove editable application setting overrides",
        requestBody: jsonBody({
          type: "object",
          required: ["overrides"],
          properties: {
            overrides: {
              type: "object",
              additionalProperties: {
                type: "string",
                nullable: true,
              },
            },
          },
        }),
        responses: {
          "200": jsonResponse("Updated application settings", { type: "object" }),
          "400": errorResponses["400"],
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
        tags: ["Characters"],
        summary: "Create a character",
        requestBody: jsonBody(ref("SaveCharacter")),
        responses: {
          "201": jsonResponse("Created character", {
            type: "object",
            required: ["character"],
            properties: { character: ref("CharacterConfig") },
          }),
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
        tags: ["Characters"],
        summary: "Create or update characters from an exported CSV",
        description: "Matches existing characters by ID or handle. The postCount column is ignored.",
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
        tags: ["Characters"],
        summary: "Update a character",
        parameters: [idParameter("Character ID")],
        requestBody: jsonBody(ref("SaveCharacter")),
        responses: {
          "200": jsonResponse("Updated character", {
            type: "object",
            required: ["character"],
            properties: { character: ref("CharacterConfig") },
          }),
          ...errorResponses,
        },
      },
      delete: {
        operationId: "deleteCharacter",
        tags: ["Characters"],
        summary: "Delete a character",
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
          ...errorResponses,
        },
      },
    },
    "/api/characters/{id}/config": {
      get: {
        operationId: "getCharacterConfig",
        tags: ["Characters"],
        summary: "Get editable character configuration",
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
        tags: ["Characters"],
        summary: "Restore a logically deleted character",
        parameters: [idParameter("Character ID")],
        responses: {
          "200": jsonResponse("Restored character ID", {
            type: "object",
            required: ["restoredId"],
            properties: { restoredId: { type: "string" } },
          }),
          ...errorResponses,
        },
      },
    },
    "/api/characters/bulk-create": {
      post: {
        operationId: "bulkCreateCharacters",
        tags: ["Characters"],
        summary: "Start bulk character generation",
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
        tags: ["Characters"],
        summary: "Delete multiple characters",
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
        tags: ["User"],
        summary: "Get the human user profile",
        responses: {
          "200": jsonResponse("User profile", {
            type: "object",
            required: ["profile"],
            properties: { profile: ref("UserProfile") },
          }),
          "500": errorResponses["500"],
        },
      },
      put: {
        operationId: "updateUserProfile",
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
        tags: ["Simulations"],
        summary: "Rename a simulation",
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
          ...errorResponses,
        },
      },
    },
    "/api/simulations/{id}/analysis": {
      get: {
        operationId: "analyzeSimulation",
        tags: ["Simulations"],
        summary: "Analyze posts in a simulation",
        parameters: [idParameter("Simulation ID")],
        responses: {
          "200": jsonResponse("Simulation analysis", {
            type: "object",
            required: ["analysis"],
            properties: { analysis: ref("SimulationAnalysis") },
          }),
          ...errorResponses,
        },
      },
    },
    "/api/simulations/{id}/stop": {
      post: {
        operationId: "stopSimulation",
        tags: ["Simulations"],
        summary: "Stop response generation",
        parameters: [idParameter("Simulation ID")],
        responses: {
          "200": jsonResponse("Stopped simulation", {
            type: "object",
            required: ["simulation"],
            properties: { simulation: ref("Simulation") },
          }),
          ...errorResponses,
        },
      },
    },
    "/api/simulations/{id}/resume": {
      post: {
        operationId: "resumeSimulation",
        tags: ["Simulations"],
        summary: "Resume response generation",
        parameters: [idParameter("Simulation ID")],
        responses: {
          "200": jsonResponse("Resumed simulation", {
            type: "object",
            required: ["simulation"],
            properties: { simulation: ref("Simulation") },
          }),
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
          handle: { type: "string", pattern: "^[a-z0-9_]{1,32}$" },
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
          handle: { type: "string", pattern: "^[a-z0-9_]{1,32}$" },
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
      PostAuthor: {
        type: "object",
        required: ["id", "kind", "handle", "displayName"],
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["user", "character"] },
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
          "authorId",
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
          authorId: { type: "string" },
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
