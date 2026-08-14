import { describe, expect, it, vi } from "vitest";
import { EventHub } from "./event-hub.js";
import type { InternalSseEvent } from "./public-events.js";

function activity(simulationId: string): InternalSseEvent {
  return {
    type: "response.started",
    simulationId,
    activityId: "activity-1",
    targetPostId: "post-1",
    threadRootId: "post-1",
  };
}

describe("EventHub (§11.4)", () => {
  /** One publish, both surfaces: the room and the unified feed cannot disagree. */
  it("delivers one event to the room and to the feed", () => {
    const hub = new EventHub();
    const room = vi.fn();
    const feed = vi.fn();
    hub.subscribe("room-1", room);
    hub.subscribeAll(feed);

    hub.publish("room-1", activity("room-1"));

    expect(room).toHaveBeenCalledTimes(1);
    expect(feed).toHaveBeenCalledTimes(1);
  });

  it("keeps one room's events out of another room's stream", () => {
    const hub = new EventHub();
    const other = vi.fn();
    const feed = vi.fn();
    hub.subscribe("room-2", other);
    hub.subscribeAll(feed);

    hub.publish("room-1", activity("room-1"));

    expect(other).not.toHaveBeenCalled();
    // The feed spans every simulation, so it still sees it.
    expect(feed).toHaveBeenCalledTimes(1);
  });

  it("stops delivering after unsubscribe, and forgets empty rooms", () => {
    const hub = new EventHub();
    const room = vi.fn();
    const feed = vi.fn();
    const unsubscribeRoom = hub.subscribe("room-1", room);
    const unsubscribeFeed = hub.subscribeAll(feed);

    unsubscribeRoom();
    unsubscribeFeed();
    hub.publish("room-1", activity("room-1"));

    expect(room).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
    expect(hub.subscriberCount("room-1")).toBe(0);
    expect(hub.feedSubscriberCount()).toBe(0);
  });

  /** A dead connection must not take the rest of the subscribers down with it. */
  it("drops a listener that throws and keeps serving the others", () => {
    const hub = new EventHub();
    const broken = vi.fn(() => {
      throw new Error("socket closed");
    });
    const healthy = vi.fn();
    hub.subscribe("room-1", broken);
    hub.subscribe("room-1", healthy);

    hub.publish("room-1", activity("room-1"));
    hub.publish("room-1", activity("room-1"));

    expect(broken).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(2);
  });

  it("counts room and feed subscribers separately", () => {
    const hub = new EventHub();
    hub.subscribe("room-1", vi.fn());
    hub.subscribe("room-1", vi.fn());
    hub.subscribeAll(vi.fn());

    expect(hub.subscriberCount("room-1")).toBe(2);
    expect(hub.feedSubscriberCount()).toBe(1);
  });
});
