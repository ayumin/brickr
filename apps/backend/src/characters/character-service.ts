import type {
  CharacterConfigDto,
  CharacterCreatorDto,
  CharacterDto,
  CharacterBulkCreationJobDto,
  CharacterManagementDto,
  CharacterDeletionMode,
  ExportCharactersCsvResponse,
  ImportCharactersCsvResponse,
  SaveCharacterRequest,
} from "@brickr/shared";
import { randomUUID } from "node:crypto";
import { DomainError } from "../domain-error.js";
import type { ModelProfileRepository } from "../model-profiles/model-profile-repository.js";
import { CharacterBulkCreationJobs } from "./character-bulk-creation-job.js";
import { CharacterCsvService } from "./character-csv-service.js";
import type { CharacterRepository } from "./character-repository.js";
import type { Character, SaveCharacter } from "./character.js";
import {
  toCharacterConfigDto,
  toCharacterDto,
  toCharacterManagementDto,
  type CharacterActor,
} from "./character-dto.js";
import { CharacterGenerationError, type CharacterPersonaGenerator } from "./character-generator.js";
import { CHARACTER_SEEDS } from "./character-seeds.js";
import { DEMO_AVATAR_COUNT, demoAvatarDataUrl } from "./demo-avatar.js";

export class CharacterNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "not_found" as const;
  constructor(id: string) {
    super(`character "${id}" not found`);
  }
}

/** Edit/delete/restore is limited to the creator or an admin (CLAUDE.md §66.5). */
export class CharacterForbiddenError extends DomainError {
  readonly httpStatus = 403;
  readonly errorCode = "forbidden" as const;
  constructor(id: string) {
    super(`not allowed to modify character "${id}"`);
  }
}

export class CharacterHandleConflictError extends DomainError {
  readonly httpStatus = 409;
  readonly errorCode = "handle_conflict" as const;
  constructor(handle: string) {
    super(`handle "@${handle}" is already in use`);
  }
}

export class ModelProfileNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "not_found" as const;
  constructor(id: string) {
    super(`model profile "${id}" not found`);
  }
}

/**
 * Just enough of the account repository to label who owns a character (§20.3).
 *
 * Narrowed to one method so this service cannot grow into reading accounts for
 * anything else — ownership is the only thing it has any business knowing.
 */
export type CharacterCreatorLookup = {
  findByIds(ids: string[]): Promise<Array<{ id: string; handle: string; displayName: string }>>;
};

export class CharacterService {
  private readonly bulkCreationJobs: CharacterBulkCreationJobs;
  private readonly csv: CharacterCsvService;
  /** Seed avatars occupy the start of the pool; generated characters continue after them. */
  private nextDemoAvatarIndex = CHARACTER_SEEDS.length % DEMO_AVATAR_COUNT;

  constructor(
    private readonly characters: CharacterRepository,
    private readonly modelProfiles: ModelProfileRepository,
    private readonly personaGenerator: CharacterPersonaGenerator,
    private readonly creators: CharacterCreatorLookup,
    private readonly random: () => number = Math.random,
  ) {
    // Assigned here, not as field initializers: under this project's
    // `target: ES2022` (useDefineForClassFields defaults to true), a field
    // initializer runs before constructor parameter properties are assigned,
    // so both would close over an as-yet-uninitialized `this`/`this.characters`.
    this.bulkCreationJobs = new CharacterBulkCreationJobs((count, userId, onProgress) =>
      this.createMany(count, userId, onProgress),
    );
    this.csv = new CharacterCsvService(characters, modelProfiles);
  }

  /**
   * Characters this caller owns, or all of them for an administrator (§10.7).
   *
   * Never the whole table for an ordinary caller. A complete roster is a lookup
   * table from handle to "this account is an AI", and the feed is readable while
   * signed in, so anyone holding that list could mark every AI post in it. That
   * is a more efficient version of exactly what removing
   * `GET /api/handles/:handle` was for (§25), which is why the scope belongs here
   * and not only on the management endpoints.
   *
   * **Do not widen this to serve a client-side cast picker.** Mentioning a
   * seeded character never required the roster: `@handle` is free text (§10.5)
   * and `PostService.publish` resolves it server-side through
   * `resolveKnownMentions`, so a composer only needs the user to type the handle.
   * The two features that did read a full roster — the `@` mention picker and
   * client-chosen `responderIds` — are both being removed in phase 1 (§10.5,
   * Step 8), and the startup fetch that populated it goes with them (Step 10).
   */
  async listDtos(actor: CharacterActor): Promise<CharacterDto[]> {
    const all = actor.isAdmin
      ? await this.characters.findAll()
      : await this.characters.findAllByCreatedByUserId(actor.id);
    return all.map(toCharacterDto);
  }

