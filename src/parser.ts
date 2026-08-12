export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  traceId: string;
  durationMs?: number;
  attributes: Record<string, unknown>;
}

export interface TraceGroup {
  traceId: string;
  entries: LogEntry[];
  services: string[];
  durationMs: number;
  hasError: boolean;
  startedAt: string;
}

export interface ServiceStat {
  service: string;
  events: number;
  errors: number;
  p95: number;
}

export interface Analysis {
  entries: LogEntry[];
  traces: TraceGroup[];
  services: ServiceStat[];
  errorRate: number;
  p95: number;
  findings: string[];
}

function normalizeLevel(value: unknown): LogLevel {
  const level = String(value ?? "info").toLowerCase();
  if (level === "error" || level === "fatal") return "error";
  if (level === "warn" || level === "warning") return "warn";
  if (level === "debug" || level === "trace") return "debug";
  return "info";
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ??
    0
  );
}

export function parseInput(input: string): LogEntry[] {
  const source = input.trim();
  if (!source) return [];
  let records: unknown[];
  if (source.startsWith("[")) {
    const parsed = JSON.parse(source) as unknown;
    if (!Array.isArray(parsed))
      throw new Error("The JSON document must be an array of log objects.");
    records = parsed;
  } else {
    records = source
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          throw new Error("Line " + (index + 1) + " is not valid JSON.");
        }
      });
  }

  return records
    .map((record, index) => {
      if (!record || typeof record !== "object" || Array.isArray(record))
        throw new Error("Log entry " + (index + 1) + " must be a JSON object.");
      const value = record as Record<string, unknown>;
      const timestamp = String(value.timestamp ?? value.time ?? value.ts ?? "");
      if (!timestamp || Number.isNaN(Date.parse(timestamp)))
        throw new Error(
          "Log entry " + (index + 1) + " has an invalid timestamp.",
        );
      const message = String(value.message ?? value.msg ?? "").trim();
      if (!message)
        throw new Error("Log entry " + (index + 1) + " has no message.");
      const traceId = String(
        value.traceId ??
          value.trace_id ??
          value.correlationId ??
          value.requestId ??
          "untraced-" + index,
      );
      return {
        id: String(value.id ?? "log-" + index),
        timestamp,
        level: normalizeLevel(value.level ?? value.severity),
        service: String(
          value.service ?? value.component ?? value.app ?? "unknown-service",
        ),
        message,
        traceId,
        durationMs: numberValue(
          value.durationMs ?? value.duration_ms ?? value.latency,
        ),
        attributes: value,
      };
    })
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export function analyzeLogs(input: string): Analysis {
  const entries = parseInput(input);
  const traceMap = new Map<string, LogEntry[]>();
  const serviceMap = new Map<string, LogEntry[]>();
  for (const entry of entries) {
    traceMap.set(entry.traceId, [
      ...(traceMap.get(entry.traceId) ?? []),
      entry,
    ]);
    serviceMap.set(entry.service, [
      ...(serviceMap.get(entry.service) ?? []),
      entry,
    ]);
  }

  const traces = [...traceMap.entries()]
    .map(([traceId, traceEntries]) => {
      const first = traceEntries[0];
      const last = traceEntries.at(-1);
      const measured = traceEntries
        .map((entry) => entry.durationMs)
        .filter((value): value is number => value !== undefined);
      const wallClock =
        first && last
          ? Date.parse(last.timestamp) - Date.parse(first.timestamp)
          : 0;
      return {
        traceId,
        entries: traceEntries,
        services: [...new Set(traceEntries.map((entry) => entry.service))],
        durationMs:
          measured.length > 0 ? Math.max(...measured) : Math.max(0, wallClock),
        hasError: traceEntries.some((entry) => entry.level === "error"),
        startedAt: first?.timestamp ?? "",
      };
    })
    .sort((a, b) => b.durationMs - a.durationMs);

  const services = [...serviceMap.entries()]
    .map(([service, serviceEntries]) => {
      const durations = serviceEntries
        .map((entry) => entry.durationMs)
        .filter((value): value is number => value !== undefined);
      return {
        service,
        events: serviceEntries.length,
        errors: serviceEntries.filter((entry) => entry.level === "error")
          .length,
        p95: Math.round(percentile(durations, 0.95)),
      };
    })
    .sort((a, b) => b.p95 - a.p95);

  const durations = entries
    .map((entry) => entry.durationMs)
    .filter((value): value is number => value !== undefined);
  const errors = entries.filter((entry) => entry.level === "error");
  const p95 = Math.round(percentile(durations, 0.95));
  const errorRate = entries.length
    ? Math.round((errors.length / entries.length) * 1000) / 10
    : 0;
  const findings: string[] = [];
  if (p95 > 800) findings.push("Observed p95 latency is above 800 ms.");
  if (errorRate >= 10)
    findings.push("Errors make up at least 10% of the imported events.");
  const noisyService = services.find((service) => service.errors >= 2);
  if (noisyService)
    findings.push(
      noisyService.service + " has the highest repeated error signal.",
    );
  const multiServiceTrace = traces.find(
    (trace) => trace.services.length >= 3 && trace.hasError,
  );
  if (multiServiceTrace)
    findings.push(
      "Trace " +
        multiServiceTrace.traceId +
        " crosses three services and contains an error.",
    );
  if (entries.length > 0 && findings.length === 0)
    findings.push(
      "No high-confidence risk pattern was detected in this sample.",
    );

  return { entries, traces, services, errorRate, p95, findings };
}

export function findingsToMarkdown(analysis: Analysis): string {
  return [
    "# Traceframe investigation",
    "",
    "- Events: " + analysis.entries.length,
    "- Traces: " + analysis.traces.length,
    "- Error rate: " + analysis.errorRate + "%",
    "- Observed p95: " + analysis.p95 + " ms",
    "",
    "## Findings",
    "",
    ...analysis.findings.map((finding) => "- " + finding),
    "",
    "## Service summary",
    "",
    ...analysis.services.map(
      (service) =>
        "- " +
        service.service +
        ": " +
        service.events +
        " events, " +
        service.errors +
        " errors, p95 " +
        service.p95 +
        " ms",
    ),
  ].join("\n");
}
