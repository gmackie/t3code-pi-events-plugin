// Pure HTML renderer shared by the ui:// view (bundled into the browser) and
// the tests. All dynamic text goes through esc().
import type { LifecycleEvent, StatusContribution } from "../events.ts";
import type { RecordedEvent } from "../store.ts";
import type { WebhookState } from "../webhook.ts";

export type EventView = RecordedEvent & { status: StatusContribution };

export type StatusData = {
  threadId?: string;
  current?: StatusContribution & { type: LifecycleEvent["type"]; sequence: number; recordedAt: string };
  events: readonly EventView[];
  webhook: WebhookState;
  refreshedAt: string;
};

export type StatusViewState = { busy?: boolean; notice?: string; error?: string };

export function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const time = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "");

const pill = (label: string, tone: string) => `<span class="pill pill-${esc(tone)}">${esc(label)}</span>`;

const webhookLabel: Record<WebhookState, [string, string]> = {
  configured: ["Webhook configured", "positive"],
  missing: ["No webhook", "neutral"],
  invalid: ["Webhook URL invalid", "negative"],
};

export function renderStatus(data: StatusData, state: StatusViewState = {}): string {
  const current = data.current
    ? `<div class="current">${pill(data.current.label, data.current.tone)}${data.current.detail ? `<span class="mono">${esc(data.current.detail)}</span>` : ""}<span class="muted">#${esc(data.current.sequence)} · ${esc(time(data.current.recordedAt))}</span></div>`
    : `<p class="empty">No lifecycle events recorded${data.threadId ? " for this thread" : ""} yet. Agents report them with pi_events_record.</p>`;
  const rows = data.events
    .map(
      (event) => `<li class="row">
  <div class="row-main">
    <div class="row-title">${esc(event.status.label)}</div>
    <div class="row-meta">${pill(event.type, event.status.tone)}<span class="mono">#${esc(event.sequence)}</span>${event.threadId && event.threadId !== data.threadId ? `<span class="mono">${esc(event.threadId)}</span>` : ""}<span>${esc(time(event.recordedAt))}</span></div>
    ${event.status.detail ? `<div class="row-detail">${esc(event.status.detail)}</div>` : ""}
  </div>
</li>`,
    )
    .join("\n");
  const [webhookText, webhookTone] = webhookLabel[data.webhook];
  const disabled = state.busy || data.webhook !== "configured" ? "disabled" : "";
  return `<header>
  <h1>Lifecycle status</h1>
  <div class="header-meta"><span>Refreshed ${esc(time(data.refreshedAt))}</span><button type="button" data-action="refresh">Refresh</button></div>
</header>
${current}
${state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ""}${state.notice ? `<p class="notice" role="status">${esc(state.notice)}</p>` : ""}
<section aria-label="Events"><h2>${data.threadId ? "This thread" : "Recent events"} <span class="count">${data.events.length}</span></h2><ul>${rows}</ul></section>
<section aria-label="Notifications"><h2>Notifications</h2><div class="actions">${pill(webhookText, webhookTone)}<button type="button" data-action="send-test" ${disabled}>Send test notification</button></div>${data.webhook === "configured" ? "" : `<p class="row-detail">Set PI_EVENTS_WEBHOOK_URL on the pi-events server in Settings → Tools.</p>`}</section>`;
}

export const STYLES = `
:root { color-scheme: light dark; --fg: #1f2328; --muted: #656d76; --bg: transparent; --line: #d0d7de; --accent: #0969da; --pos: #1a7f37; --neg: #cf222e; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
:root[data-theme="dark"] { --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --accent: #4493f8; --pos: #3fb950; --neg: #f85149; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --accent: #4493f8; --pos: #3fb950; --neg: #f85149; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 12px; color: var(--fg); background: var(--bg); }
header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; }
h1 { font-size: 15px; margin: 0; } h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 16px 0 6px; }
.header-meta { display: flex; gap: 8px; align-items: center; color: var(--muted); }
ul { list-style: none; margin: 0; padding: 0; }
.current { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
.row { display: flex; gap: 8px; align-items: center; padding: 8px 0; border-top: 1px solid var(--line); }
.row-main { flex: 1; min-width: 0; } .row-title { font-weight: 500; overflow-wrap: anywhere; }
.row-meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; color: var(--muted); font-size: 12px; margin-top: 2px; }
.row-detail, .muted { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; } .row-detail { margin-top: 2px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; overflow-wrap: anywhere; }
.count { font-weight: 400; } .empty { color: var(--muted); margin: 10px 0 0; }
.pill { border: 1px solid currentColor; border-radius: 999px; padding: 0 7px; font-size: 11px; line-height: 17px; white-space: nowrap; }
.pill-positive { color: var(--pos); } .pill-negative { color: var(--neg); } .pill-neutral { color: var(--muted); }
button { font: inherit; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 3px 10px; cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--accent); } button:disabled { opacity: .5; cursor: default; }
.actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.error { color: var(--neg); } .notice { color: var(--pos); }
`;
