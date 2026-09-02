import type { BuildJob, ChapterEntry } from "wiki-graph-core";

import {
  formatCLIJSON,
  formatCliCommand,
  writeTextToStdout,
} from "../../support/index.js";
import {
  formatQueueAddEstimateJSON,
  formatQueueAddEstimateLines,
  type QueueAddEstimate,
} from "./estimate.js";
import { getNodeResourcePath } from "../../runtime/node-platform.js";

export async function writeJobList(
  jobs: readonly BuildJob[],
  options: { readonly json: boolean },
): Promise<void> {
  if (options.json) {
    await writeTextToStdout(formatCLIJSON({ items: jobs.map(formatJobJSON) }));
    return;
  }

  if (jobs.length === 0) {
    await writeTextToStdout("No jobs.\n");
    return;
  }

  await writeTextToStdout(
    `${formatJobListHeader()}\n${jobs
      .map(
        (job) =>
          `${job.jobId.slice(0, 8).padEnd(8)} ${job.state.padEnd(9)} ${(job.currentStep ?? "-").padEnd(7)} ${job.target.padEnd(7)} ${job.chapterId.toString().padStart(7)} ${formatArchiveName(requireJobResourcePath(job, "archive", "archivePath"))}`,
      )
      .join("\n")}\n`,
  );
}

function formatJobListHeader(): string {
  return `${"JOB".padEnd(8)} ${"STATE".padEnd(9)} ${"STEP".padEnd(7)} ${"TARGET".padEnd(7)} ${"CHAPTER".padStart(7)} ARCHIVE`;
}

export async function writeJobStatus(
  job: BuildJob,
  options: { readonly json: boolean },
): Promise<void> {
  if (options.json) {
    await writeTextToStdout(formatCLIJSON(formatJobJSON(job)));
    return;
  }

  await writeTextToStdout(
    [
      `Job: ${job.jobId}`,
      `State: ${job.state}`,
      `Archive: ${requireJobResourcePath(job, "archive", "archivePath")}`,
      `Chapter: ${job.chapterId}`,
      `Target: ${job.target}`,
      `Step: ${job.currentStep ?? "-"}`,
      `Workspace: ${getJobResourcePath(job, "workspace", "workspacePath") ?? "-"}`,
      `Cache: ${getJobResourcePath(job, "cache", "cachePath") ?? "-"}`,
      `Logs: ${getJobResourcePath(job, "log", "logPath") ?? "-"}`,
      ...(job.errorJSON === undefined ? [] : [`Error: ${job.errorJSON}`]),
    ].join("\n") + "\n",
  );
}

function formatJobJSON(job: BuildJob): Record<string, unknown> {
  return {
    archiveKey: job.archiveKey,
    archivePath: getJobResourcePath(job, "archive", "archivePath"),
    cachePath: getJobResourcePath(job, "cache", "cachePath"),
    chapterId: job.chapterId,
    createdAt: job.createdAt,
    ...(job.currentStep === undefined ? {} : { currentStep: job.currentStep }),
    ...(job.errorJSON === undefined ? {} : { errorJSON: job.errorJSON }),
    eventsPath: getJobResourcePath(job, "events", "eventsPath"),
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
    jobId: job.jobId,
    logPath: getJobResourcePath(job, "log", "logPath"),
    ...(job.llmJSON === undefined
      ? {}
      : { llm: formatJobLLMJSON(job.llmJSON) }),
    ...(job.ownerId === undefined ? {} : { ownerId: job.ownerId }),
    ...(job.prompt === undefined ? {} : { prompt: job.prompt }),
    queueRank: job.queueRank,
    state: job.state,
    ...(job.readingSummaryStartedAt === undefined
      ? {}
      : { readingSummaryStartedAt: job.readingSummaryStartedAt }),
    target: job.target,
    updatedAt: job.updatedAt,
    workspacePath: getJobResourcePath(job, "workspace", "workspacePath"),
  };
}

export function formatJobQueuedNotice(job: BuildJob): string | undefined {
  if (job.state !== "queued") {
    return undefined;
  }

  return "Job is queued; the requested artifact or generated data is not ready until the job succeeds.";
}

