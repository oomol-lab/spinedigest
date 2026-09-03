export type EntryLockMode = "read" | "state" | "write";
export type SqliteLeaseMode = "read" | "write";
export type WorkspaceWritebackPolicy = "archive" | "cache";

export interface CoordinatorOwner {
  readonly hostInstanceId: string;
  readonly ownerId: string;
}

export interface EntryOverlay {
  readonly archiveIdentity: string;
  readonly archiveKey: string;
  readonly baseDigest?: string;
  readonly entryPath: string;
  readonly kind: "deleted" | "file";
  readonly ownerId: string;
  readonly updatedAt: number;
  readonly workspaceIdentity?: string;
  readonly workspacePath?: string;
}

export interface EntryLock {
  readonly entryPath: string;
  readonly mode: EntryLockMode;
  readonly ownerId: string;
}
