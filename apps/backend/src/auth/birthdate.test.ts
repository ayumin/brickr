import { describe, expect, it } from "vitest";
import { ageOn, isOldEnough, parseBirthdate } from "./birthdate.js";

describe("parseBirthdate", () => {
  it("parses an ISO calendar date as UTC midnight", () => {
    expect(parseBirthdate("1990-04-05")?.toISOString()).toBe("1990-04-05T00:00:00.000Z");
  });

  it.each(["", "1990-4-5", "05/04/1990", "1990-02-31", "1990-13-01", "yesterday"])(
    "rejects %p",
    (value) => {
      expect(parseBirthdate(value)).toBeNull();
    },
  );
});

describe("ageOn", () => {
  it("does not count the birthday until it has passed", () => {
    const birthdate = new Date(Date.UTC(2008, 4, 10));
    expect(ageOn(birthdate, new Date(Date.UTC(2026, 4, 9)))).toBe(17);
    expect(ageOn(birthdate, new Date(Date.UTC(2026, 4, 10)))).toBe(18);
  });

  it("handles a 29 February birthdate in a non-leap year", () => {
    const birthdate = new Date(Date.UTC(2004, 1, 29));
    expect(ageOn(birthdate, new Date(Date.UTC(2026, 1, 28)))).toBe(21);
    expect(ageOn(birthdate, new Date(Date.UTC(2026, 2, 1)))).toBe(22);
  });
});

describe("isOldEnough", () => {
  const today = new Date(Date.UTC(2026, 7, 10));

  it("accepts someone who turned 18 today", () => {
    expect(isOldEnough(new Date(Date.UTC(2008, 7, 10)), today)).toBe(true);
  });

  it("refuses someone who turns 18 tomorrow", () => {
    expect(isOldEnough(new Date(Date.UTC(2008, 7, 11)), today)).toBe(false);
  });

  it("refuses a birthdate in the future", () => {
    expect(isOldEnough(new Date(Date.UTC(2030, 0, 1)), today)).toBe(false);
  });
});
