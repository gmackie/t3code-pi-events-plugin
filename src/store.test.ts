import { describe, expect, it } from "bun:test";

import { EventStore, RETAINED_EVENTS } from "./store.ts";

describe("EventStore", () => {
  it("assigns sequences, scopes to a thread with environment-wide events, and prunes", () => {
    const store = new EventStore(":memory:");
    store.append({ type: "server.ready" });
    store.append({ type: "session.started", threadId: "t1" });
    store.append({ type: "session.started", threadId: "t2" });
    expect(store.recent({ threadId: "t1" }).map((event) => event.sequence)).toEqual([2, 1]);

    for (let i = 0; i < RETAINED_EVENTS + 5; i++) store.append({ type: "turn.settled" });
    expect(store.lastSequence()).toBe(RETAINED_EVENTS + 8);
    expect(store.recent({ limit: 1000 })).toHaveLength(RETAINED_EVENTS);
  });

  it("rejects a caller sequence at or below the last one", () => {
    const store = new EventStore(":memory:");
    expect(store.append({ type: "server.ready", sequence: 3 }).accepted).toBe(true);
    expect(store.append({ type: "server.ready", sequence: 2 })).toEqual({ accepted: false, lastSequence: 3 });
    expect(store.append({ type: "turn.settled" })).toMatchObject({ accepted: true, event: { sequence: 4 } });
  });
});
