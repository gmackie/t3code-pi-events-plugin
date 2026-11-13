import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { OrderedEventBuffer, type LifecycleEvent } from "./events.ts";

export type RecordedEvent = LifecycleEvent & { recordedAt: string };

export type AppendResult = { accepted: true; event: RecordedEvent } | { accepted: false; lastSequence: number };

// How many events the shared log keeps; older ones are pruned on append.
export const RETAINED_EVENTS = 200;

type Row = { type: LifecycleEvent["type"]; sequence: number; threadId: string | null; runId: string | null; message: string | null; recordedAt: string };

// The lifecycle event log every plugin copy shares. T3 runs one stdio copy per
// agent session plus one in its pool: an agent records an event in its copy and
// the panel reads it through the pool's copy, so nothing lives in memory.
export class EventStore {
  readonly #db: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new Database(path, { create: true });
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec("PRAGMA busy_timeout = 5000");
    this.#db.exec(
      "CREATE TABLE IF NOT EXISTS lifecycle_events (sequence INTEGER PRIMARY KEY, type TEXT NOT NULL, thread_id TEXT, run_id TEXT, message TEXT, recorded_at TEXT NOT NULL)",
    );
  }

  // Assigns the next sequence, or checks a caller's sequence so a retried
  // delivery is not recorded (or notified) twice. IMMEDIATE serializes copies.
  append(event: Omit<LifecycleEvent, "sequence"> & { sequence?: number }): AppendResult {
    return this.#db
      .transaction((): AppendResult => {
        const lastSequence = this.lastSequence();
        const recorded: RecordedEvent = {
          type: event.type,
          sequence: event.sequence ?? lastSequence + 1,
          ...(event.threadId ? { threadId: event.threadId } : {}),
          ...(event.runId ? { runId: event.runId } : {}),
          ...(event.message ? { message: event.message } : {}),
          recordedAt: new Date().toISOString(),
        };
        if (!new OrderedEventBuffer(lastSequence).accept(recorded)) return { accepted: false, lastSequence };
        this.#db
          .query("INSERT INTO lifecycle_events (sequence, type, thread_id, run_id, message, recorded_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(recorded.sequence, recorded.type, recorded.threadId ?? null, recorded.runId ?? null, recorded.message ?? null, recorded.recordedAt);
        this.#db.query("DELETE FROM lifecycle_events WHERE sequence <= ?").run(recorded.sequence - RETAINED_EVENTS);
        return { accepted: true, event: recorded };
      })
      .immediate();
  }

  lastSequence(): number {
    return this.#db.query<{ last: number | null }, []>("SELECT MAX(sequence) AS last FROM lifecycle_events").get()?.last ?? 0;
  }

  // Newest first. With a threadId, that thread's events plus thread-less ones
  // (such as server.ready), which describe the whole environment.
  recent(options: { threadId?: string; limit?: number } = {}): RecordedEvent[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), RETAINED_EVENTS);
    const select = "SELECT type, sequence, thread_id AS threadId, run_id AS runId, message, recorded_at AS recordedAt FROM lifecycle_events";
    const rows = options.threadId
      ? this.#db.query<Row, [string, number]>(`${select} WHERE thread_id = ? OR thread_id IS NULL ORDER BY sequence DESC LIMIT ?`).all(options.threadId, limit)
      : this.#db.query<Row, [number]>(`${select} ORDER BY sequence DESC LIMIT ?`).all(limit);
    return rows.map(({ threadId, runId, message, ...rest }) => ({
      ...rest,
      ...(threadId ? { threadId } : {}),
      ...(runId ? { runId } : {}),
      ...(message ? { message } : {}),
    }));
  }

  close(): void {
    this.#db.close();
  }
}
