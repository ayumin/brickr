/**
 * API contract shared between frontend and backend.
 *
 * This package holds DTOs only. It must never contain business logic,
 * prompts, provider code, database access or secrets.
 *
 * Shared DTO != Backend Domain Model
 */
export * from "./constants.js";
export * from "./character.js";
export * from "./post.js";
export * from "./simulation.js";
export * from "./events.js";
export * from "./errors.js";
