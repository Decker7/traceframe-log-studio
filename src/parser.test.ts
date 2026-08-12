import { describe, expect, it } from "vitest";
import { analyzeLogs, findingsToMarkdown, parseInput } from "./parser";
import { sampleLogs } from "./sample-data";

describe("Traceframe parser", () => {
  it("normalizes NDJSON into ordered entries", () => {
    const entries = parseInput(sampleLogs);
    expect(entries).toHaveLength(15);
    expect(entries[0]?.service).toBe("edge-router");
  });

  it("accepts JSON arrays and common field aliases", () => {
    const entries = parseInput(
      JSON.stringify([
        {
          time: "2026-08-12T10:00:00Z",
          severity: "fatal",
          component: "worker",
          msg: "Job failed",
          correlationId: "c1",
          latency: 42,
        },
      ]),
    );
    expect(entries[0]).toMatchObject({
      level: "error",
      service: "worker",
      traceId: "c1",
      durationMs: 42,
    });
  });

  it("identifies cross-service and latency signals", () => {
    const analysis = analyzeLogs(sampleLogs);
    expect(analysis.p95).toBeGreaterThan(800);
    expect(
      analysis.traces.find((trace) => trace.traceId === "tr_c401")?.services,
    ).toHaveLength(4);
    expect(analysis.findings.length).toBeGreaterThanOrEqual(2);
  });

  it("reports the line number for malformed NDJSON", () => {
    expect(() => parseInput('{"message":"ok"}\nnot-json')).toThrow("Line 2");
  });

  it("exports a readable investigation summary", () => {
    expect(findingsToMarkdown(analyzeLogs(sampleLogs))).toContain(
      "## Service summary",
    );
  });
});
