/**
 * Thin, React-free wrapper around EventSource.
 *
 * The backend sends one named SSE event per DTO `type` (CLAUDE.md §44).
 * EventSource reconnects on its own, so we never hand-roll retries — we only
 * report the connection state upwards so the UI can say 「再接続中」.
 */
import { SSE_EVENT_TYPES } from "@enjo/shared";
import type { SseEvent, SseEventType } from "@enjo/shared";

import { simulationEventsUrl } from "./api-client";

export type SseHandlers = {
  onEvent: (event: SseEvent) => void;
  onOpen?: () => void;
  /** Fired on transport errors. EventSource retries by itself afterwards. */
  onError?: () => void;
};

export type SseSubscription = {
  close: () => void;
};

function parseSseEvent(type: SseEventType, data: string): SseEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  // Single boundary cast: the SSE event name is authoritative for the union tag,
  // so we normalise `type` from it instead of trusting the payload.
  return {
    ...(parsed as Record<string, unknown>),
    type,
  } as unknown as SseEvent;
}

export function subscribeToSimulationEvents(
  simulationId: string,
  handlers: SseHandlers,
): SseSubscription {
  const source = new EventSource(simulationEventsUrl(simulationId));

  const onOpen = (): void => {
    handlers.onOpen?.();
  };
  const onError = (): void => {
    handlers.onError?.();
  };

  source.addEventListener("open", onOpen);
  source.addEventListener("error", onError);

  const registered: Array<[SseEventType, EventListener]> = [];

  for (const type of SSE_EVENT_TYPES) {
    const listener: EventListener = (raw) => {
      if (!(raw instanceof MessageEvent)) {
        return;
      }
      const data: unknown = raw.data;
      if (typeof data !== "string") {
        return;
      }
      const event = parseSseEvent(type, data);
      if (event) {
        handlers.onEvent(event);
      }
    };
    source.addEventListener(type, listener);
    registered.push([type, listener]);
  }

  let closed = false;

  return {
    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      source.removeEventListener("open", onOpen);
      source.removeEventListener("error", onError);
      for (const [type, listener] of registered) {
        source.removeEventListener(type, listener);
      }
      source.close();
    },
  };
}
