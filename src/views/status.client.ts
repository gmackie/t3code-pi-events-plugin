import { createViewBridge, toolData, type HostContext } from "./bridge.ts";
import { esc, renderStatus, type StatusData, type StatusViewState } from "./render.ts";

// Polls the shared event log; agents append to it from their own plugin copies.
const POLL_SECONDS = 30;

const root = document.getElementById("app")!;
const bridge = createViewBridge(window as never, { name: "pi-events-status", version: "0.2.0" });
let context: HostContext = {};
let data: StatusData | undefined;
let args: Record<string, unknown> = {};
let state: StatusViewState = {};
let timer: ReturnType<typeof setTimeout> | undefined;

function draw() {
  if (data) root.innerHTML = renderStatus(data, state);
  else if (state.error) root.innerHTML = `<p class="error" role="alert">${esc(state.error)}</p>`;
}

// A thread panel follows the active thread from host context; an inline tool
// result keeps the arguments the agent called it with.
function statusArgs(): Record<string, unknown> {
  const threadId = context.t3?.threadId;
  return threadId ? { ...args, threadId } : args;
}

async function refresh() {
  clearTimeout(timer);
  if (document.visibilityState === "hidden") {
    timer = setTimeout(() => void refresh(), 5000);
    return;
  }
  try {
    data = toolData<StatusData>(await bridge.callTool("pi_events_status", statusArgs()));
    state = { ...state, error: undefined };
  } catch (cause) {
    state = { ...state, error: `Refresh failed: ${cause instanceof Error ? cause.message : cause}` };
  }
  draw();
  timer = setTimeout(() => void refresh(), POLL_SECONDS * 1000);
}

async function sendTest() {
  state = { busy: true };
  draw();
  try {
    const result = toolData<{ httpStatus: number }>(await bridge.callTool("pi_events_send_test"));
    state = { notice: `Test notification delivered (HTTP ${result.httpStatus}).` };
  } catch (cause) {
    state = { error: cause instanceof Error ? cause.message : String(cause) };
  }
  draw();
}

root.addEventListener("click", (event) => {
  const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
  if (action === "refresh") void refresh();
  if (action === "send-test") void sendTest();
});

bridge.onHostContext = (update) => {
  const previous = context.t3?.threadId;
  // host-context-changed may carry only the changed fields, so merge them.
  context = { ...context, ...update };
  if (context.theme) document.documentElement.dataset.theme = context.theme;
  if (data && context.t3?.threadId !== previous) void refresh();
};
bridge.onToolInput = (input) => {
  args = input;
};
bridge.onToolResult = (result) => {
  try {
    data = toolData<StatusData>(result);
  } catch (cause) {
    state = { error: cause instanceof Error ? cause.message : String(cause) };
  }
  draw();
  clearTimeout(timer);
  timer = setTimeout(() => void refresh(), POLL_SECONDS * 1000);
};
new ResizeObserver(() => bridge.sendSize(document.documentElement.scrollWidth, document.documentElement.scrollHeight)).observe(document.body);
// Inline after a tool call the host delivers the result; an opened panel only
// loads the resource, so fetch if nothing arrives.
void bridge.connect().then(() => setTimeout(() => void (data ? undefined : refresh()), 250));
