/**
 * API error contract tests (issue #171).
 *
 * Verifies that every domain error the room/membership/event subsystem can
 * raise maps to the correct HTTP status code and error code in the response
 * body. This is the "API contract" half of the quality gate: if a caller
 * depends on a specific status code or error code, a change to either the
 * domain error class or the route handler will break this test first.
 *
 * The test table mirrors the shape of errors.test.ts but focuses on the
 * room-specific errors introduced in issues #151, #154, #160, #169.
 *
 * Each case:
 *   1. Constructs the domain error.
 *   2. Calls handleDomainError with a fake reply.
 *   3. Asserts the HTTP status and error code.
 *   4. Asserts the error message is forwarded unchanged.
 */

import type { ApiErrorBody } from "@brickr/shared";
import type { FastifyReply } from "fastify";
import { describe, expect, it } from "vitest";
import { DomainError } from "../domain-error.js";
import {
  RoomNotFoundError,
  RoomForbiddenError,
  RoomArchivedError,
  RoomNotArchivedError,
  RoomJoinNotAllowedError,
  RoomAlreadyMemberError,
  RoomMemberBannedError,
  UserNotFoundError,
  VisibilityImmutableError,
} from "../rooms/room-service.js";
import {
  MembershipNotFoundError,
  MemberAlreadyExistsError,
  MemberBannedError,
  InvalidStatusTransitionError,
} from "../rooms/room-membership-service.js";
import { CannotModifyOwnerError } from "../rooms/room-membership-errors.js";
import {
  SnapshotForbiddenError,
  SnapshotNotFoundError,
  SnapshotRoomArchivedError,
} from "../rooms/room-analysis-snapshot-service.js";
import { ScheduledEventNotFoundError } from "../scheduled-events/scheduled-event-repository.js";
import { handleDomainError } from "./errors.js";

// ---------------------------------------------------------------------------
// Fake reply
// ---------------------------------------------------------------------------

