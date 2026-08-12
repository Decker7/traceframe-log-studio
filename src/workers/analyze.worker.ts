/// <reference lib="webworker" />
import { analyzeLogs } from "../parser";

self.onmessage = (event: MessageEvent<{ input: string }>) => {
  try {
    self.postMessage({ ok: true, analysis: analyzeLogs(event.data.input) });
  } catch (error) {
    self.postMessage({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "The log set could not be analyzed.",
    });
  }
};

export {};
