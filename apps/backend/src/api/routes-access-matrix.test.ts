import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { UserAccount } from "../auth/user-account.js";
import { CharacterService } from "../characters/character-service.js";
import type { CharacterPersonaGenerator } from "../characters/character-generator.js";
import type { CharacterRepository } from "../characters/character-repository.js";
import type { Character } from "../characters/character.js";
import { FeedService } from "../feed/feed-service.js";
import type { HandleRepository } from "../handles/handle-repository.js";
import type { ModelProfileRepository } from "../model-profiles/model-profile-repository.js";
import type { PostService } from "../posts/post-service.js";
import type { Post } from "../posts/post.js";
import { ProfileService } from "../profiles/profile-service.js";
import type { ProfileRepository } from "../profiles/profile-repository.js";
import type { AppServices } from "../services.js";
import { SimulationService } from "../simulation/simulation-service.js";
import type { SimulationRepository } from "../simulation/simulation-repository.js";
import type { Simulation } from "../simulation/simulation.js";
import type { UserProfileRepository } from "../user-profile/user-profile-repository.js";
import { registerRoutes } from "./routes.js";

/**
 * The access matrix the phase demands (§24.2): one table of actors, run against
 * the real services behind the real routes.
 *
 * Six actors, because every rule in Step 3 distinguishes at least two of them:
 *
 *   anonymous          reads the unified feed and nothing else
 *   normal user        signed in, owns nothing here
 *   room owner         created the room in question
 *   other room owner   created a *different* room - proves ownership is per row
 *   character owner    created the cast member in question
 *   admin              may manage everything
 *
 * Only the repositories are faked, and they hold plain rows: the decisions under
 * test are the services' own, not a re-implementation of them in a stub. Where a
 * rule lives in a `where` clause instead - which rooms exist for a caller (§10.3)
 * - it is asserted in `simulation-repository.test.ts`, and what this file checks
 * is that the service hands the repository the caller it was given.
 */

const ANONYMOUS = null;

function account(id: string, handle: string, isAdmin = false): UserAccount {
  return {
    id,
    handle,
    displayName: handle,
    description: "",
    email: `${handle}@example.com`,
    isAdmin,
    status: "active",
    interests: [],
  };
}

const NORMAL_USER = account("user-normal", "normal");
const ROOM_OWNER = account("user-room-owner", "roomowner");
const OTHER_ROOM_OWNER = account("user-other-owner", "otherowner");
const CHARACTER_OWNER = account("user-cast-owner", "castowner");
const ADMIN = account("user-admin", "admin", true);

const NOW = new Date("2026-08-14T00:00:00.000Z");

function room(id: string, overrides: Partial<Simulation> = {}): Simulation {
  return {
    id,
    title: id,
    status: "active",
    visibility: "public",
    scope: "room",
    tags: [],
    createdAt: NOW,
    lastActivityAt: NOW,
    createdByUserId: ROOM_OWNER.id,
    ...overrides,
  };
}

const ACTIVE_ROOM = room("room-active");
const STOPPED_ROOM = room("room-stopped", { status: "archived" });
const OTHER_ROOM = room("room-other", { createdByUserId: OTHER_ROOM_OWNER.id });

const ROOMS = [ACTIVE_ROOM, STOPPED_ROOM, OTHER_ROOM];

function post(id: string, roomId: string, authorId: string): Post {
  return {
    id,
    roomId,
    authorId,
    content: `post ${id}`,
    mentions: [],
    replyTo: null,
    quoteOf: null,
    threadRootId: id,
    threadActivityAt: NOW,
    createdAt: NOW,
  };
}

const POST_IN_ACTIVE = post("post-active", ACTIVE_ROOM.id, "cast-owned");
const POST_IN_STOPPED = post("post-stopped", STOPPED_ROOM.id, "cast-owned");
const POSTS = [POST_IN_ACTIVE, POST_IN_STOPPED];

