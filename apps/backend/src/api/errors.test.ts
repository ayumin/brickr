import type { ApiErrorBody } from "@brickr/shared";
import type { FastifyReply } from "fastify";
import { describe, expect, it } from "vitest";
import { CharacterModelProfileMissingError } from "../agents/agent-service.js";
import { InvalidApplicationSettingError } from "../settings/runtime-settings.js";
import {
  AccountSuspendedError,
  EmailTakenError,
  HandleTakenError,
  InvalidBirthdateError,
  InvalidCredentialsError,
  InviteCodeInvalidError,
  UnderageSignupError,
  UserNotFoundError,
} from "../auth/auth-errors.js";
import { CharacterCsvError } from "../characters/character-csv.js";
import { CharacterGenerationError, CharacterPersonaParseError } from "../characters/character-generator.js";
import {
  CharacterForbiddenError,
  CharacterHandleConflictError,
  CharacterNotFoundError,
  ModelProfileNotFoundError,
} from "../characters/character-service.js";
import { DomainError } from "../domain-error.js";
import { FeedCursorInvalidError } from "../feed/feed-cursor.js";
import { ThreadRootNotFoundError } from "../feed/feed-service.js";
import { LLMError, LLMTimeoutError } from "../llm/provider.js";
import { ReplyTargetNotFoundError } from "../posts/post-repository.js";
import {
  PostNotFoundError,
  RoomManageForbiddenError,
  RoomStoppedError,
} from "../rooms/room-runtime-service.js";
import { RoomNotFoundError } from "../rooms/room-errors.js";
import { handleDomainError } from "./errors.js";

function fakeReply(): { reply: FastifyReply; result: () => { status: number; body: unknown } } {
  let status = 0;
  let body: unknown;
  const reply = {
    status(code: number) {
      status = code;
      return reply;
    },
    send(payload: unknown) {
      body = payload;
      return reply;
    },
  } as unknown as FastifyReply;
  return { reply, result: () => ({ status, body }) };
}

const CASES: Array<{ error: Error; status: number; code: string }> = [
  { error: new InvalidCredentialsError(), status: 401, code: "invalid_credentials" },
  { error: new AccountSuspendedError(), status: 403, code: "account_suspended" },
  { error: new UnderageSignupError(), status: 400, code: "underage" },
  { error: new InvalidBirthdateError(), status: 400, code: "invalid_birthdate" },
  { error: new InviteCodeInvalidError(), status: 400, code: "invalid_invite_code" },
  { error: new HandleTakenError("architect"), status: 409, code: "handle_conflict" },
  { error: new EmailTakenError(), status: 409, code: "email_conflict" },
  { error: new UserNotFoundError(), status: 404, code: "not_found" },
  { error: new CharacterNotFoundError("char-1"), status: 404, code: "not_found" },
  { error: new CharacterForbiddenError("char-1"), status: 403, code: "forbidden" },
  { error: new CharacterHandleConflictError("architect"), status: 409, code: "handle_conflict" },
  { error: new ModelProfileNotFoundError("profile-1"), status: 404, code: "not_found" },
  { error: new CharacterGenerationError(), status: 502, code: "character_generation_failed" },
  { error: new CharacterCsvError("bad row"), status: 400, code: "invalid_csv" },
  { error: new RoomNotFoundError("sim-1"), status: 404, code: "room_not_found" },
  { error: new RoomStoppedError("sim-1"), status: 409, code: "room_archived" },
  { error: new RoomManageForbiddenError("sim-1"), status: 403, code: "forbidden" },
  { error: new PostNotFoundError("post-1"), status: 404, code: "not_found" },
  { error: new ThreadRootNotFoundError("post-1"), status: 404, code: "not_found" },
  { error: new ReplyTargetNotFoundError("post-1"), status: 404, code: "not_found" },
  { error: new FeedCursorInvalidError(), status: 400, code: "invalid_cursor" },
  { error: new InvalidApplicationSettingError("bad value"), status: 400, code: "invalid_setting" },
];

describe("handleDomainError", () => {
  it.each(CASES)("maps $error.name to $status/$code", ({ error, status, code }) => {
    const { reply, result } = fakeReply();
    handleDomainError(reply, error);
    const { status: actualStatus, body } = result();
    expect(actualStatus).toBe(status);
    expect((body as ApiErrorBody).error.code).toBe(code);
    expect((body as ApiErrorBody).error.message).toBe(error.message);
  });

  it("rethrows an error that is not a DomainError", () => {
    const { reply } = fakeReply();
    expect(() => handleDomainError(reply, new Error("boom"))).toThrow("boom");
  });
});

describe("DomainError coverage", () => {
  it("every case handleDomainError maps is an actual DomainError instance", () => {
    for (const { error } of CASES) {
      expect(error).toBeInstanceOf(DomainError);
    }
  });

  /**
   * Every error class in the backend whose name ends in "Error" is either a
   * `DomainError` (covered by the table above) or explicitly allow-listed
   * here as an internal failure that must keep answering 500. A class that is
   * neither has been forgotten by one list or the other — decide which one it
   * belongs to rather than adding a third case.
   */
  const ALLOWED_INTERNAL_ERRORS: Array<{ error: Error; reason: string }> = [
    {
      error: new LLMError("provider failed", "openai", false),
      reason: "a provider failure, not something the caller did",
    },
    {
      error: new LLMTimeoutError("openai", 1000),
      reason: "an LLMError subclass — same reason",
    },
    {
      error: new CharacterModelProfileMissingError("profile-1", "char-1"),
      reason: "a seed/config bug discovered mid-generation, not a bad request",
    },
    {
      error: new CharacterPersonaParseError("could not parse"),
      reason: "the LLM's response was unparseable — an internal failure, not a bad request",
    },
  ];

  it.each(ALLOWED_INTERNAL_ERRORS)(
    "$error.name stays a plain Error ($reason)",
    ({ error }) => {
      expect(error).not.toBeInstanceOf(DomainError);
      expect(error).toBeInstanceOf(Error);
    },
  );
});
