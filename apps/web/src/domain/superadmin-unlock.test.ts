import { describe, expect, it } from "vitest";
import {
  canAttemptSuperadminUnlock,
  verifySuperadminUnlockPassword,
} from "@/domain/superadmin-unlock";

describe("superadmin unlock gate", () => {
  it("allows only Sonshas to attempt unlock", () => {
    expect(canAttemptSuperadminUnlock("sonshasopunga@gmail.com")).toBe(true);
    expect(canAttemptSuperadminUnlock("SonshasOpunga@gmail.com")).toBe(true);
    expect(canAttemptSuperadminUnlock("rulieeykenya@gmail.com")).toBe(false);
    expect(canAttemptSuperadminUnlock(null)).toBe(false);
  });

  it("accepts the gate password and rejects others", () => {
    expect(verifySuperadminUnlockPassword("Evansmachika1613")).toBe(true);
    expect(verifySuperadminUnlockPassword("wrong")).toBe(false);
    expect(verifySuperadminUnlockPassword("Nicole40223175")).toBe(false);
    expect(verifySuperadminUnlockPassword("")).toBe(false);
  });
});