function castMember(id: string, handle: string, createdByUserId?: string): Character {
  return {
    id,
    handle,
    displayName: handle,
    description: "desc",
    rolePrompt: "role",
    tonePrompt: "tone",
    interests: ["test"],
    activityLevel: 0.5,
    responseProbability: 0.5,
    replyProbability: 0.5,
    quoteProbability: 0.5,
    influence: 0.5,
    modelProfileId: "profile-1",
    ...(createdByUserId ? { createdByUserId } : {}),
  };
}

const OWNED_CAST = castMember("cast-owned", "owned_cast", CHARACTER_OWNER.id);
const SYSTEM_CAST = castMember("cast-system", "system_cast");
const CAST = [OWNED_CAST, SYSTEM_CAST];

/** Rooms the caller may list, mirroring the repository's `where` clause (§10.3). */
function visibleRooms(actor: { id: string; isAdmin: boolean }): Simulation[] {
  return ROOMS.filter(
    (candidate) =>
      actor.isAdmin ||
      candidate.status === "active" ||
      candidate.createdByUserId === actor.id,
  );
}

function makeServices(): { services: AppServices; listedFor: string[] } {
  const listedFor: string[] = [];

  const simulationRepository = {
    findById: (id: string) => Promise.resolve(ROOMS.find((r) => r.id === id) ?? null),
    findSummaryById: (id: string) => {
      const found = ROOMS.find((r) => r.id === id);
      return Promise.resolve(found ? { ...found, postCount: 0, creator: null } : null);
    },
    findAllVisibleTo: (actor: { id: string; isAdmin: boolean }) => {
      listedFor.push(actor.id);
      return Promise.resolve(
        visibleRooms(actor).map((r) => ({ ...r, postCount: 0, creator: null })),
      );
    },
  } as unknown as SimulationRepository;

  const postService = {
    findById: (id: string) => Promise.resolve(POSTS.find((p) => p.id === id) ?? null),
    listByRoom: (roomId: string) =>
      Promise.resolve(
        POSTS.filter((p) => p.roomId === roomId).map((p) => ({ id: p.id })),
      ),
    toDto: (p: Post) => Promise.resolve({ id: p.id, roomId: p.roomId }),
    toDtos: (list: Post[]) => Promise.resolve(list.map((p) => ({ id: p.id }))),
  } as unknown as PostService;

  const characterRepository = {
    findAll: () => Promise.resolve([...CAST]),
    findAllIncludingDeleted: () => Promise.resolve([...CAST]),
    findAllByCreatedByUserId: (userId: string) =>
      Promise.resolve(CAST.filter((c) => c.createdByUserId === userId)),
    findAllIncludingDeletedByCreatedByUserId: (userId: string) =>
      Promise.resolve(CAST.filter((c) => c.createdByUserId === userId)),
    findById: (id: string) => Promise.resolve(CAST.find((c) => c.id === id) ?? null),
    findByIdIncludingDeleted: (id: string) =>
      Promise.resolve(CAST.find((c) => c.id === id) ?? null),
    countPostsByCharacterIds: (ids: string[]) => Promise.resolve(new Map(ids.map((id) => [id, 0]))),
  } as unknown as CharacterRepository;

  const userProfileRepository = {
    findById: (id: string) => {
      const found = [NORMAL_USER, ROOM_OWNER, OTHER_ROOM_OWNER, CHARACTER_OWNER, ADMIN].find(
        (candidate) => candidate.id === id,
      );
      return Promise.resolve(
        found
          ? { id: found.id, handle: found.handle, displayName: found.displayName, description: "" }
          : null,
      );
    },
    findByIds: (ids: string[]) =>
      Promise.resolve(ids.map((id) => ({ id, handle: `h_${id}`, displayName: id }))),
  } as unknown as UserProfileRepository;

  const handleRepository = {
    findByHandle: (handle: string) => {
      const cast = CAST.find((c) => c.handle === handle);
      if (cast) {
        return Promise.resolve({ handle, ownerType: "character" as const, ownerId: cast.id });
      }
      const user = [NORMAL_USER, ROOM_OWNER, CHARACTER_OWNER, ADMIN].find(
        (candidate) => candidate.handle === handle,
      );
      return Promise.resolve(
        user ? { handle, ownerType: "user" as const, ownerId: user.id } : null,
      );
    },
  } as unknown as HandleRepository;

  /** Records who asked, so the stopped-room exclusion can be asserted (§10.6). */
  const profileRepository = {
    findPostsByAuthor: (input: { authorId: string; viewer: { id: string; isAdmin: boolean } }) =>
      Promise.resolve(
        POSTS.filter((p) => {
          if (p.authorId !== input.authorId) return false;
          const owning = ROOMS.find((r) => r.id === p.roomId);
          if (!owning || owning.status === "active") return true;
          return input.viewer.isAdmin || owning.createdByUserId === input.viewer.id;
        }),
      ),
    countPostsByAuthor: () => Promise.resolve(0),
  } as unknown as ProfileRepository;

  const characters = new CharacterService(
    characterRepository,
    { findById: () => Promise.resolve({ id: "profile-1" }) } as unknown as ModelProfileRepository,
    {} as CharacterPersonaGenerator,
    userProfileRepository,
  );

  // All fixture rooms are `public` (§175's canView/canPost never need a real
  // row there), so "no membership" is a safe, correct fake for every scenario
  // this file exercises.
  const memberships = { findOne: () => Promise.resolve(null) };

  const simulations = new SimulationService({
    simulations: simulationRepository,
    memberships,
    posts: postService,
  } as unknown as ConstructorParameters<typeof SimulationService>[0]);

  const feed = new FeedService(
    {} as never,
    postService,
    simulationRepository,
    memberships as never,
  );

  const profiles = new ProfileService(
    handleRepository,
    characterRepository,
    userProfileRepository,
    profileRepository,
    postService,
  );

  return {
    services: {
      characters,
      simulations,
      feed,
      profiles,
      posts: postService,
      modelProfiles: { listDtos: () => Promise.resolve([]) },
      providerRegistry: { availableIds: () => ["mock"] },
    } as unknown as AppServices,
    listedFor,
  };
}

