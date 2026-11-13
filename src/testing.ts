// Test fixtures shared by the MCP server and view-bridge tests.
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { createPiEventsMcpServer } from "./server.ts";
import { EventStore } from "./store.ts";
import { createWebhookNotifier } from "./webhook.ts";

export type FakeWebhook = { url: string; received: unknown[]; status: number; delayMs: number; stop(): void };

// A local webhook receiver standing in for Slack, Discord or a custom endpoint.
export function fakeWebhook(): FakeWebhook {
  const hook: FakeWebhook = {
    url: "",
    received: [],
    status: 204,
    delayMs: 0,
    stop: () => server.stop(true),
  };
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (hook.delayMs) await Bun.sleep(hook.delayMs);
      hook.received.push(await request.json());
      return new Response(hook.status >= 400 ? "secret upstream detail" : null, { status: hook.status });
    },
  });
  hook.url = `http://127.0.0.1:${server.port}/hooks/secret-token`;
  return hook;
}

export async function connectedClient(options: { webhookUrl?: string; store?: EventStore; timeoutMs?: number } = {}) {
  const store = options.store ?? new EventStore(":memory:");
  const server = createPiEventsMcpServer({
    store,
    notifier: createWebhookNotifier({ ...(options.webhookUrl ? { url: options.webhookUrl } : {}), ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-host", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, server, store };
}
