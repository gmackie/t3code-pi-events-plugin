import { afterEach, describe, expect, it } from "bun:test";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { tmpdir } from "node:os";

import { EventStore } from "./store.ts";
import { connectedClient, fakeWebhook, type FakeWebhook } from "./testing.ts";

type Structured<T> = { structuredContent?: T; isError?: boolean; content: { type: string; text?: string }[] };
type Client = Awaited<ReturnType<typeof connectedClient>>["client"];
const call = async <T = Record<string, unknown>>(client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as unknown as Structured<T>;
const text = (result: Structured<unknown>) => result.content[0]?.text ?? "";

let hook: FakeWebhook | undefined;
afterEach(() => {
  hook?.stop();
  hook = undefined;
});

describe("pi-events MCP server", () => {
  it("links the status tool to its ui:// view and lets the view call the tools it needs", async () => {
    const { client } = await connectedClient();
    const byName = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool]));
    expect([...byName.keys()].sort()).toEqual(["pi_events_record", "pi_events_send_test", "pi_events_status"]);
    expect(byName.get("pi_events_status")?._meta).toMatchObject({ ui: { resourceUri: "ui://pi-events/status.html", visibility: ["model", "app"] } });
    expect(byName.get("pi_events_send_test")?._meta).toEqual({ ui: { visibility: ["model", "app"] } });
    expect(byName.get("pi_events_status")?.annotations?.readOnlyHint).toBe(true);
  });

  it("serves the view as a self-contained MCP App resource", async () => {
    const { client } = await connectedClient();
    const { resources } = await client.listResources();
    expect(resources.map((resource) => [resource.uri, resource.mimeType])).toEqual([["ui://pi-events/status.html", RESOURCE_MIME_TYPE]]);
    const { contents } = await client.readResource({ uri: "ui://pi-events/status.html" });
    const html = (contents[0] as { text: string }).text;
    expect(html).toStartWith("<!doctype html>");
    expect(html).toContain("ui/initialize");
    expect(html).toContain("pi_events_status");
    // T3's sandbox CSP is default-src 'none': nothing may load from outside.
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
    expect(html.length).toBeLessThan(100_000);
  });

  it("records events, notifies the webhook and reports status per thread", async () => {
    hook = fakeWebhook();
    const { client } = await connectedClient({ webhookUrl: hook.url });
    await call(client, "pi_events_record", { type: "session.started", threadId: "t1" });
    const recorded = await call<{ event: { sequence: number }; notification: { status: string } }>(client, "pi_events_record", { type: "turn.settled", threadId: "t1", runId: "run-1" });
    await call(client, "pi_events_record", { type: "runtime.error", threadId: "t2", message: "boom" });

    expect(recorded.isError).toBeFalsy();
    expect(recorded.structuredContent).toMatchObject({ event: { sequence: 2 }, notification: { status: "sent", httpStatus: 204 } });
    expect(text(recorded)).toContain("Webhook notified.");
    expect(hook.received).toHaveLength(3);
    expect(hook.received[1]).toMatchObject({ plugin: "com.t3code.pi-events", test: false, event: { type: "turn.settled", runId: "run-1" }, status: { label: "Turn complete", tone: "positive" } });

    const status = await call<{ current: { label: string }; events: { sequence: number }[]; webhook: string }>(client, "pi_events_status", { threadId: "t1" });
    expect(status.structuredContent).toMatchObject({ current: { label: "Turn complete", detail: "run-1" }, webhook: "configured" });
    expect(status.structuredContent?.events.map((event) => event.sequence)).toEqual([2, 1]);
    expect(text(status)).toContain("Current: Turn complete (run-1).");
  });

  it("ignores duplicate deliveries without notifying twice", async () => {
    hook = fakeWebhook();
    const { client } = await connectedClient({ webhookUrl: hook.url });
    expect((await call(client, "pi_events_record", { type: "server.ready", dedupeKey: "boot-1" })).structuredContent).toMatchObject({ accepted: true, event: { sequence: 1 } });
    const retried = await call(client, "pi_events_record", { type: "server.ready", dedupeKey: "boot-1" });
    expect(retried.isError).toBeFalsy();
    expect(retried.structuredContent).toEqual({ accepted: false, duplicateOf: 1 });
    expect(hook.received).toHaveLength(1);
  });

  it("still records when no webhook is configured, and the test notification says what is missing", async () => {
    const { client } = await connectedClient();
    const recorded = await call<{ notification: { status: string } }>(client, "pi_events_record", { type: "server.ready" });
    expect(recorded.structuredContent?.notification.status).toBe("skipped");
    expect((await call<{ webhook: string }>(client, "pi_events_status")).structuredContent?.webhook).toBe("missing");

    const test = await call(client, "pi_events_send_test");
    expect(test.isError).toBe(true);
    expect(text(test)).toContain("PI_EVENTS_WEBHOOK_URL");
  });

  it("rejects a webhook URL that is not http(s)", async () => {
    const { client } = await connectedClient({ webhookUrl: "ftp://example.test/hook" });
    expect((await call<{ webhook: string }>(client, "pi_events_status")).structuredContent?.webhook).toBe("invalid");
    const test = await call(client, "pi_events_send_test");
    expect(test.isError).toBe(true);
    expect(text(test)).toBe("PI_EVENTS_WEBHOOK_URL must be an http(s) URL.");
  });

  it("delivers a test notification", async () => {
    hook = fakeWebhook();
    hook.status = 200;
    const { client } = await connectedClient({ webhookUrl: hook.url });
    const test = await call(client, "pi_events_send_test");
    expect(test.structuredContent).toEqual({ delivered: true, httpStatus: 200 });
    expect(hook.received[0]).toMatchObject({ plugin: "com.t3code.pi-events", test: true });
  });

  it("keeps upstream failures short and never leaks the webhook URL or body", async () => {
    hook = fakeWebhook();
    hook.status = 502;
    const { client } = await connectedClient({ webhookUrl: hook.url });
    const test = await call(client, "pi_events_send_test");
    expect(test.isError).toBe(true);
    expect(text(test)).toBe("The notification webhook is temporarily unavailable (502).");

    hook.status = 404;
    const recorded = await call<{ accepted: boolean; notification: { status: string; error: string } }>(client, "pi_events_record", { type: "server.ready" });
    // The event is still logged; only the notification failed.
    expect(recorded.isError).toBeFalsy();
    expect(recorded.structuredContent).toMatchObject({ accepted: true, notification: { status: "failed", error: "The notification webhook rejected the notification (404)." } });
    for (const result of [test, recorded]) {
      expect(JSON.stringify(result)).not.toContain("secret");
      expect(JSON.stringify(result)).not.toContain("127.0.0.1");
    }
  });

  it("times out a hanging webhook", async () => {
    hook = fakeWebhook();
    hook.delayMs = 500;
    const { client } = await connectedClient({ webhookUrl: hook.url, timeoutMs: 50 });
    const test = await call(client, "pi_events_send_test");
    expect(test.isError).toBe(true);
    expect(text(test)).toContain("did not answer within");
  });

  it("shares the event log between plugin copies through the state file", async () => {
    // T3 runs one stdio copy per agent session plus one in its pool: an agent
    // records in its copy and the panel reads through the pool's copy.
    const path = `${tmpdir()}/pi-events-${crypto.randomUUID()}.sqlite`;
    const session = await connectedClient({ store: new EventStore(path) });
    const pool = await connectedClient({ store: new EventStore(path) });
    await call(session.client, "pi_events_record", { type: "turn.settled", threadId: "t1", runId: "r1" });
    await call(pool.client, "pi_events_record", { type: "turn.settled", threadId: "t1", runId: "r2" });
    const status = await call<{ events: { sequence: number; runId: string }[] }>(pool.client, "pi_events_status", { threadId: "t1" });
    expect(status.structuredContent?.events.map((event) => [event.sequence, event.runId])).toEqual([
      [2, "r2"],
      [1, "r1"],
    ]);
  });
});
