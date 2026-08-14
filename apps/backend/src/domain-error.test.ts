import { describe, expect, it } from "vitest";
import { DomainError } from "./domain-error.js";

class TeapotError extends DomainError {
  readonly httpStatus = 418;
  readonly errorCode = "invalid_body" as const;
}

describe("DomainError", () => {
  it("sets name from the concrete subclass", () => {
    const error = new TeapotError("I'm a teapot");
    expect(error.name).toBe("TeapotError");
  });

  it("is an instance of Error", () => {
    expect(new TeapotError("nope")).toBeInstanceOf(Error);
  });

  it("preserves the cause", () => {
    const cause = new Error("root cause");
    const error = new TeapotError("wrapped", { cause });
    expect(error.cause).toBe(cause);
  });
});
