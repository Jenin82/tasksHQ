import { and, eq, exists, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { alias } from "drizzle-orm/sqlite-core";
import { DomainError } from "../errors";
import { user } from "../schema/auth";
import { orgMember } from "../schema/org";
import { convertImageToWebP, TASK_IMAGE_ID, type ImageBinding } from "../task-images";

const avatarTransform = { width: 96, height: 96, fit: "cover" } as const;
const maxAvatarBytes = 15 * 1024;

type AvatarStorage = {
  IMAGES: ImageBinding;
  TASK_IMAGES: {
    put(key: string, bytes: ArrayBuffer, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
    delete(key: string): Promise<void>;
  };
};

function avatarPrefix(userId: string) {
  return `/api/profile/avatar/${encodeURIComponent(userId)}/`;
}

function avatarKey(userId: string, version: string) {
  return `avatars/${encodeURIComponent(userId)}/${version}.webp`;
}

export function uploadedProfileAvatarKey(userId: string, image: string) {
  const prefix = avatarPrefix(userId);
  if (!image.startsWith(prefix)) return null;
  const version = image.slice(prefix.length);
  return TASK_IMAGE_ID.test(version) ? avatarKey(userId, version) : null;
}

async function removeAvatarObject(storage: AvatarStorage, userId: string, version: string) {
  try {
    await storage.TASK_IMAGES.delete(avatarKey(userId, version));
  } catch {
    console.warn("Could not remove an unused profile image.");
  }
}

export async function updateProfileAvatar(
  db: DrizzleD1Database,
  storage: AvatarStorage,
  actorUserId: string,
  bytes: Uint8Array<ArrayBuffer> | null,
): Promise<{ image: string | null } | undefined> {
  const [current] = await db.select({ image: user.image }).from(user).where(eq(user.id, actorUserId));
  if (!current) return;
  if (!bytes && current.image === null) return current;

  const version = bytes ? crypto.randomUUID() : null;
  const image = version ? `${avatarPrefix(actorUserId)}${version}` : null;
  if (bytes && version) {
    let webp = await convertImageToWebP(storage.IMAGES, bytes, avatarTransform, 72);
    if (webp.byteLength > maxAvatarBytes) {
      webp = await convertImageToWebP(storage.IMAGES, bytes, avatarTransform, 42);
    }
    if (webp.byteLength > maxAvatarBytes) throw new DomainError("Choose a less detailed profile photo.");
    await storage.TASK_IMAGES.put(avatarKey(actorUserId, version), webp.buffer, {
      httpMetadata: { contentType: "image/webp" },
    });
  }

  // A simultaneous update must not replace a newer photo or delete its R2 object.
  let updated: { image: string | null } | undefined;
  try {
    [updated] = await db.update(user).set({ image }).where(and(
      eq(user.id, actorUserId),
      current.image === null ? isNull(user.image) : eq(user.image, current.image),
    )).returning({ image: user.image });
  } catch (error) {
    if (version) {
      // If D1 committed before reporting an error, keep the current object.
      const saved = await db.select({ image: user.image }).from(user)
        .where(eq(user.id, actorUserId)).all().catch(() => undefined);
      if (saved && saved[0]?.image !== image) await removeAvatarObject(storage, actorUserId, version);
    }
    throw error;
  }

  const prefix = avatarPrefix(actorUserId);
  const oldVersion = current.image?.startsWith(prefix) ? current.image.slice(prefix.length) : null;
  const unusedVersion = updated ? oldVersion : version;
  if (unusedVersion && TASK_IMAGE_ID.test(unusedVersion)) {
    await removeAvatarObject(storage, actorUserId, unusedVersion);
  }
  return updated;
}

export async function readableProfileAvatarKey(
  db: DrizzleD1Database,
  viewerId: string,
  ownerId: string,
  version: string,
) {
  if (!TASK_IMAGE_ID.test(version)) return null;
  const ownerMembership = alias(orgMember, "avatar_owner_membership");
  const sharesOrganization = db.select({ orgId: orgMember.orgId }).from(orgMember)
    .innerJoin(ownerMembership, and(eq(ownerMembership.orgId, orgMember.orgId), eq(ownerMembership.userId, ownerId)))
    .where(eq(orgMember.userId, viewerId));

  const [row] = await db.select({ id: user.id }).from(user).where(and(
    eq(user.id, ownerId),
    eq(user.image, `${avatarPrefix(ownerId)}${version}`),
    viewerId === ownerId ? undefined : exists(sharesOrganization),
  ));
  return row ? avatarKey(ownerId, version) : null;
}
