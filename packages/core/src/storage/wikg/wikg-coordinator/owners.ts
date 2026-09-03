import { getWikiGraphPlatform } from "../../../runtime/platform/index.js";
import { randomUuid } from "../../../utils/crypto.js";

import { cleanupStaleState, withCoordinatorState } from "./state.js";
import type { CoordinatorOwner } from "./types.js";

export function createCoordinatorOwner(): CoordinatorOwner {
  return {
    hostInstanceId: getWikiGraphPlatform().lifecycle.instanceId,
    ownerId: randomUuid(),
  };
}

export async function registerArchiveOwner(
  archiveKey: string,
  owner: CoordinatorOwner,
): Promise<void> {
  await withCoordinatorState(async (database) => {
    await database.transaction(async () => {
      await cleanupStaleState(database, archiveKey);
      const now = Date.now();
      await database.run(
        `
INSERT INTO archive_owners (
  archive_key, owner_id, host_instance_id, heartbeat_at, created_at
) VALUES (?, ?, ?, ?, ?)
`,
        [archiveKey, owner.ownerId, owner.hostInstanceId, now, now],
      );
    });
  });
}

export async function heartbeatArchiveOwner(
  archiveKey: string,
  owner: CoordinatorOwner,
): Promise<void> {
  await withCoordinatorState(async (database) => {
    await database.run(
      `
UPDATE archive_owners
SET heartbeat_at = ?, host_instance_id = ?
WHERE archive_key = ? AND owner_id = ?
`,
      [Date.now(), owner.hostInstanceId, archiveKey, owner.ownerId],
    );
  });
}

export async function unregisterArchiveOwner(
  archiveKey: string,
  ownerId: string,
): Promise<void> {
  await withCoordinatorState(async (database) => {
    await database.transaction(async () => {
      await database.run(
        "DELETE FROM entry_sqlite_leases WHERE archive_key = ? AND owner_id = ?",
        [archiveKey, ownerId],
      );
      await database.run(
        "DELETE FROM entry_locks WHERE archive_key = ? AND owner_id = ?",
        [archiveKey, ownerId],
      );
      await database.run(
        "DELETE FROM archive_commit_locks WHERE archive_key = ? AND owner_id = ?",
        [archiveKey, ownerId],
      );
      await database.run(
        "DELETE FROM archive_owners WHERE archive_key = ? AND owner_id = ?",
        [archiveKey, ownerId],
      );
    });
  });
}
