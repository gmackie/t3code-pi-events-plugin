import { describe, expect, it } from "bun:test";

import { statusForEvent } from "./events.ts";

describe("Pi-style lifecycle plugin", () => {
  it("turns observe-only lifecycle events into declarative status contributions", () => {
    expect(statusForEvent({ type: "turn.settled", sequence: 3, runId: "run-1" })).toEqual({ label: "Turn complete", tone: "positive", detail: "run-1" });
    expect(statusForEvent({ type: "runtime.error", sequence: 4, message: "x".repeat(500) }).detail).toHaveLength(240);
  });
});
