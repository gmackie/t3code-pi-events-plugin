# pi-events manifest v2 (T3CODE-75)

`t3-plugin.json` follows the MCP-native plugin design from T3CODE-74, as piloted by the Bob plugin. T3 loads it into its server-owned MCP registry.

## Shape

- `mcpServer` reuses `McpServerConfig` and `McpServerVariable` from Settings → Tools (`packages/contracts/src/agentTools.ts`):
  - `name`: `pi-events`.
  - `transport`: stdio, `bun ${pluginRoot}/src/mcp.ts`, with `env` as `McpServerVariable[]`.
  - `PI_EVENTS_WEBHOOK_URL` is `sensitive`: webhook URLs usually embed their secret.
- `contributes.panels[]` has one panel, `pi-events-status` (`scope: thread`), rendering `ui://pi-events/status.html`. With `hostContext.t3.threadId` it shows that thread's events plus environment-wide ones, and it refreshes on `host-context-changed`.
- `contributes.commands[]` has `pi-events-open-status`, which opens that panel.
- `t3Tools` is `[]` (see below).

## v1 → v2 mapping

The v1 manifest's last version is on `master` before this change.

| v1 | v2 |
|---|---|
| `runtime` (managed-app, `bun src/stdio.ts`, stub `surface.get`/`panel.get`/`workflow.get`/`action.execute`) | `mcpServer.transport` (stdio, `bun ${pluginRoot}/src/mcp.ts`). The stub RPC is removed. |
| `panels[pi-events.status]` (`thread.sidePanel`) | `panels[pi-events-status]`, `scope: thread`, view `ui://pi-events/status.html`, data from tool `pi_events_status` |
| `commands[pi-events.test]` "Send test notification" | v2 commands only open panels, so the command became `pi-events-open-status`. The panel's **Send test notification** button calls tool `pi_events_send_test`, which agents can call too. |
| `settings[pi-events.webhook]`, `settingsPanels[pi-events.settings]` | `mcpServer.transport.env[PI_EVENTS_WEBHOOK_URL]` (`sensitive`) |
| `hooks` (`server.ready`, `session.started`, `turn.settled`, `runtime.error`) | **Removed by v2.** Closest equivalent: tool `pi_events_record`, which an agent calls to report the same four event types. See "What changed for lifecycle events". |
| `capabilities.events.read` | Dropped with hooks. No T3 MCP tool exposes the lifecycle event stream, so there is nothing within the old grant to list in `t3Tools`. |
| `capabilities.ui.embed` | Implied by `panels` |
| `capabilities.network.connect` (`hosts: []`) | Dropped: the server process posts to the webhook itself. v1 granted no hosts, so the webhook could never actually be called there; v2 delivers it. |
| (new) | `PI_EVENTS_STATE_PATH`: the shared event log file |

## What changed for lifecycle events

v1 asked T3 to push four lifecycle hooks into the plugin. v2 has no hooks and T3 has no MCP tool that reads them, so the plugin cannot observe them by itself any more. Instead:

- `pi_events_record` (`type`, optional `threadId`, `runId`, `message`, `sequence`) appends an event to the shared log and POSTs it to the webhook. Its server `instructions` ask agents to report `session.started`, `turn.settled` and `runtime.error`.
- The optional `sequence` keeps v1's ordering guarantee (`OrderedEventBuffer`): an event at or below the last recorded sequence is ignored and not notified, so a retried delivery is safe.
- `server.ready` is no longer emitted automatically. Anything can still report it.

This is weaker than v1: the log only holds what agents report. Status in the panel is therefore "last reported", never inferred.

## Server rules

- **Visibility.**
  - `pi_events_status` is `["model", "app"]` and links the view with `_meta.ui.resourceUri`.
  - `pi_events_send_test` is `["model", "app"]`: the panel button calls it, and it is harmless for an agent to check delivery.
  - `pi_events_record` has no UI and is for agents.
- **No T3 token needed.** Only the pool copy would get `T3_MCP_URL`/`T3_MCP_TOKEN`, and the plugin never calls T3.
- **Stateless processes.** T3 runs one stdio copy per agent session plus one in its pool. Agents record in their copies, and the panel reads through the pool's copy, so events live in one SQLite file (WAL, `busy_timeout`, `BEGIN IMMEDIATE` per append) at `PI_EVENTS_STATE_PATH`, default `$XDG_STATE_HOME/t3code-pi-events-plugin/events.sqlite`. It keeps the latest 200 events. `server.test.ts` covers two copies sharing one file.
- **Network.** Webhook calls time out after 15s. Errors say only "unreachable", "timed out", "temporarily unavailable (5xx)" or "rejected (4xx)", and never include the URL or the response body.

## Open questions

1. **Lifecycle hooks.** If T3 later exposes lifecycle events as a T3 MCP tool or resource subscription, `pi_events_record` should become a fallback and the plugin should read events through `t3Tools` (bounded by the old `events.read` grant).
2. **Shared state file.** Like Bob, this depends on every copy seeing the same `HOME`/`XDG_STATE_HOME`, or the same `PI_EVENTS_STATE_PATH`.