  /**
   * The management list, scoped to what this caller may manage (§10.7, §20.1).
   *
   * Soft-deleted characters are included on purpose: the screen has a filter for
   * them, and restoring one is only possible if it can be listed first.
   *
   * The administrator's list is the only one that spans other people, so it is
   * the only one that resolves `creator` — in one batched lookup, never one query
   * per character.
   */
  async listManagementDtos(actor: CharacterActor): Promise<CharacterManagementDto[]> {
    const all = actor.isAdmin
      ? await this.characters.findAllIncludingDeleted()
      : await this.characters.findAllIncludingDeletedByCreatedByUserId(actor.id);
    const postCounts = await this.characters.countPostsByCharacterIds(
      all.map((character) => character.id),
    );
    const creators = actor.isAdmin ? await this.resolveCreators(all) : null;

    return all.map((character) =>
      toCharacterManagementDto(character, postCounts.get(character.id) ?? 0, actor, creators),
    );
  }

  /**
   * Owners of a batch of characters, keyed by user id (§20.3).
   *
   * A System-owned character has no owner id to look up (§66.14), so a list of
   * nothing but seeds costs no query at all.
   */
  private async resolveCreators(
    characters: Character[],
  ): Promise<Map<string, CharacterCreatorDto>> {
    const ids = [
      ...new Set(characters.flatMap((character) => character.createdByUserId ?? [])),
    ];
    if (ids.length === 0) return new Map();

    const users = await this.creators.findByIds(ids);
    return new Map(
      users.map((user) => [
        user.id,
        { id: user.id, handle: user.handle, displayName: user.displayName },
      ]),
    );
  }

  /** Admin drilldown onto one user's Characters (§66.5, §66.15). */
  async listManagementDtosByCreator(
    userId: string,
    viewer: CharacterActor | null = null,
  ): Promise<CharacterManagementDto[]> {
    const all = await this.characters.findAllIncludingDeletedByCreatedByUserId(userId);
    const postCounts = await this.characters.countPostsByCharacterIds(
      all.map((character) => character.id),
    );
    return all.map((character) =>
      toCharacterManagementDto(character, postCounts.get(character.id) ?? 0, viewer),
    );
  }

  async exportCsv(actor: CharacterActor): Promise<ExportCharactersCsvResponse> {
    return this.csv.exportCsv(actor);
  }

  async importCsv(csv: string, actor: CharacterActor): Promise<ImportCharactersCsvResponse> {
    return this.csv.importCsv(csv, actor);
  }

  /**
   * One character, for the caller who may manage it (§10.7).
   *
   * A character the caller does not own reads as absent rather than forbidden,
   * for the same reason the config below does: see `findConfigDto`.
   */
  async findDto(id: string, actor: CharacterActor): Promise<CharacterDto | null> {
    const character = await this.characters.findById(id);
    if (!character || !this.isOwnerOrAdmin(character, actor)) return null;
    return toCharacterDto(character);
  }

  /**
   * The editor's view of one character: creator or administrator only (§10.7).
   *
   * Returns `null` — a 404, not a 403 — when the caller may not have it. A 403
   * here would confirm that the id belongs to a character, and since ids are
   * shared between accounts on the public surface, that answer alone would let
   * anyone sort handles into people and AI (§25).
   *
   * This is the only path to a model profile, provider, system prompt or persona,
   * and none of them may ever be reachable through a public profile (§10.7).
   */
  async findConfigDto(id: string, actor: CharacterActor): Promise<CharacterConfigDto | null> {
    const character = await this.characters.findByIdIncludingDeleted(id);
    if (!character || !this.isOwnerOrAdmin(character, actor)) return null;
    return toCharacterConfigDto(character, actor);
  }

  async create(input: SaveCharacterRequest, actor: CharacterActor): Promise<CharacterConfigDto> {
    await this.assertModelProfile(input.modelProfileId);
    await this.assertHandleAvailable(input.handle);
    const character = await this.characters.create(randomUUID(), toSaveCharacter(input), actor.id);
    return toCharacterConfigDto(character, actor);
  }

  async createMany(
    count: number,
    createdByUserId: string,
    onProgress?: (completed: number) => void,
  ): Promise<CharacterDto[]> {
    const [defaultProfile] = await this.modelProfiles.findAll();
    if (!defaultProfile) throw new ModelProfileNotFoundError("default");
    const avatarStart = this.reserveDemoAvatars(count);

    let personas;
    try {
      personas = await this.personaGenerator.generate(count, defaultProfile, onProgress);
    } catch (cause) {
      throw new CharacterGenerationError({ cause });
    }

    const entries = personas.map((persona, index) => {
      const id = randomUUID();
      const suffix = id.replaceAll("-", "").slice(0, 8);
      return {
        id,
        createdByUserId,
        input: {
          handle: `character_${suffix}`,
          displayName: persona.displayName,
          description: persona.description,
          rolePrompt: persona.rolePrompt,
          tonePrompt: persona.tonePrompt,
          ...(persona.dialectPrompt ? { dialectPrompt: persona.dialectPrompt } : {}),
          interests: persona.interests,
          activityLevel: randomProbability(this.random),
          responseProbability: randomProbability(this.random),
          replyProbability: randomProbability(this.random),
          quoteProbability: randomProbability(this.random),
          influence: randomProbability(this.random),
          modelProfileId: defaultProfile.id,
          avatarUrl: demoAvatarDataUrl(avatarStart + index),
        },
      };
    });
    const created = await this.characters.createMany(entries);
    return created.map(toCharacterDto);
  }

