import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { LIFECYCLE_EVENT_TYPES, statusForEvent } from "./events.ts";
import type { EventStore } from "./store.ts";
import { VIEWS, viewHtml, type ViewName } from "./views/html.ts";
import type { EventView, StatusData } from "./views/render.ts";
import { PLUGIN_ID, WebhookError, type NotificationOutcome, type NotificationPayload, type WebhookNotifier } from "./webhook.ts";

export const SERVER_INFO = { name: "pi-events", version: "0.2.0" } as const;

export type PiEventsServerOptions = {
  store: Pick<EventStore, "append" | "recent">;
  notifier: WebhookNotifier;
};

const threadId = z.string().min(1).max(200);

export function createPiEventsMcpServer(options: PiEventsServerOptions): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "Pi events keeps an observe-only lifecycle log with notifications. T3 no longer pushes lifecycle hooks to plugins, so report milestones yourself with pi_events_record (session.started, turn.settled, runtime.error). Read the log with pi_events_status.",
  });
  const { store, notifier } = options;

  function status(filter: { threadId?: string; limit?: number }): StatusData {
    const events: EventView[] = store.recent(filter).map((event) => ({ ...event, status: statusForEvent(event) }));
    const latest = events[0];
    return {
      ...(filter.threadId ? { threadId: filter.threadId } : {}),
      ...(latest ? { current: { ...latest.status, type: latest.type, sequence: latest.sequence, recordedAt: latest.recordedAt } } : {}),
      events,
      webhook: notifier.state,
      refreshedAt: new Date().toISOString(),
    };
  }

  for (const [name, view] of Object.entries(VIEWS) as [ViewName, (typeof VIEWS)[ViewName]][]) {
    registerAppResource(server, view.title, view.uri, { mimeType: RESOURCE_MIME_TYPE, _meta: { ui: { prefersBorder: true } } }, async () => ({
      contents: [{ uri: view.uri, mimeType: RESOURCE_MIME_TYPE, text: await viewHtml(name), _meta: { ui: { prefersBorder: true } } }],
    }));
  }

  registerAppTool(
    server,
    "pi_events_status",
    {
      title: "Lifecycle status",
      description:
        "Show the current lifecycle status and recent lifecycle events, newest first. With threadId, only that thread's events plus environment-wide ones. Renders the lifecycle status view.",
      inputSchema: z.object({
        threadId: threadId.optional().describe("T3 thread id to scope the log to"),
        limit: z.number().int().min(1).max(200).optional().describe("How many events to return (default 50)"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: VIEWS.status.uri, visibility: ["model", "app"] } },
    },
    async (args) =>
      result(async () => {
        const data = status(args);
        const head = data.current ? `Current: ${data.current.label}${data.current.detail ? ` (${data.current.detail})` : ""}.` : "No lifecycle events recorded yet.";
        const lines = data.events.map((event) => `- #${event.sequence} ${event.type}${event.threadId ? ` thread=${event.threadId}` : ""}${event.runId ? ` run=${event.runId}` : ""} ${event.recordedAt}`);
        return { data, text: [head, `Webhook: ${data.webhook}.`, ...lines].join("\n") };
      }),
  );

  server.registerTool(
    "pi_events_record",
    {
      title: "Record lifecycle event",
      description:
        "Record a lifecycle event in the shared log and notify the configured webhook. Pass sequence only to make retries safe: an event at or below the last recorded sequence is ignored and not notified.",
      inputSchema: z.object({
        type: z.enum(LIFECYCLE_EVENT_TYPES),
        threadId: threadId.optional().describe("T3 thread id the event belongs to"),
        runId: z.string().min(1).max(200).optional().describe("Run or turn id, shown for turn.settled"),
        message: z.string().min(1).max(4000).optional().describe("Error message for runtime.error (shown up to 240 characters)"),
        sequence: z.number().int().positive().optional().describe("Caller-assigned sequence for idempotent delivery"),
      }),
      annotations: { idempotentHint: false, openWorldHint: true },
    },
    async (args) =>
      result(async () => {
        const appended = store.append(args);
        if (!appended.accepted) {
          return {
            data: { accepted: false, lastSequence: appended.lastSequence },
            text: `Ignored: sequence ${args.sequence} is not after the last recorded sequence ${appended.lastSequence}.`,
          };
        }
        const { event } = appended;
        const notification = await notify(notifier, { event, status: statusForEvent(event), test: false });
        const notified =
          notification.status === "sent" ? "Webhook notified." : notification.status === "skipped" ? `Webhook not notified: ${notification.reason}` : `Webhook notification failed: ${notification.error}`;
        return { data: { accepted: true, event, notification }, text: `Recorded ${event.type} as #${event.sequence}. ${notified}` };
      }),
  );

  server.registerTool(
    "pi_events_send_test",
    {
      title: "Send test notification",
      description: "Send a test notification to the configured webhook and report whether it was delivered.",
      inputSchema: z.object({}),
      annotations: { openWorldHint: true },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async () =>
      result(async () => {
        const { httpStatus } = await notifier.send({
          plugin: PLUGIN_ID,
          test: true,
          status: { label: "Test notification", tone: "neutral", detail: "Sent from T3 Code" },
          sentAt: new Date().toISOString(),
        });
        return { data: { delivered: true, httpStatus }, text: `Test notification delivered (HTTP ${httpStatus}).` };
      }),
  );

  return server;
}

// A missing webhook is not a failure for recording: the log is still useful.
async function notify(notifier: WebhookNotifier, payload: Pick<NotificationPayload, "event" | "status" | "test">): Promise<NotificationOutcome> {
  if (notifier.state === "missing") return { status: "skipped", reason: "no webhook configured (PI_EVENTS_WEBHOOK_URL)." };
  try {
    const { httpStatus } = await notifier.send({ plugin: PLUGIN_ID, ...payload, sentAt: new Date().toISOString() });
    return { status: "sent", httpStatus };
  } catch (error) {
    return { status: "failed", error: error instanceof WebhookError ? error.message : "The notification webhook failed." };
  }
}

async function result(run: () => Promise<{ data: unknown; text: string }>): Promise<CallToolResult> {
  try {
    const { data, text } = await run();
    return { content: [{ type: "text", text }], structuredContent: data as Record<string, unknown> };
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}
