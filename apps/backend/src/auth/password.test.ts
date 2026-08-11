import { describe, expect, it } from "vitest";
import { generateTemporaryPassword, hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("verifies a password against its own hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery stapl", hash)).resolves.toBe(false);
  });

  it("salts every hash, so equal passwords do not collide", async () => {
    const [first, second] = await Promise.all([
      hashPassword("same-password"),
      hashPassword("same-password"),
    ]);
    expect(first).not.toEqual(second);
  });

  it("never stores the password in clear text", async () => {
    const hash = await hashPassword("super-secret-value");
    expect(hash).not.toContain("super-secret-value");
    expect(hash.startsWith("scrypt$")).toBe(true);
  });

  it.each([null, undefined, "", "not-a-hash", "scrypt$1$2$3", "bcrypt$1$8$1$c2FsdA==$aGFzaA=="])(
    "returns false instead of throwing for the malformed hash %p",
    async (stored) => {
      await expect(verifyPassword("anything", stored)).resolves.toBe(false);
    },
  );

  it("generates temporary passwords that differ and are long enough", () => {
    const first = generateTemporaryPassword();
    const second = generateTemporaryPassword();
    expect(first).not.toEqual(second);
    expect(first.length).toBeGreaterThanOrEqual(20);
  });
});