function formatJobLLMJSON(value: string): unknown {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return {
      configured: true,
      invalid: true,
    };
  }

  const llm = readJobLLMObject(parsed);

  return {
    configured: true,
    ...(readOptionalString(llm, "provider") === undefined
      ? {}
      : { provider: readOptionalString(llm, "provider") }),
    ...(readOptionalString(llm, "model") === undefined
      ? {}
      : { model: readOptionalString(llm, "model") }),
    ...(readOptionalString(llm, "name") === undefined
      ? {}
      : { name: readOptionalString(llm, "name") }),
    hasApiKey: readOptionalString(llm, "apiKey") !== undefined,
    hasBaseURL:
      readOptionalString(llm, "baseURL") !== undefined ||
      readOptionalString(llm, "baseUrl") !== undefined ||
      readOptionalString(llm, "chatCompletionsUrl") !== undefined,
  };
}

function readJobLLMObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  const nested = value.llm;

  return isRecord(nested) ? nested : value;
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const field = value[key];

  return typeof field === "string" && field !== "" ? field : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function writeJobSummary(
  job: BuildJob,
  options: {
    readonly estimate?: QueueAddEstimate;
    readonly json: boolean;
    readonly watch?: boolean;
  } = { json: false },
): Promise<void> {
  if (options.json) {
    await writeTextToStdout(
      formatCLIJSON({
        ...formatJobJSON(job),
        ...(formatJobQueuedNotice(job) === undefined
          ? {}
          : { notice: formatJobQueuedNotice(job) }),
        ...(options.estimate === undefined
          ? {}
          : { estimate: formatQueueAddEstimateJSON(options.estimate) }),
        ...(options.watch === true
          ? {
              watchCommand: formatCliCommand([
                `wikg://local/job/${job.jobId}`,
                "watch",
              ]),
            }
          : {}),
      }),
    );
    return;
  }

  await writeTextToStdout(
    [
      `Job ${job.jobId} ${job.state} ${job.target} chapter ${job.chapterId} ${requireJobResourcePath(job, "archive", "archivePath")}`,
      ...(formatJobQueuedNotice(job) === undefined
        ? []
        : [formatJobQueuedNotice(job)!]),
      ...(options.watch === true
        ? [
            `Watch: ${formatCliCommand([
              `wikg://local/job/${job.jobId}`,
              "watch",
            ])}`,
          ]
        : []),
      ...(options.estimate === undefined
        ? []
        : ["", ...formatQueueAddEstimateLines(options.estimate)]),
      "",
    ].join("\n"),
  );
}

export async function writeArchiveAddSummary(input: {
  readonly created: readonly {
    readonly chapter: ChapterEntry;
    readonly job: BuildJob;
  }[];
  readonly estimate?: QueueAddEstimate;
  readonly json: boolean;
  readonly skipped: readonly {
    readonly chapterId: number;
    readonly reason: string;
  }[];
}): Promise<void> {
  if (input.json) {
    await writeTextToStdout(
      formatCLIJSON({
        created: input.created.map((item) => formatJobJSON(item.job)),
        ...(input.estimate === undefined
          ? {}
          : { estimate: formatQueueAddEstimateJSON(input.estimate) }),
        skipped: input.skipped,
      }),
    );
    return;
  }

  const lines = [
    `Created: ${input.created.length}`,
    `Skipped: ${input.skipped.length}`,
  ];

  for (const job of input.created) {
    lines.push(
      `Job ${job.job.jobId} ${job.job.state} ${job.job.target} chapter ${job.job.chapterId}`,
    );
  }
  for (const skipped of input.skipped) {
    lines.push(`Skipped chapter ${skipped.chapterId}: ${skipped.reason}`);
  }
  if (input.estimate !== undefined) {
    lines.push("", ...formatQueueAddEstimateLines(input.estimate));
  }

  await writeTextToStdout(`${lines.join("\n")}\n`);
}

function formatArchiveName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

function getJobResourcePath(
  job: BuildJob,
  resourceKey: "archive" | "cache" | "events" | "log" | "workspace",
  legacyKey:
    | "archivePath"
    | "cachePath"
    | "eventsPath"
    | "logPath"
    | "workspacePath",
): string | undefined {
  const record = job as unknown as Record<string, unknown>;
  const resource = record[resourceKey];
  if (resource !== undefined) {
    return getNodeResourcePath(resource as BuildJob[typeof resourceKey]);
  }
  const legacyPath = record[legacyKey];
  if (typeof legacyPath === "string") return legacyPath;
  return undefined;
}

function requireJobResourcePath(
  job: BuildJob,
  resourceKey: "archive" | "cache" | "events" | "log" | "workspace",
  legacyKey:
    | "archivePath"
    | "cachePath"
    | "eventsPath"
    | "logPath"
    | "workspacePath",
): string {
  const path = getJobResourcePath(job, resourceKey, legacyKey);
  if (path !== undefined) return path;
  throw new TypeError(`Build job is missing ${resourceKey}`);
}
