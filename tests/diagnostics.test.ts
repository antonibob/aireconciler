import { describe, it, expect, afterEach } from "vitest";
import {
  runDiagnostics,
  summarizeChecks,
  verdict,
  verdictTone,
  type Check,
} from "../src/office/diagnostics.js";

afterEach(() => {
  delete (globalThis as { Excel?: unknown }).Excel;
});

describe("summarizeChecks", () => {
  it("counts each status", () => {
    const checks: Check[] = [
      { name: "a", status: "pass", detail: "" },
      { name: "b", status: "pass", detail: "" },
      { name: "c", status: "fail", detail: "" },
      { name: "d", status: "skip", detail: "" },
    ];
    expect(summarizeChecks(checks)).toEqual({ passed: 2, failed: 1, skipped: 1 });
  });

  it("handles an empty run", () => {
    expect(summarizeChecks([])).toEqual({ passed: 0, failed: 0, skipped: 0 });
  });
});

describe("runDiagnostics outside Excel", () => {
  it("skips rather than throwing, and says how to run it properly", async () => {
    const checks = await runDiagnostics();
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe("skip");
    expect(checks[0]?.detail).toMatch(/Sideload/i);
  });

  it("reports progress through the callback as it goes", async () => {
    const seen: Check[] = [];
    await runDiagnostics((c) => seen.push(c));
    expect(seen).toHaveLength(1);
  });
});

describe("runDiagnostics against a failing host", () => {
  it("records the host error instead of aborting the run", async () => {
    // A host that is present but rejects every batch — the shape of a broken
    // sideload, a revoked permission, or an Office.js version mismatch.
    (globalThis as { Excel?: unknown }).Excel = {
      run: async () => {
        throw new Error("RichApi.Error: The request failed.");
      },
    };
    const checks = await runDiagnostics();
    expect(checks[0]).toMatchObject({ name: "Excel host", status: "pass" });
    const listing = checks.find((c) => c.name === "List worksheets");
    expect(listing?.status).toBe("fail");
    expect(listing?.detail).toContain("The request failed");
    // Everything downstream is skipped rather than reported as broken.
    expect(checks.some((c) => c.status === "skip")).toBe(true);
    // No scratch sheet was created, so nothing needed cleaning up.
    expect(checks.some((c) => c.name.startsWith("Remove scratch"))).toBe(false);
  });
});

describe("verdict", () => {
  it("never calls an all-skipped run a pass", () => {
    const v = verdict({ passed: 0, failed: 0, skipped: 1 });
    expect(v).toMatch(/proves nothing/i);
    expect(verdictTone({ passed: 0, failed: 0, skipped: 1 })).toBe("neutral");
  });

  it("leads with failures when there are any", () => {
    expect(verdict({ passed: 5, failed: 2, skipped: 0 })).toMatch(/2 check\(s\) failed/);
    expect(verdictTone({ passed: 5, failed: 2, skipped: 0 })).toBe("bad");
  });

  it("keeps skipped checks visible rather than rounding up to success", () => {
    expect(verdict({ passed: 4, failed: 0, skipped: 3 })).toMatch(/still unproven/);
  });

  it("is unqualified only when everything passed", () => {
    expect(verdict({ passed: 9, failed: 0, skipped: 0 })).toMatch(/All 9 checks passed/);
    expect(verdictTone({ passed: 9, failed: 0, skipped: 0 })).toBe("good");
  });
});
