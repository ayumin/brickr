import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DomainError } from "../domain-error.js";
import { parseOr400, withDomainErrors, withRoom } from "./route-helpers.js";

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

class TeapotError extends DomainError {
  readonly httpStatus = 418;
  readonly errorCode = "invalid_body" as const;
}

const idSchema = z.object({ id: z.string().min(1) });

describe("parseOr400", () => {
  it("returns the parsed data on success", () => {
    const { reply } = fakeReply();
    expect(parseOr400(idSchema, { id: "abc" }, reply, "invalid_body", "bad")).toEqual({
      id: "abc",
    });
  });

  it("answers 400 and returns null on failure", () => {
    const { reply, result } = fakeReply();
    const parsed = parseOr400(idSchema, {}, reply, "invalid_body", "id is required");
    expect(parsed).toBeNull();
    const { status, body } = result();
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: { code: "invalid_body", message: "id is required" } });
  });

  it("omits details for invalid_params", () => {
    const { reply, result } = fakeReply();
    parseOr400(idSchema, {}, reply, "invalid_params", "bad id");
    const { body } = result();
    expect(body).toMatchObject({ error: { code: "invalid_params" } });
    expect((body as { error: { details?: unknown } }).error.details).toBeUndefined();
  });

  it("includes Zod issues as details for invalid_body and invalid_query", () => {
    const { reply, result } = fakeReply();
    parseOr400(idSchema, {}, reply, "invalid_body", "bad body");
    const { body } = result();
    expect((body as { error: { details?: unknown } }).error.details).toBeDefined();
  });
});

describe("withDomainErrors", () => {
  it("passes a successful value through", async () => {
    const { reply } = fakeReply();
    await expect(withDomainErrors(reply, () => Promise.resolve("ok"))).resolves.toBe("ok");
  });

  it("maps a DomainError to its HTTP answer", async () => {
    const { reply, result } = fakeReply();
    await withDomainErrors(reply, () => Promise.reject(new TeapotError("no")));
    const { status, body } = result();
    expect(status).toBe(418);
    expect(body).toMatchObject({ error: { code: "invalid_body", message: "no" } });
  });

  it("rethrows a non-DomainError", async () => {
    const { reply } = fakeReply();
    await expect(withDomainErrors(reply, () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
  });
});

describe("withRoom", () => {
  function fakeRequest(params: unknown): FastifyRequest {
    return { params } as unknown as FastifyRequest;
  }

  it("answers 400 for an invalid room id", async () => {
    const { reply, result } = fakeReply();
    const request = fakeRequest({});
    await withRoom(request, reply, () => Promise.resolve("unused"));
    const { status, body } = result();
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: { code: "invalid_params" } });
  });

  it("passes the parsed id to the handler and returns its result", async () => {
    const { reply } = fakeReply();
    const request = fakeRequest({ id: "sim-1" });
    await expect(withRoom(request, reply, (id) => Promise.resolve(`got:${id}`))).resolves.toBe(
      "got:sim-1",
    );
  });

  it("maps a DomainError thrown by the handler", async () => {
    const { reply, result } = fakeReply();
    const request = fakeRequest({ id: "sim-1" });
    await withRoom(request, reply, () => Promise.reject(new TeapotError("nope")));
    const { status } = result();
    expect(status).toBe(418);
  });
});
