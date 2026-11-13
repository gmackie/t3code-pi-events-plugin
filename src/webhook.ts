import type { StatusContribution } from "./events.ts";
import type { RecordedEvent } from "./store.ts";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export const PLUGIN_ID = "com.t3code.pi-events";

export type NotificationPayload = {
  plugin: typeof PLUGIN_ID;
  test: boolean;
  event?: RecordedEvent;
  status: StatusContribution;
  sentAt: string;
};

export type NotificationOutcome =
  | { status: "sent"; httpStatus: number }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export const WEBHOOK_NOT_CONFIGURED = "No notification webhook is configured. Set PI_EVENTS_WEBHOOK_URL on the pi-events server in Settings → Tools.";

export type WebhookState = "configured" | "missing" | "invalid";

export class WebhookError extends Error {}

// Posts one JSON notification. Errors never carry the webhook URL or the
// response body: webhook URLs often embed a secret (Slack, Discord, ...).
export function createWebhookNotifier(options: { url?: string; fetch?: Fetch; timeoutMs?: number }) {
  const doFetch: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 15_000;
  const target = parseUrl(options.url);

  return {
    state: (!options.url ? "missing" : target ? "configured" : "invalid") as WebhookState,
    async send(payload: NotificationPayload): Promise<{ httpStatus: number }> {
      if (!options.url) throw new WebhookError(WEBHOOK_NOT_CONFIGURED);
      if (!target) throw new WebhookError("PI_EVENTS_WEBHOOK_URL must be an http(s) URL.");
      let response: Response;
      try {
        response = await doFetch(target, {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { "content-type": "application/json", "user-agent": "t3code-pi-events-plugin" },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new WebhookError(timedOut ? `The notification webhook did not answer within ${Math.round(timeoutMs / 1000) || 1}s.` : "The notification webhook could not be reached.");
      }
      await response.body?.cancel().catch(() => undefined);
      if (response.status >= 500) throw new WebhookError(`The notification webhook is temporarily unavailable (${response.status}).`);
      if (!response.ok) throw new WebhookError(`The notification webhook rejected the notification (${response.status}).`);
      return { httpStatus: response.status };
    },
  };
}

export type WebhookNotifier = ReturnType<typeof createWebhookNotifier>;

function parseUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
