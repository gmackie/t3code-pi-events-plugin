import { describe, expect, it } from "bun:test";

import { statusForEvent } from "../events.ts";
import { renderStatus, type StatusData } from "./render.ts";

const event = { type: "runtime.error" as const, sequence: 3, threadId: "t1", message: "<script>alert(1)</script>", recordedAt: "2026-11-13T10:00:00.000Z" };
const data: StatusData = {
  threadId: "t1",
  current: { ...statusForEvent(event), type: event.type, sequence: 3, recordedAt: event.recordedAt },
  events: [{ ...event, status: statusForEvent(event) }],
  webhook: "configured",
  refreshedAt: "2026-11-13T10:00:01.000Z",
};

describe("status view renderer", () => {
  it("escapes event content and shows the current status", () => {
    const html = renderStatus(data);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('pill-negative">Runtime error');
    expect(html).toContain("This thread");
    expect(html).toContain('data-action="send-test" >');
  });

  it("disables the test button without a usable webhook and explains why", () => {
    const html = renderStatus({ ...data, webhook: "missing" });
    expect(html).toContain('data-action="send-test" disabled');
    expect(html).toContain("PI_EVENTS_WEBHOOK_URL");
    expect(renderStatus({ ...data, webhook: "invalid" })).toContain("Webhook URL invalid");
  });

  it("shows an empty log honestly, plus errors and notices", () => {
    const empty = renderStatus({ events: [], webhook: "configured", refreshedAt: data.refreshedAt }, { error: "Webhook <down>" });
    expect(empty).toContain("No lifecycle events recorded yet.");
    expect(empty).toContain('role="alert">Webhook &lt;down&gt;');
    expect(renderStatus(data, { notice: "Delivered" })).toContain('role="status">Delivered');
  });
});
