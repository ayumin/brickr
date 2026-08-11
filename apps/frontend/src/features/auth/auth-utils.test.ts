import { describe, expect, it } from "vitest";
import { validateSignupForm, type SignupFormValues } from "./auth-utils";

/** `birthdate` is computed relative to "today" so the test never goes stale. */
function birthdateYearsAgo(years: number): string {
  const now = new Date();
  const year = now.getUTCFullYear() - years;
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${String(year)}-${month}-${day}`;
}

const VALID: SignupFormValues = {
  inviteCode: "invite-1",
  email: "person@example.com",
  password: "a".repeat(12),
  handle: "valid_handle",
  displayName: "Valid Name",
  birthdate: birthdateYearsAgo(20),
};

describe("validateSignupForm", () => {
  it("accepts a fully valid form", () => {
    expect(validateSignupForm(VALID)).toBeNull();
  });

  it("rejects a missing invite code, checked before anything else", () => {
    expect(validateSignupForm({ ...VALID, inviteCode: "" })).not.toBeNull();
    expect(validateSignupForm({ ...VALID, inviteCode: "   " })).not.toBeNull();
  });

  it("rejects a missing email", () => {
    expect(validateSignupForm({ ...VALID, email: "" })).not.toBeNull();
  });

  it("rejects a password shorter than the minimum", () => {
    expect(validateSignupForm({ ...VALID, password: "short" })).not.toBeNull();
  });

  it("rejects a handle that is too short or has disallowed characters", () => {
    expect(validateSignupForm({ ...VALID, handle: "ab" })).not.toBeNull();
    expect(validateSignupForm({ ...VALID, handle: "no spaces" })).not.toBeNull();
    expect(validateSignupForm({ ...VALID, handle: "" })).not.toBeNull();
  });

  it("accepts a mixed-case handle, normalized the same way the backend does", () => {
    expect(validateSignupForm({ ...VALID, handle: "Valid_Handle" })).toBeNull();
  });

  it("rejects a missing display name", () => {
    expect(validateSignupForm({ ...VALID, displayName: "" })).not.toBeNull();
  });

  it("accepts exactly the minimum signup age and rejects one day under it", () => {
    expect(validateSignupForm({ ...VALID, birthdate: birthdateYearsAgo(18) })).toBeNull();
    expect(validateSignupForm({ ...VALID, birthdate: birthdateYearsAgo(17) })).not.toBeNull();
  });

  it("rejects a malformed birthdate", () => {
    expect(validateSignupForm({ ...VALID, birthdate: "not-a-date" })).not.toBeNull();
    expect(validateSignupForm({ ...VALID, birthdate: "" })).not.toBeNull();
  });
});
