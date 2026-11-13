# T3 Code lifecycle events plugin

This sample is based on upstream issue #5020's Pi-style extension proposal. It keeps an observe-only log of agent lifecycle events (`server.ready`, `session.started`, `turn.settled`, `runtime.error`), shows the current status in a thread panel, and posts each event to an optional webhook. It never mutates T3 orchestration state.

Since 0.2.0 the plugin is an MCP server (`src/mcp.ts`, stdio) described by a v2 manifest (`t3-plugin.json`). T3 builds that only load v1 manifests cannot load this version.

## MCP server

It's a stdio server on the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server`). The view is an MCP App: a `ui://` HTML resource with the `text/html;profile=mcp-app` MIME type.

- `pi_events_status` returns the current status and recent events, optionally for one thread, and renders `ui://pi-events/status.html`.
- `pi_events_record` records a lifecycle event in the shared log and notifies the webhook. T3 no longer pushes lifecycle hooks to plugins, so agents report events through this tool. The log numbers events itself; pass an optional `dedupeKey` (unique per event within its thread) to make a retry a no-op.
- `pi_events_send_test` sends a test notification and reports whether it was delivered.

The `pi-events-status` panel is thread-scoped. It follows `hostContext.t3.threadId` and refreshes every 30 seconds while visible. The command **Pi events: Open lifecycle status** opens it, and its **Send test notification** button replaces the v1 command.

### Configuration

| Env var | Old setting | Notes |
|---|---|---|
| `PI_EVENTS_WEBHOOK_URL` | `pi-events.webhook` | optional, secret. An http(s) URL that receives a JSON POST per event. |
| `PI_EVENTS_STATE_PATH` | (new) | SQLite event log, default `$XDG_STATE_HOME/t3code-pi-events-plugin/events.sqlite`. Every plugin process shares it. |

Webhook body:

```json
{ "plugin": "com.t3code.pi-events", "test": false, "event": { "type": "turn.settled", "sequence": 4, "threadId": "…", "runId": "…", "recordedAt": "…" }, "status": { "label": "Turn complete", "tone": "positive", "detail": "…" }, "sentAt": "…" }
```

### Run it

```sh
bun install
bun test          # domain, store, MCP client, AppBridge interop, view and stdio install tests
bun run typecheck
bun run inspect   # the official MCP Inspector (Apps tab)
```

Install this directory through T3's plugin installer after running `bun install --frozen-lockfile`, then set the webhook on the `pi-events` server in Settings → Tools.

See `docs/manifest-v2.md` for the v1 → v2 mapping and what changed for lifecycle hooks.
