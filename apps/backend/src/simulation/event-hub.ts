import { randomUUID } from "node:crypto";
import type { InternalSseEvent, PublishedInternalSseEvent } from "./public-events.js";

export type EventListener = (event: PublishedInternalSseEvent) => void;

/**
 * A registered room-scoped connection: the event listener paired with a callback
 * that the EventHub calls to terminate the stream from the server side.
 *
 * `onClose` is invoked by `closeRoom` (room archived) and `closeSubscriber`
 * (membership revoked). The route handler uses it to end the HTTP response.
 */
type RoomConnection = {
  listener: EventListener;
  onClose: () => void;
  /** Authenticated user that owns the stream. Omitted only in low-level tests. */
  subscriberId?: string;
};

/**
 * In-process pub/sub for SSE.
 *
 * Two kinds of subscriber, because the app has two streams (§11.1, §11.4): one
 * room's listeners, and the unified feed's, which wants every simulation. A post
 * reaches both from a single `publish`, so the two streams can never disagree
 * about what happened.
 *
 * Events here are internal: they are converted for a subscriber at delivery time,
 * not stored in public shape (see `public-events.ts`).
 *
 * A plain Map is enough while one process serves the app. Nothing here needs
 * Redis or a broker.
 *
 * Visibility re-evaluation (§11.1):
 *   - `closeRoom(roomId)` terminates every open stream for a room when it is
 *     archived. Clients reconnect and receive a 404, which is the correct
 *     response for a stopped room they cannot read (§10.4).
 *   - `closeSubscriber(roomId, subscriberId)` terminates every stream owned by
 *     one member, including multiple tabs, when their access is revoked.
 */
export class EventHub {
  private readonly bySimulation = new Map<string, Map<string, RoomConnection>>();
  private readonly global = new Set<EventListener>();

  /**
   * One room's stream.
   *
   * Returns an unsubscribe function and a unique `connectionId` for diagnostics.
   *
   * `onClose` is called by `closeRoom` or `closeSubscriber` to signal that the
   * route handler should end the HTTP response.
   */
  subscribe(
    simulationId: string,
    listener: EventListener,
    onClose: () => void,
    subscriberId?: string,
  ): { unsubscribe: () => void; connectionId: string } {
    let connections = this.bySimulation.get(simulationId);
    if (!connections) {
      connections = new Map();
      this.bySimulation.set(simulationId, connections);
    }

    const connectionId = randomUUID();
    connections.set(connectionId, {
      listener,
      onClose,
      ...(subscriberId === undefined ? {} : { subscriberId }),
    });

    const unsubscribe = (): void => {
      const current = this.bySimulation.get(simulationId);
      if (!current) return;
      current.delete(connectionId);
      if (current.size === 0) this.bySimulation.delete(simulationId);
    };

    return { unsubscribe, connectionId };
  }

  /** The unified feed's stream: every simulation, including the global row. */
  subscribeAll(listener: EventListener): () => void {
    this.global.add(listener);
    return () => {
      this.global.delete(listener);
    };
  }

  /**
   * The current internal domain still passes its routing key explicitly. Event
   * metadata is assigned once here so room and feed subscribers receive the same
   * identity and timestamp.
   */
  publish(simulationId: string, event: InternalSseEvent): void {
    const published: PublishedInternalSseEvent = {
      ...event,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    this.deliverToRoom(simulationId, published);
    this.deliver(this.global, published);
  }

  /**
   * Terminates every open room-scoped stream for `simulationId`.
   *
   * Called when a room is archived (§11.1). Each connection's `onClose` callback
   * is invoked so the route handler can end the HTTP response. Clients that
   * reconnect receive a 404 — the correct answer for a stopped room (§10.4).
   */
  closeRoom(simulationId: string): void {
    const connections = this.bySimulation.get(simulationId);
    if (!connections) return;

    // Snapshot before iterating: onClose may trigger unsubscribe.
    for (const { onClose } of [...connections.values()]) {
      try {
        onClose();
      } catch {
        // A broken close callback must not prevent the others from running.
      }
    }

    this.bySimulation.delete(simulationId);
  }

  /**
   * Terminates every room-scoped stream owned by one authenticated subscriber.
   *
   * Called when a member's access is revoked while their connection is open
   * (§11.1 visibility re-evaluation). The connection's `onClose` callback is
   * invoked so the route handler can end the HTTP response.
   */
  closeSubscriber(simulationId: string, subscriberId: string): void {
    const connections = this.bySimulation.get(simulationId);
    if (!connections) return;

    const targeted = [...connections].filter(
      ([, connection]) => connection.subscriberId === subscriberId,
    );
    for (const [connectionId] of targeted) {
      connections.delete(connectionId);
    }
    if (connections.size === 0) this.bySimulation.delete(simulationId);

    for (const [, connection] of targeted) {
      try {
        connection.onClose();
      } catch {
        // A broken close callback must not prevent the member's other streams closing.
      }
    }
  }

  subscriberCount(simulationId: string): number {
    return this.bySimulation.get(simulationId)?.size ?? 0;
  }

  feedSubscriberCount(): number {
    return this.global.size;
  }

  /**
   * Whether a `publish` for this room would reach anyone.
   *
   * Lets a caller skip building a payload that `publish` would only discard. The
   * feed's listeners count for every room, so this is false only when neither
   * stream is open.
   */
  hasSubscribers(simulationId: string): boolean {
    return this.subscriberCount(simulationId) > 0 || this.feedSubscriberCount() > 0;
  }

  private deliverToRoom(simulationId: string, event: PublishedInternalSseEvent): void {
    const connections = this.bySimulation.get(simulationId);
    if (!connections) return;
    for (const [connectionId, { listener }] of [...connections]) {
      try {
        listener(event);
      } catch {
        // One broken subscriber must not stop delivery to the others.
        connections.delete(connectionId);
        if (connections.size === 0) {
          this.bySimulation.delete(simulationId);
        }
      }
    }
  }

  private deliver(
    listeners: Set<EventListener> | undefined,
    event: PublishedInternalSseEvent,
  ): void {
    if (!listeners) return;
    for (const listener of [...listeners]) {
      // One broken subscriber must not stop delivery to the others.
      try {
        listener(event);
      } catch {
        listeners.delete(listener);
      }
    }
  }
}
