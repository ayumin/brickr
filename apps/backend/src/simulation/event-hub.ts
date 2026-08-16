import { randomUUID } from "node:crypto";
import type { InternalSseEvent, PublishedInternalSseEvent } from "./public-events.js";

export type EventListener = (event: PublishedInternalSseEvent) => void;

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
 */
export class EventHub {
  private readonly bySimulation = new Map<string, Set<EventListener>>();
  private readonly global = new Set<EventListener>();

  /** One room's stream. */
  subscribe(simulationId: string, listener: EventListener): () => void {
    let set = this.bySimulation.get(simulationId);
    if (!set) {
      set = new Set();
      this.bySimulation.set(simulationId, set);
    }
    set.add(listener);

    return () => {
      const current = this.bySimulation.get(simulationId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.bySimulation.delete(simulationId);
    };
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
    this.deliver(this.bySimulation.get(simulationId), published);
    this.deliver(this.global, published);
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