function fakeReply(): {
  reply: FastifyReply;
  result: () => { status: number; body: unknown };
} {
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

// ---------------------------------------------------------------------------
// Error contract table
// ---------------------------------------------------------------------------

const CASES: Array<{ error: Error; status: number; code: string }> = [
  // Room lifecycle errors (issue #151)
  { error: new RoomNotFoundError("room-1"), status: 404, code: "room_not_found" },
  { error: new RoomForbiddenError("room-1"), status: 403, code: "forbidden" },
  { error: new RoomArchivedError("room-1"), status: 409, code: "room_archived" },
  { error: new RoomNotArchivedError("room-1"), status: 409, code: "room_not_archived" },
  { error: new VisibilityImmutableError(), status: 422, code: "visibility_immutable" },

  // Join/invite errors (issue #169)
  { error: new RoomJoinNotAllowedError("room-1"), status: 403, code: "room_join_not_allowed" },
  { error: new RoomAlreadyMemberError("room-1"), status: 409, code: "room_already_member" },
  { error: new RoomMemberBannedError("room-1"), status: 403, code: "room_member_banned" },
  { error: new UserNotFoundError("missing-user"), status: 404, code: "user_not_found" },

  // Membership management errors (issue #154)
  { error: new MembershipNotFoundError("mem-1"), status: 404, code: "membership_not_found" },
  { error: new MemberAlreadyExistsError(), status: 409, code: "member_already_exists" },
  { error: new MemberBannedError(), status: 409, code: "member_banned" },
  {
    error: new InvalidStatusTransitionError("active", "pending"),
    status: 409,
    code: "invalid_status_transition",
  },
  { error: new CannotModifyOwnerError(), status: 409, code: "cannot_modify_owner" },

  // Snapshot errors (issue #166)
  { error: new SnapshotForbiddenError("room-1"), status: 403, code: "forbidden" },
  { error: new SnapshotNotFoundError("room-1"), status: 404, code: "snapshot_not_found" },
  { error: new SnapshotRoomArchivedError("room-1"), status: 409, code: "room_archived" },
  { error: new RoomNotFoundError("room-1"), status: 404, code: "room_not_found" },

  // Scheduled event errors (issue #160)
  { error: new ScheduledEventNotFoundError("event-1"), status: 404, code: "not_found" },
];

describe("API error contract — room/membership/event domain errors", () => {
  it.each(CASES)("$error.name → HTTP $status / code=$code", ({ error, status, code }) => {
    const { reply, result } = fakeReply();
    handleDomainError(reply, error);
    const { status: actualStatus, body } = result();
    expect(actualStatus).toBe(status);
    expect((body as ApiErrorBody).error.code).toBe(code);
    expect((body as ApiErrorBody).error.message).toBe(error.message);
  });

  it("every error in the table is a DomainError instance", () => {
    for (const { error } of CASES) {
      expect(error, error.constructor.name).toBeInstanceOf(DomainError);
    }
  });

  it("handleDomainError re-throws non-DomainError errors unchanged", () => {
    const { reply } = fakeReply();
    const plain = new Error("unexpected failure");
    expect(() => handleDomainError(reply, plain)).toThrow("unexpected failure");
  });
});

// ---------------------------------------------------------------------------
// Error body shape contract
// ---------------------------------------------------------------------------

describe("API error body shape", () => {
  it("error body always has { error: { code, message } } shape", () => {
    const { reply, result } = fakeReply();
    handleDomainError(reply, new RoomNotFoundError("room-1"));
    const { body } = result();
    expect(body).toMatchObject({
      error: {
        code: expect.any(String),
        message: expect.any(String),
      },
    });
  });

  it("error message is the domain error's own message, not a generic string", () => {
    const { reply, result } = fakeReply();
    const error = new RoomNotFoundError("room-xyz");
    handleDomainError(reply, error);
    const { body } = result();
    expect((body as ApiErrorBody).error.message).toBe(error.message);
    expect((body as ApiErrorBody).error.message).toContain("room-xyz");
  });

  it("RoomForbiddenError produces 403 with code=forbidden (not room_forbidden)", () => {
    // The code is "forbidden" (generic) rather than "room_forbidden" so the
    // client does not need to distinguish room-level from other forbidden errors.
    const { reply, result } = fakeReply();
    handleDomainError(reply, new RoomForbiddenError("room-1"));
    const { status, body } = result();
    expect(status).toBe(403);
    expect((body as ApiErrorBody).error.code).toBe("forbidden");
  });

  it("RoomArchivedError and SnapshotRoomArchivedError both produce 409/room_archived", () => {
    // Two different error classes, same HTTP contract — the client sees the same
    // status and code regardless of which subsystem raised the error.
    const cases = [
      new RoomArchivedError("room-1"),
      new SnapshotRoomArchivedError("room-1"),
    ];
    for (const error of cases) {
      const { reply, result } = fakeReply();
      handleDomainError(reply, error);
      const { status, body } = result();
      expect(status, error.constructor.name).toBe(409);
      expect((body as ApiErrorBody).error.code, error.constructor.name).toBe("room_archived");
    }
  });

  it("not-found errors from different subsystems all produce HTTP 404", () => {
    const notFoundErrors = [
      new SnapshotNotFoundError("room-1"),
      new RoomNotFoundError("room-1"),
      new ScheduledEventNotFoundError("event-1"),
      new RoomNotFoundError("room-1"),
    ];
    for (const error of notFoundErrors) {
      const { reply, result } = fakeReply();
      handleDomainError(reply, error);
      const { status } = result();
      expect(status, error.constructor.name).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// HTTP status code semantics
// ---------------------------------------------------------------------------

describe("HTTP status code semantics", () => {
  it("403 errors are for authorization failures (not authentication)", () => {
    const forbiddenErrors = [
      new RoomForbiddenError("room-1"),
      new RoomJoinNotAllowedError("room-1"),
      new RoomMemberBannedError("room-1"),
      new SnapshotForbiddenError("room-1"),
    ];
    for (const error of forbiddenErrors) {
      expect(error.httpStatus, error.constructor.name).toBe(403);
    }
  });

  it("409 errors are for conflict states (not validation failures)", () => {
    const conflictErrors = [
      new RoomArchivedError("room-1"),
      new RoomNotArchivedError("room-1"),
      new RoomAlreadyMemberError("room-1"),
      new MemberAlreadyExistsError(),
      new MemberBannedError(),
      new InvalidStatusTransitionError("active", "pending"),
      new CannotModifyOwnerError(),
    ];
    for (const error of conflictErrors) {
      expect(error.httpStatus, error.constructor.name).toBe(409);
    }
  });

  it("422 is used only for semantic validation failures (not 400)", () => {
    // VisibilityImmutableError is 422 because the request is syntactically
    // valid but semantically wrong (you cannot change visibility after creation).
    const error = new VisibilityImmutableError();
    expect(error.httpStatus).toBe(422);
    expect(error.errorCode).toBe("visibility_immutable");
  });
});
