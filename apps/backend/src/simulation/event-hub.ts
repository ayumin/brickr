import type { SseEvent } from "@brickr/shared";

export type EventListener = (event: SseEvent) => void;

/**
 * In-process pub/sub for SSE, keyed by simulation id.
 *
 * A plain Map is enough: a single backend process serves the MVP. Nothing here
 * needs Redis or a message broker.
 */
export class EventHub {
  private readonly listeners = new Map<string, Set<EventListener>>();

  subscribe(simulationId: string, listener: EventListener): () => void {
    let set = this.listeners.get(simulationId);
    if (!set) {
      set = new Set();
      this.listeners.set(simulationId, set);
    }
    set.add(listener);

    return () => {
      const current = this.listeners.get(simulationId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(simulationId);
    };
  }

  publish(event: SseEvent): void {
    const set = this.listeners.get(event.simulationId);
    if (!set) return;
    for (const listener of [...set]) {
      // One broken subscriber must not stop delivery to the others.
      try {
        listener(event);
      } catch {
        set.delete(listener);
      }
    }
  }

  subscriberCount(simulationId: string): number {
    return this.listeners.get(simulationId)?.size ?? 0;
  }
}
