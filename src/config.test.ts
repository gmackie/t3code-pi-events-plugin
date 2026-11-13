import { expect, it } from "bun:test";

import { loadConfig } from "./config.ts";

it("reads the webhook and defaults the shared log to the XDG state dir", () => {
  expect(loadConfig({ XDG_STATE_HOME: "/state", PI_EVENTS_WEBHOOK_URL: "  " })).toEqual({ statePath: "/state/t3code-pi-events-plugin/events.sqlite" });
  expect(loadConfig({ PI_EVENTS_WEBHOOK_URL: " https://hooks.test/x ", PI_EVENTS_STATE_PATH: "/tmp/e.sqlite" })).toEqual({
    webhookUrl: "https://hooks.test/x",
    statePath: "/tmp/e.sqlite",
  });
});
