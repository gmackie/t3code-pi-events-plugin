#!/usr/bin/env bun
// Stdio entry point for the MCP-native pi-events plugin (manifest v2 `mcpServer`).
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { loadConfig } from "./config.ts";
import { createPiEventsMcpServer } from "./server.ts";
import { EventStore } from "./store.ts";
import { createWebhookNotifier } from "./webhook.ts";

const config = loadConfig();
const server = createPiEventsMcpServer({
  store: new EventStore(config.statePath),
  notifier: createWebhookNotifier(config.webhookUrl ? { url: config.webhookUrl } : {}),
});
await server.connect(new StdioServerTransport());
