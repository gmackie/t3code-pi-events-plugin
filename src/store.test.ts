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

  it("ignores a repeated dedupeKey within a thread and keeps assigning sequences itself", () => {
    const store = new EventStore(":memory:");
    expect(store.append({ type: "server.ready", dedupeKey: "boot" })).toMatchObject({ accepted: true, event: { sequence: 1 } });
    expect(store.append({ type: "server.ready", dedupeKey: "boot" })).toEqual({ accepted: false, duplicateOf: 1 });
    expect(store.append({ type: "turn.settled" })).toMatchObject({ accepted: true, event: { sequence: 2 } });
  });

  it("keeps dedupe keys per thread, so sessions numbering their own events do not collide", () => {
    const store = new EventStore(":memory:");
    for (let i = 0; i < 5; i++) store.append({ type: "turn.settled", threadId: "t1" });
    expect(store.append({ type: "session.started", threadId: "t2", dedupeKey: "1" })).toMatchObject({ accepted: true, event: { sequence: 6 } });
    expect(store.append({ type: "session.started", threadId: "t1", dedupeKey: "1" })).toMatchObject({ accepted: true, event: { sequence: 7 } });
    expect(store.append({ type: "session.started", threadId: "t2", dedupeKey: "1" })).toEqual({ accepted: false, duplicateOf: 6 });
    expect(store.append({ type: "turn.settled", threadId: "t2", dedupeKey: "2" })).toMatchObject({ accepted: true, event: { sequence: 8 } });
  });

  it("never lets a caller value erase or renumber the log", () => {
    const store = new EventStore(":memory:");
    for (let i = 0; i < 5; i++) store.append({ type: "turn.settled" });
    expect(store.append({ type: "server.ready", dedupeKey: "10000" })).toMatchObject({ accepted: true, event: { sequence: 6 } });
    expect(store.recent({ limit: 1000 }).map((event) => event.sequence)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(store.append({ type: "turn.settled" })).toMatchObject({ event: { sequence: 7 } });
  });
});