async function inject(
  currentUser: UserAccount | null,
  url: string,
): Promise<{ statusCode: number; body: unknown; listedFor: string[]; close: () => Promise<void> }> {
  const { services, listedFor } = makeServices();
  const app: FastifyInstance = Fastify();
  app.decorateRequest("currentUser", null);
  app.addHook("onRequest", async (request) => {
    request.currentUser = currentUser;
  });
  await registerRoutes(app, services);
  await app.ready();

  const response = await app.inject({ method: "GET", url });
  return {
    statusCode: response.statusCode,
    body: response.statusCode === 200 ? response.json() : undefined,
    listedFor,
    close: () => app.close(),
  };
}

describe("access matrix (§24.2)", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  async function get(currentUser: UserAccount | null, url: string) {
    const result = await inject(currentUser, url);
    closers.push(result.close);
    return result;
  }

  describe("rooms", () => {
    it.each([
      ["anonymous", ANONYMOUS, 401],
      ["normal user", NORMAL_USER, 200],
      ["room owner", ROOM_OWNER, 200],
      ["admin", ADMIN, 200],
    ])("GET /api/rooms for %s answers %i", async (_name, actor, expected) => {
      const { statusCode } = await get(actor, "/api/rooms");
      expect(statusCode).toBe(expected);
    });

    it("scopes the room list per caller instead of filtering after the fact", async () => {
      const { body, listedFor } = await get(NORMAL_USER, "/api/rooms");

      // The service passes the caller straight to the query (§10.3); the `where`
      // clause itself is pinned in simulation-repository.test.ts.
      expect(listedFor).toEqual([NORMAL_USER.id]);
      expect((body as { rooms: Array<{ id: string }> }).rooms.map((s) => s.id)).toEqual([
        ACTIVE_ROOM.id,
        OTHER_ROOM.id,
      ]);
    });

    it("hides a stopped room from everyone but its creator and an admin", async () => {
      const ids = async (actor: UserAccount) =>
        ((await get(actor, "/api/rooms")).body as { rooms: Array<{ id: string }> })
          .rooms.map((s) => s.id);

      expect(await ids(NORMAL_USER)).not.toContain(STOPPED_ROOM.id);
      expect(await ids(OTHER_ROOM_OWNER)).not.toContain(STOPPED_ROOM.id);
      expect(await ids(ROOM_OWNER)).toContain(STOPPED_ROOM.id);
      expect(await ids(ADMIN)).toContain(STOPPED_ROOM.id);
    });

    it("tells everyone what they may manage, and nobody otherwise", async () => {
      const canManage = async (actor: UserAccount) => {
        const { body } = await get(actor, "/api/rooms");
        const found = (body as { rooms: Array<{ id: string; canManage: boolean }> })
          .rooms.find((s) => s.id === ACTIVE_ROOM.id);
        return found?.canManage;
      };

      expect(await canManage(ROOM_OWNER)).toBe(true);
      expect(await canManage(ADMIN)).toBe(true);
      expect(await canManage(NORMAL_USER)).toBe(false);
      expect(await canManage(OTHER_ROOM_OWNER)).toBe(false);
    });
  });

  describe("one room", () => {
    it.each([
      ["anonymous", ANONYMOUS, 401],
      ["normal user", NORMAL_USER, 200],
      ["admin", ADMIN, 200],
    ])("an active room answers %i for %s", async (_name, actor, expected) => {
      const { statusCode } = await get(actor, `/api/rooms/${ACTIVE_ROOM.id}`);
      expect(statusCode).toBe(expected);
    });

    it.each([
      ["normal user", NORMAL_USER, 404],
      ["other room owner", OTHER_ROOM_OWNER, 404],
      ["room owner", ROOM_OWNER, 200],
      ["admin", ADMIN, 200],
    ])("a stopped room answers %i for %s", async (_name, actor, expected) => {
      const { statusCode } = await get(actor, `/api/rooms/${STOPPED_ROOM.id}`);
      // 404 rather than 403: a 403 would confirm the room exists (§10.4).
      expect(statusCode).toBe(expected);
    });

    it("no longer ships the room's posts with its basics", async () => {
      const { body } = await get(NORMAL_USER, `/api/rooms/${ACTIVE_ROOM.id}`);
      expect(body).not.toHaveProperty("posts");
    });

    it("is summary-shaped, same as a room list entry, for the room info panel (§19.2)", async () => {
      const { body } = (await get(ROOM_OWNER, `/api/rooms/${ACTIVE_ROOM.id}`)) as {
        body: { room: { postCount: number; creator: unknown; canManage: boolean } };
      };
      expect(body.room).toHaveProperty("postCount");
      expect(body.room).toHaveProperty("creator");
      expect(body.room.canManage).toBe(true);

      const { body: asStranger } = (await get(NORMAL_USER, `/api/rooms/${ACTIVE_ROOM.id}`)) as {
        body: { room: { canManage: boolean } };
      };
      expect(asStranger.room.canManage).toBe(false);
    });
  });

  describe("post detail (§10.8)", () => {
    it.each([
      ["anonymous", ANONYMOUS, 401],
      ["normal user", NORMAL_USER, 200],
      ["admin", ADMIN, 200],
    ])("a post in an active room answers %i for %s", async (_name, actor, expected) => {
      const { statusCode } = await get(actor, `/api/posts/${POST_IN_ACTIVE.id}`);
      expect(statusCode).toBe(expected);
    });

    it.each([
      ["normal user", NORMAL_USER, 404],
      ["other room owner", OTHER_ROOM_OWNER, 404],
      ["room owner", ROOM_OWNER, 200],
      ["admin", ADMIN, 200],
    ])("a post in a stopped room answers %i for %s", async (_name, actor, expected) => {
      const { statusCode } = await get(actor, `/api/posts/${POST_IN_STOPPED.id}`);
      expect(statusCode).toBe(expected);
    });

    it("answers the same 404 for a hidden post as for one that does not exist", async () => {
      const hidden = await get(NORMAL_USER, `/api/posts/${POST_IN_STOPPED.id}`);
      const missing = await get(NORMAL_USER, "/api/posts/does-not-exist");

      expect(hidden.statusCode).toBe(missing.statusCode);
    });
  });

  describe("public profile (§10.6, §25)", () => {
    it("requires a session", async () => {
      const { statusCode } = await get(ANONYMOUS, `/api/profiles/${OWNED_CAST.handle}`);
      expect(statusCode).toBe(401);
    });

    it("returns the same shape for a person and for a cast member", async () => {
      const person = await get(NORMAL_USER, `/api/profiles/${NORMAL_USER.handle}`);
      const cast = await get(NORMAL_USER, `/api/profiles/${OWNED_CAST.handle}`);

      expect([person.statusCode, cast.statusCode]).toEqual([200, 200]);

      const keysOf = (body: unknown) =>
        Object.keys((body as { profile: Record<string, unknown> }).profile).sort();
      expect(keysOf(cast.body)).toEqual(keysOf(person.body));
    });

    it("carries no field that tells a person from a cast member", async () => {
      const { body } = await get(NORMAL_USER, `/api/profiles/${OWNED_CAST.handle}`);
      const profile = (body as { profile: Record<string, unknown> }).profile;

      for (const forbidden of [
        "ownerType",
        "kind",
        "isCharacter",
        "modelProfileId",
        "createdByUserId",
        "rolePrompt",
        "tonePrompt",
        "interests",
        "activityLevel",
      ]) {
        expect(profile).not.toHaveProperty(forbidden);
      }
      expect(Object.keys(profile).sort()).toEqual(
        ["canEdit", "description", "displayName", "handle", "id", "postCount"].sort(),
      );
    });

    it("grants canEdit to the cast owner and to an admin, but not to a stranger", async () => {
      const canEdit = async (actor: UserAccount) =>
        (
          (await get(actor, `/api/profiles/${OWNED_CAST.handle}`)).body as {
            profile: { canEdit: boolean };
          }
        ).profile.canEdit;

      expect(await canEdit(CHARACTER_OWNER)).toBe(true);
      expect(await canEdit(ADMIN)).toBe(true);
      expect(await canEdit(NORMAL_USER)).toBe(false);
    });

    it("grants canEdit on your own profile, so canEdit identifies no kind of account", async () => {
      const { body } = await get(NORMAL_USER, `/api/profiles/${NORMAL_USER.handle}`);

      expect((body as { profile: { canEdit: boolean } }).profile.canEdit).toBe(true);
    });

    it("keeps stopped rooms out of the post list for everyone but that room's owner", async () => {
      const ids = async (actor: UserAccount) =>
        (
          (await get(actor, `/api/profiles/${OWNED_CAST.handle}/posts`)).body as {
            posts: Array<{ id: string }>;
          }
        ).posts.map((p) => p.id);

      expect(await ids(NORMAL_USER)).toEqual([POST_IN_ACTIVE.id]);
      expect(await ids(CHARACTER_OWNER)).toEqual([POST_IN_ACTIVE.id]);
      expect(await ids(ROOM_OWNER)).toEqual([POST_IN_ACTIVE.id, POST_IN_STOPPED.id]);
      expect(await ids(ADMIN)).toEqual([POST_IN_ACTIVE.id, POST_IN_STOPPED.id]);
    });

    it("answers 404 for a handle nobody holds", async () => {
      const { statusCode } = await get(NORMAL_USER, "/api/profiles/nobody_here");
      expect(statusCode).toBe(404);
    });
  });

  describe("cast management (§10.7)", () => {
    it.each([
      ["anonymous", ANONYMOUS, 401],
      ["normal user", NORMAL_USER, 200],
      ["character owner", CHARACTER_OWNER, 200],
      ["admin", ADMIN, 200],
    ])("GET /api/characters/management answers %i for %s", async (_name, actor, expected) => {
      const { statusCode } = await get(actor, "/api/characters/management");
      expect(statusCode).toBe(expected);
    });

    it("shows a normal user nothing, the owner their own, and the admin everything", async () => {
      const ids = async (actor: UserAccount) =>
        (
          (await get(actor, "/api/characters/management")).body as {
            characters: Array<{ id: string }>;
          }
        ).characters.map((c) => c.id);

      expect(await ids(NORMAL_USER)).toEqual([]);
      expect(await ids(CHARACTER_OWNER)).toEqual([OWNED_CAST.id]);
      expect(await ids(ADMIN)).toEqual(expect.arrayContaining([OWNED_CAST.id, SYSTEM_CAST.id]));
    });

    /**
     * The roster endpoint, asserted on its contents rather than only its guard.
     *
     * This case exists because the first version of this file checked
     * `/api/characters` for 401/200 alone, and a later change widened it back to
     * "every active character for any signed-in caller" without a single test
     * failing. Since the feed is readable while signed in, that list is enough to
     * mark every AI post in it — the leak `/api/handles/:handle` was removed for
     * (§25), in bulk. A handle assertion is the one that would have caught it.
     */
    it("gives an ordinary caller no handle they do not already own", async () => {
      const handles = async (actor: UserAccount) =>
        (
          (await get(actor, "/api/characters")).body as {
            characters: Array<{ handle: string }>;
          }
        ).characters.map((c) => c.handle);

      expect(await handles(NORMAL_USER)).toEqual([]);
      expect(await handles(CHARACTER_OWNER)).toEqual([OWNED_CAST.handle]);
      expect(await handles(ADMIN)).toEqual(
        expect.arrayContaining([OWNED_CAST.handle, SYSTEM_CAST.handle]),
      );
    });

    it("labels creators for an admin only, with null for System-owned", async () => {
      const forAdmin = (
        (await get(ADMIN, "/api/characters/management")).body as {
          characters: Array<{ id: string; creator: unknown }>;
        }
      ).characters;
      expect(forAdmin.find((c) => c.id === SYSTEM_CAST.id)?.creator).toBeNull();
      expect(forAdmin.find((c) => c.id === OWNED_CAST.id)?.creator).toMatchObject({
        id: CHARACTER_OWNER.id,
      });

      const forOwner = (
        (await get(CHARACTER_OWNER, "/api/characters/management")).body as {
          characters: Array<Record<string, unknown>>;
        }
      ).characters;
      expect(forOwner[0]).not.toHaveProperty("creator");
    });

    it("hides another account's cast member behind a 404, config included", async () => {
      await expect(
        get(NORMAL_USER, `/api/characters/${OWNED_CAST.id}`).then((r) => r.statusCode),
      ).resolves.toBe(404);
      await expect(
        get(NORMAL_USER, `/api/characters/${OWNED_CAST.id}/config`).then((r) => r.statusCode),
      ).resolves.toBe(404);

      // 404 and not 403, because "yes, that id is a character" is itself the
      // discriminator this phase removes (§25).
      await expect(
        get(CHARACTER_OWNER, `/api/characters/${OWNED_CAST.id}/config`).then((r) => r.statusCode),
      ).resolves.toBe(200);
      await expect(
        get(ADMIN, `/api/characters/${OWNED_CAST.id}/config`).then((r) => r.statusCode),
      ).resolves.toBe(200);
    });

    it("requires a session for the model profile list", async () => {
      await expect(get(ANONYMOUS, "/api/model-profiles").then((r) => r.statusCode)).resolves.toBe(
        401,
      );
      await expect(get(NORMAL_USER, "/api/model-profiles").then((r) => r.statusCode)).resolves.toBe(
        200,
      );
    });
  });

  describe("retired endpoints", () => {
    it("no longer resolves a handle to an owner type", async () => {
      // The route is gone, not merely guarded: its response was the discriminator
      // (§10.6). A 404 from the router is the assertion.
      await expect(
        get(ADMIN, `/api/handles/${OWNED_CAST.handle}`).then((r) => r.statusCode),
      ).resolves.toBe(404);
    });
  });
});
