import { describe, expect, it } from "vitest";
import { ApiError } from "../../services/api-client";
import { classifyHandleResolutionError } from "./handle-resolution";

describe("classifyHandleResolutionError", () => {
  it("treats a 404 ApiError as a genuine, permanent not-found", () => {
    const error = new ApiError(404, "not_found", "handle not found");
    expect(classifyHandleResolutionError(error)).toBe("not-found");
  });

  it("treats a non-404 ApiError as a transient, retryable error", () => {
    expect(classifyHandleResolutionError(new ApiError(500, "api_error", "boom"))).toBe("error");
    expect(classifyHandleResolutionError(new ApiError(0, "network_error", "offline"))).toBe(
      "error",
    );
  });

  it("treats a non-ApiError failure as a transient, retryable error", () => {
    expect(classifyHandleResolutionError(new Error("boom"))).toBe("error");
    expect(classifyHandleResolutionError("some rejection reason")).toBe("error");
    expect(classifyHandleResolutionError(undefined)).toBe("error");
  });
});
