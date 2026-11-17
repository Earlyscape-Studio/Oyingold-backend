import { describe, it, expect } from "vitest";
import {
  NIGERIA_LOCATIONS,
  NIGERIAN_STATES,
  getLgas,
  isLgaOfState,
  isNigerianState,
} from "@/data/nigeria-locations.js";

describe("nigeria locations", () => {
  it("covers the 36 states and the FCT, with 774 local governments", () => {
    expect(NIGERIAN_STATES).toHaveLength(37);
    expect(NIGERIAN_STATES).toContain("FCT");
    expect(NIGERIAN_STATES).toContain("Nasarawa");
    expect(NIGERIAN_STATES.reduce((sum, s) => sum + getLgas(s).length, 0)).toBe(774);
  });

  it("has no blank, padded or duplicated local government within a state", () => {
    for (const state of NIGERIAN_STATES) {
      const lgas = NIGERIA_LOCATIONS[state];
      expect(new Set(lgas).size).toBe(lgas.length);
      for (const lga of lgas) {
        expect(lga).toBe(lga.trim());
        expect(lga.length).toBeGreaterThan(1);
        expect(lga).not.toMatch(/[|()]/);
      }
    }
  });

  it("recognises states and the local governments inside them", () => {
    expect(isNigerianState("Lagos")).toBe(true);
    expect(isNigerianState("Atlantis")).toBe(false);
    expect(isNigerianState("toString")).toBe(false);
    expect(isLgaOfState("Lagos", "Eti-Osa")).toBe(true);
    expect(isLgaOfState("Oyo", "Eti-Osa")).toBe(false);
    expect(getLgas("Atlantis")).toEqual([]);
  });
});