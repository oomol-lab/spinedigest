import {
  BUILD_JOB_STATES,
  type BuildJob,
  type BuildJobState,
  type BuildJobTarget,
} from "./types.js";
import { getWikiGraphPlatform } from "../platform/index.js";

export interface StoredBuildJob extends Omit<
  BuildJob,
  "archive" | "cache" | "events" | "log" | "workspace"
> {
  readonly archiveIdentity: string;
  readonly cacheIdentity: string;
  readonly eventsIdentity: string;
  readonly logIdentity: string;
  readonly ownerPid?: number;
  readonly workspaceIdentity: string;
}

export function mapBuildJob(row: Record<string, unknown>): StoredBuildJob {
  const currentStep = parseOptionalBuildJobTarget(
    getOptionalString(row, "current_step"),
    "current_step",
  );
  const ownerId = getOptionalString(row, "owner_id");
  const ownerPid =
    row.owner_pid === null ? undefined : getNumber(row, "owner_pid");
  const readingSummaryStartedAt =
    row.reading_summary_started_at === null
      ? undefined
      : getNumber(row, "reading_summary_started_at");
  const finishedAt =
    row.finished_at === null ? undefined : getNumber(row, "finished_at");
  const errorJSON = getOptionalString(row, "error_json");
  const inputRevision =
    row.input_revision === null ? undefined : getNumber(row, "input_revision");
  const llmJSON = getOptionalString(row, "llm_json");
  const prompt = getOptionalString(row, "prompt");

  return {
    archiveKey: getString(row, "archive_key"),
    archiveIdentity: getString(row, "archive_path"),
    cacheIdentity: getString(row, "cache_path"),
    chapterId: getNumber(row, "chapter_id"),
    createdAt: getNumber(row, "created_at"),
    ...(currentStep === undefined ? {} : { currentStep }),
    ...(errorJSON === undefined ? {} : { errorJSON }),
    eventsIdentity: getString(row, "events_path"),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    jobId: getString(row, "job_id"),
    ...(inputRevision === undefined ? {} : { inputRevision }),
    logIdentity: getString(row, "log_path"),
    ...(llmJSON === undefined ? {} : { llmJSON }),
    ...(ownerId === undefined ? {} : { ownerId }),
    ...(ownerPid === undefined ? {} : { ownerPid }),
    ...(prompt === undefined ? {} : { prompt }),
    queueRank: getNumber(row, "queue_rank"),
    state: parseBuildJobState(getString(row, "state")),
    ...(readingSummaryStartedAt === undefined
      ? {}
      : { readingSummaryStartedAt }),
    target: parseBuildJobTarget(getString(row, "target"), "target"),
    updatedAt: getNumber(row, "updated_at"),
    workspaceIdentity: getString(row, "workspace_path"),
  };
}

export async function hydrateBuildJob(job: StoredBuildJob): Promise<BuildJob> {
  const resources = getWikiGraphPlatform().resources;
  const [archive, cache, events, log, workspace] = await Promise.all([
    resources.getFile(job.archiveIdentity),
    resources.getDirectory(job.cacheIdentity),
    resources.getFile(job.eventsIdentity),
    resources.getDirectory(job.logIdentity),
    resources.getDirectory(job.workspaceIdentity),
  ]);
  if (archive === undefined)
    throw missingResource("archive", job.archiveIdentity);
  if (cache === undefined) throw missingResource("cache", job.cacheIdentity);
  if (events === undefined) throw missingResource("events", job.eventsIdentity);
  if (log === undefined) throw missingResource("log", job.logIdentity);
  if (workspace === undefined) {
    throw missingResource("workspace", job.workspaceIdentity);
  }
  const {
    archiveIdentity: _archiveIdentity,
    cacheIdentity: _cacheIdentity,
    eventsIdentity: _eventsIdentity,
    logIdentity: _logIdentity,
    ownerPid: _ownerPid,
    workspaceIdentity: _workspaceIdentity,
    ...metadata
  } = job;
  return { ...metadata, archive, cache, events, log, workspace };
}

function missingResource(kind: string, identity: string): Error {
  return new Error(`Build job ${kind} resource is unavailable: ${identity}`);
}

function parseBuildJobState(value: string): BuildJobState {
  if (BUILD_JOB_STATES.includes(value as BuildJobState)) {
    return value as BuildJobState;
  }

  throw new Error(`Invalid build job state: ${value}`);
}

export function parseBuildJobTarget(
  value: string,
  field: string,
): BuildJobTarget {
  if (
    value === "index-embedding-source" ||
    value === "index-embedding-summary" ||
    value === "index-fts" ||
    value === "reading-graph" ||
    value === "knowledge-graph" ||
    value === "reading-summary"
  ) {
    return value;
  }

  throw new Error(`Invalid ${field}: ${value}`);
}

function parseOptionalBuildJobTarget(
  value: string | undefined,
  field: string,
): BuildJobTarget | undefined {
  return value === undefined ? undefined : parseBuildJobTarget(value, field);
}

export function formatBuildJobLane(target: BuildJobTarget): string {
  if (target === "knowledge-graph") {
    return "knowledge-graph";
  }
  if (target.startsWith("index-")) {
    return target;
  }

  return "reading";
}

export function getString(row: Record<string, unknown>, key: string): string {
  const value = row[key];

  if (typeof value !== "string") {
    throw new TypeError(`Expected ${key} to be a string`);
  }

  return value;
}

export function getNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];

  if (typeof value !== "number") {
    throw new TypeError(`Expected ${key} to be a number`);
  }

  return value;
}

export function getOptionalString(
  row: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = row[key];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError(`Expected ${key} to be a string`);
  }

  return value;
}
