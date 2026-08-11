import { describe, expect, it } from "vitest";
import { canManageSimulation, simulationCreatorLabel } from "./simulation-ownership";

const CURRENT_USER_ID = "user-1";

describe("canManageSimulation", () => {
  it("allows the creator", () => {
    expect(canManageSimulation({ createdByUserId: CURRENT_USER_ID }, CURRENT_USER_ID, false)).toBe(
      true,
    );
  });

  it("allows an admin regardless of creator", () => {
    expect(canManageSimulation({ createdByUserId: "someone-else" }, CURRENT_USER_ID, true)).toBe(
      true,
    );
  });

  it("disallows a non-admin who is not the creator", () => {
    expect(
      canManageSimulation({ createdByUserId: "someone-else" }, CURRENT_USER_ID, false),
    ).toBe(false);
  });

  it("disallows a non-admin when the simulation has no creator (pre-login)", () => {
    expect(canManageSimulation({ createdByUserId: undefined }, CURRENT_USER_ID, false)).toBe(
      false,
    );
  });

  it("allows an admin when the simulation has no creator (pre-login)", () => {
    expect(canManageSimulation({ createdByUserId: undefined }, CURRENT_USER_ID, true)).toBe(true);
  });
});

describe("simulationCreatorLabel", () => {
  it("labels the viewer's own simulation", () => {
    expect(simulationCreatorLabel({ createdByUserId: CURRENT_USER_ID }, CURRENT_USER_ID)).toBe(
      "あなた",
    );
  });

  it("labels another user's simulation generically, without naming them", () => {
    expect(simulationCreatorLabel({ createdByUserId: "someone-else" }, CURRENT_USER_ID)).toBe(
      "他のユーザー",
    );
  });

  it("labels a pre-login simulation with no creator as unknown", () => {
    expect(simulationCreatorLabel({ createdByUserId: undefined }, CURRENT_USER_ID)).toBe("—");
  });
});
