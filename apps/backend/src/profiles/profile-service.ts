import type {
  PostsPageResponse,
  PublicAccountDto,
  PublicProfileDto,
} from "@brickr/shared";
import type { CharacterRepository } from "../characters/character-repository.js";
import type { Character } from "../characters/character.js";
import { DomainError } from "../domain-error.js";
import { decodeFeedCursor, encodeFeedCursor } from "../feed/feed-cursor.js";
import type { HandleRepository } from "../handles/handle-repository.js";
import { optionalField } from "../persistence/repository-mapping.js";
import type { PostService } from "../posts/post-service.js";
import type { Post } from "../posts/post.js";
import type { UserProfileRepository } from "../user-profile/user-profile-repository.js";
import type { UserProfile } from "../user-profile/user-profile.js";
import type { ProfileRepository, ProfileViewer } from "./profile-repository.js";

/**
 * No account holds this handle.
 *
 * One error for people and characters alike: a separate "character not found"
 * would tell a caller which half of the shared namespace they just probed (§9.2).
 */
export class ProfileNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "not_found" as const;
  constructor(handle: string) {
    super(`no profile for handle "@${handle}"`);
  }
}

/** Posts per profile page. Matches the feed so both lists behave the same (§9.4). */
export const PROFILE_PAGE_SIZE = 20;

/**
 * The public profile behind a handle, for people and AI characters alike
 * (§9.2, §10.6, §21).
 *
 * The whole point of this service is that a caller cannot tell which of the two
 * they are looking at. Both halves of the handle namespace resolve into one
 * `PublicProfileDto`, with the same fields in the same order, and everything
 * that would give the answer away — owner type, model profile, persona prompts,
 * behaviour probabilities, `createdByUserId`, token usage — is simply never read
 * here. Those live in the authenticated management APIs (§10.7).
 *
 * `canEdit` is the one capability that leaves: it is true on your own profile
 * too, so its being true proves nothing about the kind of account (§9.2).
 */
export class ProfileService {
  constructor(
    private readonly handles: HandleRepository,
    private readonly characters: CharacterRepository,
    private readonly users: UserProfileRepository,
    private readonly profiles: ProfileRepository,
    private readonly posts: PostService,
  ) {}

  async getProfile(handle: string, viewer: ProfileViewer): Promise<PublicProfileDto> {
    const account = await this.resolve(handle);
    return {
      ...account.account,
      postCount: await this.profiles.countPostsByAuthor(account.account.id, viewer),
      canEdit: account.canEdit(viewer),
    };
  }

  /**
   * One page of an account's posts, across every room (§10.6).
   *
   * Reads one row beyond the page to decide whether a next cursor exists, the
   * same trick the feed uses, so no counting query is needed.
   */
  async listPosts(
    handle: string,
    viewer: ProfileViewer,
    cursor?: string,
  ): Promise<PostsPageResponse> {
    const account = await this.resolve(handle);

    const rows = await this.profiles.findPostsByAuthor({
      authorId: account.account.id,
      viewer,
      ...(cursor === undefined ? {} : { cursor: decodeFeedCursor(cursor) }),
      limit: PROFILE_PAGE_SIZE + 1,
    });

    const page = rows.slice(0, PROFILE_PAGE_SIZE);
    return {
      posts: await this.posts.toDtos(page),
      nextCursor: rows.length > PROFILE_PAGE_SIZE ? nextCursorOf(page) : null,
    };
  }

  /**
   * Resolves a handle into the account behind it, plus how to decide `canEdit`.
   *
   * Soft-deleted characters still resolve: their past posts still name them, so
   * the profile those posts link to has to open (§10.6). Editing is refused
   * there regardless of ownership - a deleted character is restored from the
   * management list, not from its profile.
   */
  private async resolve(handle: string): Promise<ResolvedProfile> {
    const owner = await this.handles.findByHandle(handle);
    if (!owner) throw new ProfileNotFoundError(handle);

    if (owner.ownerType === "character") {
      const character = await this.characters.findByIdIncludingDeleted(owner.ownerId);
      if (!character) throw new ProfileNotFoundError(handle);
      return {
        account: toPublicAccount(character),
        canEdit: (viewer) =>
          character.deletedAt === undefined &&
          (viewer.isAdmin || viewer.id === character.createdByUserId),
      };
    }

    const user = await this.users.findById(owner.ownerId);
    if (!user) throw new ProfileNotFoundError(handle);
    return {
      account: toPublicAccount(user),
      // Only yourself: an administrator manages accounts through the admin API
      // (§66.15), not by editing someone's profile from the public screen.
      canEdit: (viewer) => viewer.id === user.id,
    };
  }
}

type ResolvedProfile = {
  account: PublicAccountDto;
  canEdit: (viewer: ProfileViewer) => boolean;
};

/**
 * Built field by field, from either kind of account, so the two cannot drift
 * apart and nothing private can ride along on a spread (§9.1).
 */
function toPublicAccount(account: Character | UserProfile): PublicAccountDto {
  return {
    id: account.id,
    handle: account.handle,
    displayName: account.displayName,
    description: account.description,
    ...optionalField("avatarUrl", account.avatarUrl),
  };
}

/** The last post actually served is where the next page continues from (§9.4). */
function nextCursorOf(page: Post[]): string | null {
  const last = page.at(-1);
  return last ? encodeFeedCursor({ activityAt: last.createdAt, id: last.id }) : null;
}
