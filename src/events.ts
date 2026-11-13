export const LIFECYCLE_EVENT_TYPES = ["server.ready", "session.started", "turn.settled", "runtime.error"] as const;

export type LifecycleEvent = {
  type: (typeof LIFECYCLE_EVENT_TYPES)[number];
  sequence: number;
  threadId?: string;
  runId?: string;
  message?: string;
};

export type StatusContribution = {
  label: string;
  tone: "positive" | "neutral" | "negative";
  detail?: string;
};

export function statusForEvent(event: LifecycleEvent): StatusContribution {
  switch (event.type) {
    case "server.ready":
      return { label: "T3 ready", tone: "positive" };
    case "session.started":
      return { label: "Agent session started", tone: "neutral", ...(event.threadId ? { detail: event.threadId } : {}) };
    case "turn.settled":
      return { label: "Turn complete", tone: "positive", ...(event.runId ? { detail: event.runId } : {}) };
    case "runtime.error":
      return { label: "Runtime error", tone: "negative", ...(event.message ? { detail: event.message.slice(0, 240) } : {}) };
  }
}
