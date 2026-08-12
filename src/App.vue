<script setup lang="ts">
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBraces,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconDownload,
  IconFileImport,
  IconFilter,
  IconFlare,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
  IconShieldLock,
  IconTrash,
  IconX,
} from "@tabler/icons-vue";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import LatencyChart from "./components/LatencyChart.vue";
import {
  analyzeLogs,
  findingsToMarkdown,
  type Analysis,
  type LogLevel,
  type TraceGroup,
} from "./parser";
import { sampleLogs } from "./sample-data";

type WorkerResponse =
  { ok: true; analysis: Analysis } | { ok: false; error: string };

const rawInput = ref(localStorage.getItem("traceframe-input") ?? sampleLogs);

function loadInitialAnalysis() {
  try {
    return {
      analysis: rawInput.value.trim() ? analyzeLogs(rawInput.value) : null,
      error: "",
    };
  } catch (initialError) {
    return {
      analysis: null,
      error:
        initialError instanceof Error
          ? initialError.message
          : "The saved log set could not be analyzed.",
    };
  }
}

const initialState = loadInitialAnalysis();

function primaryTraceId(current: Analysis | null) {
  if (!current) return "";
  return (
    [...current.traces].sort((left, right) => {
      const score = (trace: TraceGroup) =>
        Number(trace.hasError) * 10_000 +
        trace.services.length * 1_000 +
        trace.entries.length * 100 +
        trace.durationMs;
      return score(right) - score(left);
    })[0]?.traceId ?? ""
  );
}

const analysis = ref<Analysis | null>(initialState.analysis);
const loading = ref(false);
const error = ref(initialState.error);
const notice = ref("");
const sourceOpen = ref(false);
const query = ref("");
const serviceFilter = ref("all");
const levelFilter = ref<"all" | LogLevel>("all");
const selectedTraceId = ref(primaryTraceId(initialState.analysis));
const importInput = ref<HTMLInputElement | null>(null);
let worker: Worker | null = null;

const filteredTraces = computed(() => {
  if (!analysis.value) return [];
  const search = query.value.trim().toLowerCase();
  return analysis.value.traces.filter((trace) => {
    const serviceMatch =
      serviceFilter.value === "all" ||
      trace.services.includes(serviceFilter.value);
    const levelMatch =
      levelFilter.value === "all" ||
      trace.entries.some((entry) => entry.level === levelFilter.value);
    const queryMatch =
      !search ||
      trace.traceId.toLowerCase().includes(search) ||
      trace.entries.some((entry) =>
        entry.message.toLowerCase().includes(search),
      );
    return serviceMatch && levelMatch && queryMatch;
  });
});

const selectedTrace = computed<TraceGroup | null>(() => {
  const traces = analysis.value?.traces ?? [];
  return (
    traces.find((trace) => trace.traceId === selectedTraceId.value) ??
    traces[0] ??
    null
  );
});

const errorCount = computed(
  () =>
    analysis.value?.entries.filter((entry) => entry.level === "error").length ??
    0,
);

onMounted(() => {
  worker = new Worker(new URL("./workers/analyze.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    loading.value = false;
    if (event.data.ok) {
      analysis.value = event.data.analysis;
      selectedTraceId.value = primaryTraceId(event.data.analysis);
      error.value = "";
      localStorage.setItem("traceframe-input", rawInput.value);
    } else {
      analysis.value = null;
      error.value = event.data.error;
    }
  };
  worker.onerror = () => {
    loading.value = false;
    error.value =
      "The analysis worker stopped unexpectedly. Reload and try again.";
  };
});

onBeforeUnmount(() => worker?.terminate());

watch(filteredTraces, (traces) => {
  if (
    traces.length > 0 &&
    !traces.some((trace) => trace.traceId === selectedTraceId.value)
  )
    selectedTraceId.value = traces[0]?.traceId ?? "";
});

function runAnalysis() {
  if (!rawInput.value.trim()) {
    analysis.value = null;
    loading.value = false;
    error.value = "Paste logs or load the sample before analyzing.";
    return;
  }
  loading.value = true;
  error.value = "";
  notice.value = "";
  worker?.postMessage({ input: rawInput.value });
}

function loadSample() {
  rawInput.value = sampleLogs;
  notice.value = "Sample checkout traces loaded.";
  runAnalysis();
}

function clearWorkspace() {
  rawInput.value = "";
  analysis.value = null;
  selectedTraceId.value = "";
  error.value = "";
  notice.value = "";
  sourceOpen.value = true;
  localStorage.removeItem("traceframe-input");
  nextTick(() =>
    document.querySelector<HTMLTextAreaElement>("#raw-input")?.focus(),
  );
}

function importLogs(file: File | undefined) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    rawInput.value = String(reader.result);
    sourceOpen.value = true;
    notice.value = file.name + " loaded. Review the source, then analyze.";
    error.value = "";
  };
  reader.onerror = () => (error.value = "The selected file could not be read.");
  reader.readAsText(file);
}

