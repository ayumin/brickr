import { describe, expect, it, vi } from "vitest";
import { EventHub, type EventListener } from "./event-hub.js";
import type { InternalSseEvent } from "./public-events.js";

function activity(roomId: string): InternalSseEvent {
  return {
    type: "response.started",
    roomId,
    activityId: "activity-1",
    targetPostId: "post-1",
    threadRootId: "post-1",
  };
}

/** Convenience: subscribe with a no-op onClose unless the test cares about it. */
function sub(
  hub: EventHub,
  roomId: string,
  listener: EventListener = vi.fn(),
  onClose: () => void = vi.fn(),
  subscriberId?: string,
) {
  return hub.subscribe(roomId, listener, onClose, subscriberId);
}

describe("EventHub (§11.4)", () => {
  /** One publish, both surfaces: the room and the unified feed cannot disagree. */
  it("delivers one event to the room and to the feed", () => {
    const hub = new EventHub();
    const room = vi.fn();
    const feed = vi.fn();
    sub(hub, "room-1", room);
    hub.subscribeAll(feed);

    hub.publish("room-1", activity("room-1"));

    expect(room).toHaveBeenCalledTimes(1);
    expect(feed).toHaveBeenCalledTimes(1);
    const roomEvent = room.mock.calls[0]?.[0];
    const feedEvent = feed.mock.calls[0]?.[0];
    expect(roomEvent).toBe(feedEvent);
    expect(roomEvent?.eventId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(Number.isNaN(Date.parse(roomEvent?.timestamp ?? ""))).toBe(false);
  });

  it("keeps one room's events out of another room's stream", () => {
    const hub = new EventHub();
    const other = vi.fn();
    const feed = vi.fn();
    sub(hub, "room-2", other);
    hub.subscribeAll(feed);

    hub.publish("room-1", activity("room-1"));

    expect(other).not.toHaveBeenCalled();
    // The feed spans every room, so it still sees it.
    expect(feed).toHaveBeenCalledTimes(1);
  });

  it("stops delivering after unsubscribe, and forgets empty rooms", () => {
    const hub = new EventHub();
    const room = vi.fn();
    const feed = vi.fn();
    const { unsubscribe: unsubscribeRoom } = sub(hub, "room-1", room);
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
    sub(hub, "room-1", broken);
    sub(hub, "room-1", healthy);

    hub.publish("room-1", activity("room-1"));
    hub.publish("room-1", activity("room-1"));

    expect(broken).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(2);
  });

  it("counts room and feed subscribers separately", () => {
    const hub = new EventHub();
    sub(hub, "room-1", vi.fn());
    sub(hub, "room-1", vi.fn());
    hub.subscribeAll(vi.fn());

    expect(hub.subscriberCount("room-1")).toBe(2);
    expect(hub.feedSubscriberCount()).toBe(1);
  });

  it("returns a unique connectionId for each subscription", () => {
    const hub = new EventHub();
    const { connectionId: id1 } = sub(hub, "room-1", vi.fn());
    const { connectionId: id2 } = sub(hub, "room-1", vi.fn());

    expect(id1).toMatch(/^[0-9a-f-]{36}$/u);
    expect(id2).toMatch(/^[0-9a-f-]{36}$/u);
    expect(id1).not.toBe(id2);
  });

  describe("hasSubscribers", () => {
    it("is false when nothing is listening", () => {
      const hub = new EventHub();

      expect(hub.hasSubscribers("room-1")).toBe(false);
    });

    it("is true for the room being listened to, and false for the others", () => {
      const hub = new EventHub();
      sub(hub, "room-1", vi.fn());

      expect(hub.hasSubscribers("room-1")).toBe(true);
      expect(hub.hasSubscribers("room-2")).toBe(false);
    });

    /** The feed spans every room, so one feed listener covers every room. */
    it("is true for every room while the feed is listening", () => {
      const hub = new EventHub();
      hub.subscribeAll(vi.fn());

      expect(hub.hasSubscribers("room-1")).toBe(true);
      expect(hub.hasSubscribers("room-2")).toBe(true);
    });

    it("is false again after the last listener unsubscribes", () => {
      const hub = new EventHub();
      const { unsubscribe: unsubscribeRoom } = sub(hub, "room-1", vi.fn());
      const unsubscribeFeed = hub.subscribeAll(vi.fn());

      unsubscribeRoom();
      expect(hub.hasSubscribers("room-1")).toBe(true);

      unsubscribeFeed();
      expect(hub.hasSubscribers("room-1")).toBe(false);
    });
  });

  describe("closeRoom (§11.1 visibility re-evaluation)", () => {
    /**
     * When a room is archived, every open stream for that room must be
     * terminated so clients reconnect and receive a 404 (§10.4).
     */
    it("calls onClose for every connection in the room", () => {
      const hub = new EventHub();
      const onClose1 = vi.fn();
      const onClose2 = vi.fn();
      sub(hub, "room-1", vi.fn(), onClose1);
      sub(hub, "room-1", vi.fn(), onClose2);

      hub.closeRoom("room-1");

      expect(onClose1).toHaveBeenCalledTimes(1);
      expect(onClose2).toHaveBeenCalledTimes(1);
    });

    it("removes all connections for the room after closing", () => {
      const hub = new EventHub();
      sub(hub, "room-1", vi.fn());
      sub(hub, "room-1", vi.fn());

      hub.closeRoom("room-1");

      expect(hub.subscriberCount("room-1")).toBe(0);
    });

    it("does not affect other rooms", () => {
      const hub = new EventHub();
      const onClose2 = vi.fn();
      sub(hub, "room-1", vi.fn());
      sub(hub, "room-2", vi.fn(), onClose2);

      hub.closeRoom("room-1");

      expect(hub.subscriberCount("room-2")).toBe(1);
      expect(onClose2).not.toHaveBeenCalled();
    });

    it("does not affect the feed stream", () => {
      const hub = new EventHub();
      const feedListener = vi.fn();
      sub(hub, "room-1", vi.fn());
      hub.subscribeAll(feedListener);

      hub.closeRoom("room-1");

      expect(hub.feedSubscriberCount()).toBe(1);
    });

    it("is a no-op for a room with no subscribers", () => {
      const hub = new EventHub();

      // Must not throw.
      expect(() => hub.closeRoom("nonexistent")).not.toThrow();
    });

    it("continues closing other connections when one onClose throws", () => {
      const hub = new EventHub();
      const broken = vi.fn(() => {
        throw new Error("close failed");
      });
      const healthy = vi.fn();
      sub(hub, "room-1", vi.fn(), broken);
      sub(hub, "room-1", vi.fn(), healthy);

      hub.closeRoom("room-1");

      expect(broken).toHaveBeenCalledTimes(1);
      expect(healthy).toHaveBeenCalledTimes(1);
    });
  });

  describe("closeSubscriber (§11.1 membership revocation)", () => {
    /**
     * When a member's access is revoked, all of their connections are terminated
     * while other subscribers in the same room keep receiving events.
     */
    it("calls onClose for the subscriber", () => {
      const hub = new EventHub();
      const onClose = vi.fn();
      sub(hub, "room-1", vi.fn(), onClose, "user-1");

      hub.closeSubscriber("room-1", "user-1");

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("removes every connection for the subscriber, including multiple tabs", () => {
      const hub = new EventHub();
      const onClose1 = vi.fn();
      const onClose2 = vi.fn();
      sub(hub, "room-1", vi.fn(), onClose1, "user-1");
      sub(hub, "room-1", vi.fn(), onClose2, "user-1");
      sub(hub, "room-1", vi.fn(), vi.fn(), "user-2");

      hub.closeSubscriber("room-1", "user-1");

      expect(hub.subscriberCount("room-1")).toBe(1);
      expect(onClose1).toHaveBeenCalledTimes(1);
      expect(onClose2).toHaveBeenCalledTimes(1);
    });

    it("does not call onClose for other subscribers in the same room", () => {
      const hub = new EventHub();
      const onCloseOther = vi.fn();
      sub(hub, "room-1", vi.fn(), vi.fn(), "user-1");
      sub(hub, "room-1", vi.fn(), onCloseOther, "user-2");

      hub.closeSubscriber("room-1", "user-1");

      expect(onCloseOther).not.toHaveBeenCalled();
    });

    it("is a no-op for an unknown subscriber", () => {
      const hub = new EventHub();
      sub(hub, "room-1", vi.fn(), vi.fn(), "user-1");

      expect(() => hub.closeSubscriber("room-1", "unknown-user")).not.toThrow();
      expect(hub.subscriberCount("room-1")).toBe(1);
    });

    it("is a no-op for an unknown room", () => {
      const hub = new EventHub();

      expect(() => hub.closeSubscriber("nonexistent", "user-1")).not.toThrow();
    });

    it("continues closing the subscriber's other connections when one onClose throws", () => {
      const hub = new EventHub();
      const broken = vi.fn(() => {
        throw new Error("close failed");
      });
      const healthy = vi.fn();
      sub(hub, "room-1", vi.fn(), broken, "user-1");
      sub(hub, "room-1", vi.fn(), healthy, "user-1");

      hub.closeSubscriber("room-1", "user-1");

      expect(broken).toHaveBeenCalledTimes(1);
      expect(healthy).toHaveBeenCalledTimes(1);
      expect(hub.subscriberCount("room-1")).toBe(0);
    });
  });
});
