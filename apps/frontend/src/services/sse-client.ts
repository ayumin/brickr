/**
 * Thin, React-free wrapper around EventSource.
 *
 * The backend sends one named SSE event per DTO `type` (CLAUDE.md §44).
 * EventSource reconnects on its own, so we never hand-roll retries — we only
 * report the connection state upwards so the UI can say 「再接続中」.
 */
import { SSE_EVENT_TYPES } from "@brickr/shared";
import type { SseEvent, SseEventType } from "@brickr/shared";

import { feedEventsUrl, roomEventsUrl } from "./api-client";

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
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.eventId !== "string" ||
    (typeof record.roomId !== "string" && record.roomId !== null) ||
    typeof record.timestamp !== "string"
  ) {
    return null;
  }
  // Single boundary cast: the SSE event name is authoritative for the union tag,
  // so we normalise `type` from it instead of trusting the payload.
  return {
    ...record,
    type,
  } as unknown as SseEvent;
}

function subscribe(url: string, handlers: SseHandlers): SseSubscription {
  // The events endpoint authenticates with the same session cookie
  // (CLAUDE.md §66.11); EventSource does not send cookies cross-origin
  // (:5173 vs :3000 in dev) unless explicitly told to.
  const source = new EventSource(url, { withCredentials: true });

  const onOpen = (): void => {
    handlers.onOpen?.();
  };
  const onError = (): void => {
    handlers.onError?.();
  };

  source.addEventListener("open", onOpen);
  source.addEventListener("error", onError);

  const registered: Array<[SseEventType, EventListener]> = [];
  const recentEventIds = new Set<string>();
  const recentEventIdOrder: string[] = [];

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
        if (recentEventIds.has(event.eventId)) return;
        recentEventIds.add(event.eventId);
        recentEventIdOrder.push(event.eventId);
        if (recentEventIdOrder.length > 256) {
          const oldest = recentEventIdOrder.shift();
          if (oldest !== undefined) recentEventIds.delete(oldest);
        }
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

export function subscribeToRoomEvents(
  roomId: string,
  handlers: SseHandlers,
): SseSubscription {
  return subscribe(roomEventsUrl(roomId), handlers);
}

/** Subscribes to the unified feed's stream — every room's public events, anonymised (§11.2). */
export function subscribeToFeedEvents(handlers: SseHandlers): SseSubscription {
  return subscribe(feedEventsUrl(), handlers);
}