function download(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hour12: false,
  }).format(new Date(value));
}

function formatDuration(value: number) {
  return value >= 1000 ? (value / 1000).toFixed(2) + " s" : value + " ms";
}
</script>

<template>
  <div class="app-shell">
    <a class="skip-link" href="#main">Skip to log investigation</a>
    <header class="topbar">
      <a class="brand" href="#main" aria-label="Traceframe home">
        <span class="brand-mark"><IconFlare :size="21" /></span>
        <span>Traceframe<small>Log studio</small></span>
      </a>
      <div class="top-actions">
        <span class="privacy-label"
          ><IconShieldLock :size="17" /> Browser only</span
        >
        <button
          class="icon-button"
          aria-label="Import log file"
          @click="importInput?.click()"
        >
          <IconFileImport :size="19" />
        </button>
        <button class="button" @click="sourceOpen = !sourceOpen">
          <IconBraces :size="18" />
          {{ sourceOpen ? "Hide source" : "Edit source" }}
        </button>
        <input
          ref="importInput"
          class="sr-only"
          type="file"
          aria-label="Import structured logs"
          accept=".json,.ndjson,.log,text/plain,application/json"
          @change="
            importLogs(($event.currentTarget as HTMLInputElement).files?.[0])
          "
        />
      </div>
    </header>

    <main id="main">
      <section class="hero" aria-labelledby="page-title">
        <div>
          <p class="eyebrow">Private trace investigation</p>
          <h1 id="page-title">Follow the failure across services.</h1>
        </div>
        <div class="hero-copy">
          <p>
            Turn JSON logs into traces, latency signals, and defensible findings
            without uploading production data.
          </p>
          <button class="run-button" :disabled="loading" @click="runAnalysis">
            <IconRefresh
              v-if="loading"
              class="spin"
              :size="18"
            /><IconPlayerPlay v-else :size="18" />{{
              loading ? "Analyzing" : "Analyze logs"
            }}
          </button>
        </div>
      </section>

      <div v-if="notice" class="notice success" role="status">
        <IconCheck :size="18" />{{ notice
        }}<button aria-label="Dismiss message" @click="notice = ''">
          <IconX :size="16" />
        </button>
      </div>
      <div v-if="error" class="notice error" role="alert">
        <IconAlertTriangle :size="18" />{{ error
        }}<button aria-label="Dismiss error" @click="error = ''">
          <IconX :size="16" />
        </button>
      </div>

      <section
        v-if="sourceOpen"
        class="source-panel"
        aria-labelledby="source-title"
      >
        <div class="source-heading">
          <div>
            <h2 id="source-title">Structured log source</h2>
            <p>
              NDJSON or a JSON array. Common field aliases are normalized
              automatically.
            </p>
          </div>
          <div>
            <button class="text-button" @click="loadSample">Load sample</button
            ><button class="run-button compact" @click="runAnalysis">
              <IconPlayerPlay :size="17" /> Analyze
            </button>
          </div>
        </div>
        <label for="raw-input" class="sr-only">Structured log data</label>
        <textarea
          id="raw-input"
          v-model="rawInput"
          rows="13"
          spellcheck="false"
          placeholder='{"timestamp":"...","level":"error","service":"api","message":"...","traceId":"..."}'
        ></textarea>
      </section>

      <template v-if="loading">
        <section
          class="metrics-loading"
          aria-busy="true"
          aria-label="Analyzing log set"
        >
          <span></span><span></span><span></span><span></span>
        </section>
        <div class="workspace-loading"><span></span><span></span></div>
      </template>

      <section
        v-else-if="!analysis"
        class="empty-state"
        aria-labelledby="empty-title"
      >
        <div class="empty-visual"><IconBraces :size="42" /></div>
        <div>
          <h2 id="empty-title">No investigation is open.</h2>
          <p>
            Import a log file, paste structured events, or explore a realistic
            sample.
          </p>
          <button class="run-button" @click="loadSample">
            <IconArrowRight :size="18" /> Explore sample
          </button>
        </div>
      </section>

      <template v-else>
        <section class="metrics" aria-label="Investigation summary">
          <article>
            <span>Events</span><strong>{{ analysis.entries.length }}</strong
            ><small>Normalized records</small>
          </article>
          <article>
            <span>Traces</span><strong>{{ analysis.traces.length }}</strong
            ><small>{{ analysis.services.length }} services observed</small>
          </article>
          <article :class="{ alert: analysis.errorRate >= 10 }">
            <span>Error rate</span><strong>{{ analysis.errorRate }}%</strong
            ><small>{{ errorCount }} error events</small>
          </article>
          <article :class="{ alert: analysis.p95 > 800 }">
            <span>Observed p95</span
            ><strong>{{ formatDuration(analysis.p95) }}</strong
            ><small>Across timed events</small>
          </article>
        </section>

        <div class="investigation-grid">
          <section class="trace-list panel" aria-labelledby="traces-title">
            <div class="panel-heading">
              <div>
                <h2 id="traces-title">Trace index</h2>
                <p>{{ filteredTraces.length }} matching traces</p>
              </div>
              <IconFilter :size="18" />
            </div>
            <label class="search-field"
              ><IconSearch :size="17" /><span class="sr-only"
                >Search traces</span
              ><input v-model="query" placeholder="Trace ID or message"
            /></label>
            <div class="filter-row">
              <label
                ><span class="sr-only">Service</span
                ><select v-model="serviceFilter">
                  <option value="all">All services</option>
                  <option
                    v-for="service in analysis.services"
                    :key="service.service"
                    :value="service.service"
                  >
                    {{ service.service }}
                  </option>
                </select></label
              ><label
                ><span class="sr-only">Log level</span
                ><select v-model="levelFilter">
                  <option value="all">All levels</option>
                  <option value="error">Errors</option>
                  <option value="warn">Warnings</option>
                  <option value="info">Info</option>
                </select></label
              >
            </div>
            <div v-if="filteredTraces.length" class="trace-items">
              <button
                v-for="trace in filteredTraces"
                :key="trace.traceId"
                :class="{
                  selected: selectedTrace?.traceId === trace.traceId,
                  failed: trace.hasError,
                }"
                @click="selectedTraceId = trace.traceId"
              >
                <div>
                  <strong>{{ trace.traceId }}</strong
                  ><span>{{ trace.services.join(" / ") }}</span>
                </div>
                <div>
                  <small>{{ formatDuration(trace.durationMs) }}</small
                  ><IconChevronRight :size="17" />
                </div>
              </button>
            </div>
            <div v-else class="no-results">
              <IconSearch :size="24" /><strong>No matching traces</strong>
              <p>Clear or broaden the current filters.</p>
              <button
                class="text-button"
                @click="
                  query = '';
                  serviceFilter = 'all';
                  levelFilter = 'all';
                "
              >
                Reset filters
              </button>
            </div>
          </section>

          <section class="trace-detail panel" aria-labelledby="detail-title">
            <template v-if="selectedTrace">
              <div class="detail-heading">
                <div>
                  <span
                    :class="[
                      'trace-status',
                      { failed: selectedTrace.hasError },
                    ]"
                    >{{
                      selectedTrace.hasError ? "Error path" : "Healthy path"
                    }}</span
                  >
                  <h2 id="detail-title">{{ selectedTrace.traceId }}</h2>
                  <p>
                    {{ selectedTrace.services.length }} services,
                    {{ selectedTrace.entries.length }} events,
                    {{ formatDuration(selectedTrace.durationMs) }}
                  </p>
                </div>
                <IconClock :size="24" />
              </div>
              <ol class="trace-timeline">
                <li
                  v-for="entry in selectedTrace.entries"
                  :key="entry.id"
                  :class="entry.level"
                >
                  <time :datetime="entry.timestamp">{{
                    formatTime(entry.timestamp)
                  }}</time
                  ><span class="level-marker" aria-hidden="true"></span>
                  <div>
                    <div class="entry-meta">
                      <strong>{{ entry.service }}</strong
                      ><span>{{ entry.level }}</span
                      ><span v-if="entry.durationMs !== undefined">{{
                        formatDuration(entry.durationMs)
                      }}</span>
                    </div>
                    <p>{{ entry.message }}</p>
                  </div>
                </li>
              </ol>
            </template>
          </section>
        </div>

        <section class="signals" aria-labelledby="signals-title">
          <div class="findings">
            <p class="eyebrow">Investigation signals</p>
            <h2 id="signals-title">Patterns worth checking next</h2>
            <ol>
              <li v-for="finding in analysis.findings" :key="finding">
                <span>{{
                  String(analysis.findings.indexOf(finding) + 1).padStart(
                    2,
                    "0",
                  )
                }}</span>
                <p>{{ finding }}</p>
              </li>
            </ol>
            <button
              class="button inverse"
              @click="
                download(
                  'traceframe-findings.md',
                  findingsToMarkdown(analysis),
                  'text/markdown',
                )
              "
            >
              <IconDownload :size="18" /> Export findings
            </button>
          </div>
          <div class="service-chart">
            <div>
              <h3>Service latency</h3>
              <p>Observed p95 from timed events in this import.</p>
            </div>
            <LatencyChart :services="analysis.services" />
          </div>
        </section>
      </template>

      <footer>
        <div>
          <strong>Traceframe</strong
          ><span>Source data stays inside your browser.</span>
        </div>
        <button class="danger-link" @click="clearWorkspace">
          <IconTrash :size="17" /> Clear workspace
        </button>
      </footer>
    </main>
  </div>
</template>
