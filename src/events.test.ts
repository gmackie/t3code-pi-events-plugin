import { describe, expect, it } from "bun:test";

import { OrderedEventBuffer, statusForEvent } from "./events.ts";

describe("Pi-style lifecycle plugin", () => {
  it("turns observe-only lifecycle events into declarative status contributions", () => {
    expect(statusForEvent({ type: "turn.settled", sequence: 3, runId: "run-1" })).toEqual({ label: "Turn complete", tone: "positive", detail: "run-1" });
    expect(statusForEvent({ type: "runtime.error", sequence: 4, message: "x".repeat(500) }).detail).toHaveLength(240);
  });

  it("rejects duplicate and out-of-order event delivery", () => {
    const buffer = new OrderedEventBuffer();
    expect(buffer.accept({ type: "server.ready", sequence: 1 })).toBe(true);
    expect(buffer.accept({ type: "turn.settled", sequence: 1 })).toBe(false);
    expect(buffer.accept({ type: "turn.settled", sequence: 0 })).toBe(false);
    expect(buffer.accept({ type: "turn.settled", sequence: 2 })).toBe(true);
  });

  it("continues from a seeded sequence", () => {
    const buffer = new OrderedEventBuffer(5);
    expect(buffer.accept({ type: "turn.settled", sequence: 5 })).toBe(false);
    expect(buffer.accept({ type: "turn.settled", sequence: 6 })).toBe(true);
  });
});