  startCreateMany(count: number, createdByUserId: string): CharacterBulkCreationJobDto {
    return this.bulkCreationJobs.start(count, createdByUserId);
  }

  findBulkCreationJob(id: string): CharacterBulkCreationJobDto | null {
    return this.bulkCreationJobs.find(id);
  }

  private reserveDemoAvatars(count: number): number {
    const start = this.nextDemoAvatarIndex;
    this.nextDemoAvatarIndex = (start + count) % DEMO_AVATAR_COUNT;
    return start;
  }

  async update(
    id: string,
    input: SaveCharacterRequest,
    actor: CharacterActor,
  ): Promise<CharacterConfigDto> {
    const existing = await this.characters.findByIdIncludingDeleted(id);
    if (!existing) throw new CharacterNotFoundError(id);
    this.assertOwnerOrAdmin(existing, actor);

    await this.assertModelProfile(input.modelProfileId);
    await this.assertHandleAvailable(input.handle, id);
    const character = await this.characters.update(id, toSaveCharacter(input));
    return toCharacterConfigDto(character, actor);
  }

  async delete(
    id: string,
    actor: CharacterActor,
    mode: CharacterDeletionMode = "soft",
  ): Promise<string> {
    const existing = await this.characters.findByIdIncludingDeleted(id);
    if (!existing) throw new CharacterNotFoundError(id);
    this.assertOwnerOrAdmin(existing, actor);

    if (mode === "hard") await this.characters.hardDeleteMany([id]);
    else await this.characters.delete(id);
    return id;
  }

  async restore(id: string, actor: CharacterActor): Promise<string> {
    const existing = await this.characters.findByIdIncludingDeleted(id);
    if (!existing) throw new CharacterNotFoundError(id);
    this.assertOwnerOrAdmin(existing, actor);

    await this.characters.restore(id);
    return id;
  }

  /** Silently drops any id the actor may not touch, rather than rejecting the whole batch. */
  async deleteMany(
    ids: string[],
    actor: CharacterActor,
    mode: CharacterDeletionMode = "soft",
  ): Promise<string[]> {
    const uniqueIds = [...new Set(ids)];
    const existing = await this.characters.findByIdsIncludingDeleted(uniqueIds);
    const deletedIds = existing
      .filter((character) => this.isOwnerOrAdmin(character, actor))
      .map((character) => character.id);
    if (mode === "hard") await this.characters.hardDeleteMany(deletedIds);
    else await this.characters.deleteMany(deletedIds);
    return deletedIds;
  }

  private async assertModelProfile(id: string): Promise<void> {
    if (!(await this.modelProfiles.findById(id))) throw new ModelProfileNotFoundError(id);
  }

  private async assertHandleAvailable(handle: string, currentId?: string): Promise<void> {
    const existing = await this.characters.findByHandle(handle);
    if (existing && existing.id !== currentId) throw new CharacterHandleConflictError(handle);
  }

  /**
   * A character with no owner (a seed) matches no id, so only an admin can
   * touch it — `createdByUserId` never equals `undefined` (CLAUDE.md §66.14).
   */
  private isOwnerOrAdmin(character: Character, actor: CharacterActor): boolean {
    return actor.isAdmin || actor.id === character.createdByUserId;
  }

  private assertOwnerOrAdmin(character: Character, actor: CharacterActor): void {
    if (!this.isOwnerOrAdmin(character, actor)) throw new CharacterForbiddenError(character.id);
  }
}

function randomProbability(random: () => number): number {
  return Math.round(Math.min(1, Math.max(0, random())) * 100) / 100;
}

function toSaveCharacter(input: SaveCharacterRequest): SaveCharacter {
  return {
    handle: input.handle,
    displayName: input.displayName,
    description: input.description,
    rolePrompt: input.rolePrompt,
    tonePrompt: input.tonePrompt,
    ...(input.dialectPrompt ? { dialectPrompt: input.dialectPrompt } : {}),
    interests: input.interests,
    activityLevel: input.activityLevel,
    responseProbability: input.responseProbability,
    replyProbability: input.replyProbability,
    quoteProbability: input.quoteProbability,
    influence: input.influence,
    modelProfileId: input.modelProfileId,
    ...(input.avatarUrl ? { avatarUrl: input.avatarUrl } : {}),
  };
}
