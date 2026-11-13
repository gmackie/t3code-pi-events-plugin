import { homedir } from "node:os";
import { join } from "node:path";

// The v1 setting `pi-events.webhook` maps onto PI_EVENTS_WEBHOOK_URL, declared
// under mcpServer.transport.env so T3's Tools registry collects and redacts it.
export type PiEventsConfig = {
  readonly webhookUrl?: string;
  readonly statePath: string;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): PiEventsConfig {
  const webhookUrl = env.PI_EVENTS_WEBHOOK_URL?.trim();
  return {
    ...(webhookUrl ? { webhookUrl } : {}),
    statePath: env.PI_EVENTS_STATE_PATH?.trim() || defaultStatePath(env),
  };
}

// T3 does not hand plugins a data directory, so the shared event log defaults
// to the XDG state dir and never to T3's own userdata.
function defaultStatePath(env: Record<string, string | undefined>): string {
  const base = env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state");
  return join(base, "t3code-pi-events-plugin", "events.sqlite");
}
