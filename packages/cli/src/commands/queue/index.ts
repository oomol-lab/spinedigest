import {
  boostBuildJob,
  cancelBuildJob,
  cleanBuildJobs,
  formatLocatedChapterUri,
  formatLocatedWikiGraphUri,
  getBuildJob,
  listBuildJobs,
  pauseBuildJob,
  resolveChapterPathReadonly,
  resolveBuildJobId,
  resumeBuildJob,
  updateBuildJobTarget,
  WikiGraphArchiveFile,
} from "wiki-graph-core";

import type { CLIQueueArguments } from "../../args/index.js";
import { loadCLIConfig } from "../../runtime/config.js";
import { loadRequiredStageConfig } from "../../runtime/index.js";
import { writeTextToStdout } from "../../support/index.js";
import {
  addArchiveJobs,
  addChapterJob,
  assertBuildCostAccepted,
  assertQueueAddReady,
  readQueueAddChapter,
  tryStartQueueWorker,
} from "./add.js";
import { createQueueAddEstimate } from "./estimate.js";
import { writeJobList, writeJobStatus, writeJobSummary } from "./output.js";
import { watchBuildJob } from "./watch.js";
import { requireKnowledgeGraphWikispineConfig } from "./worker.js";
import { resolveArchiveChapterScope } from "../archive-command/run/scope.js";

export { runQueueWorker } from "./worker.js";

export async function runQueueCommand(args: CLIQueueArguments): Promise<void> {
  switch (args.action) {
    case "add": {
      const chapterIds = await resolveQueueChapterIds(args);
      const singleChapterId =
        chapterIds?.length === 1 ? chapterIds[0]! : undefined;
      if (singleChapterId !== undefined) {
        await assertQueueAddReady(args, singleChapterId);
      }
      const target = args.target ?? "reading-summary";
      if (target !== "index-fts") {
        assertBuildCostAccepted(args);
      }
      const config = requiresLLMConfig(target)
        ? await loadRequiredStageConfig({
            ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
          })
        : await loadCLIConfig({
            ...(args.llmJSON === undefined ? {} : { llmJSON: args.llmJSON }),
          });
      if (
        (target === "index-embedding-source" ||
          target === "index-embedding-summary") &&
        config.embedding === undefined
      ) {
        throw new Error(
          "Missing embeddings configuration. Configure `wikg://local/config/embeddings` before queueing embedding index artifact jobs.",
        );
      }
      if (args.target === "knowledge-graph") {
        requireKnowledgeGraphWikispineConfig(config);
      }

      if (chapterIds === undefined) {
        await addArchiveJobs(args, config);
      } else if (chapterIds.length === 1) {
        const chapterId = chapterIds[0]!;
        const chapter = await readQueueAddChapter(args, chapterId);
        const estimate = createQueueAddEstimate({
          chapters: [chapter],
          config,
          target: args.target ?? "reading-summary",
        });

        await writeJobSummary(await addChapterJob(args, chapterId), {
          estimate,
          json: args.json ?? false,
          watch: true,
        });
      } else {
        await addArchiveJobs({ ...args, chapterIds }, config);
      }

      tryStartQueueWorker();
      return;
    }
    case "list":
      await writeJobList(
        await listBuildJobs({
          ...(args.activeOnly === undefined
            ? {}
            : { activeOnly: args.activeOnly }),
          ...(args.all === undefined ? {} : { all: args.all }),
          ...(args.archivePath === undefined
            ? {}
            : { archivePath: args.archivePath }),
        }),
        { json: args.json ?? false },
      );
      return;
    case "status":
      await writeJobStatus(await getBuildJob(await resolveQueueJobId(args)), {
        json: args.json ?? false,
      });
      return;
    case "watch":
      await watchBuildJob(await resolveQueueJobId(args), {
        from: args.from ?? "beginning",
        jsonl: args.jsonl ?? !process.stdout.isTTY,
      });
      return;
    case "pause":
      await writeJobSummary(await pauseBuildJob(await resolveQueueJobId(args)));
      return;
    case "resume":
      await writeJobSummary(
        await resumeBuildJob(await resolveQueueJobId(args)),
      );
      tryStartQueueWorker();
      return;
    case "cancel":
      await writeJobSummary(
        await cancelBuildJob(await resolveQueueJobId(args)),
      );
      return;
    case "boost":
      await writeJobSummary(await boostBuildJob(await resolveQueueJobId(args)));
      tryStartQueueWorker();
      return;
    case "target":
      await writeJobSummary(
        await updateBuildJobTarget(
          await resolveQueueJobId(args),
          args.target ?? "reading-summary",
        ),
      );
      tryStartQueueWorker();
      return;
    case "clean":
      await writeTextToStdout(`Cleaned ${await cleanBuildJobs()} jobs.\n`);
      return;
  }
}

function requiresLLMConfig(target: NonNullable<CLIQueueArguments["target"]>) {
  return (
    target === "knowledge-graph" ||
    target === "reading-graph" ||
    target === "reading-summary"
  );
}

async function resolveQueueJobId(args: CLIQueueArguments): Promise<string> {
  return await resolveBuildJobId(args.jobId!);
}

async function resolveQueueChapterIds(
  args: CLIQueueArguments,
): Promise<readonly number[] | undefined> {
  if (args.chapterId !== undefined) {
    return [args.chapterId];
  }
  if (args.chapterPath === undefined && args.depth === undefined) {
    return undefined;
  }

  let chapterIds: readonly number[] | undefined;
  await new WikiGraphArchiveFile(args.archivePath!).readDocument(
    async (document) => {
      if (args.chapterPath === undefined) {
        chapterIds = (
          await resolveArchiveChapterScope(document, {
            archivePath: formatLocatedWikiGraphUri(
              args.archivePath!,
              "wikg://chapter",
            ),
            ...(args.depth === undefined ? {} : { depth: args.depth }),
          })
        )?.chapterIds;
        return;
      }
      chapterIds = (
        await resolveArchiveChapterScope(document, {
          archivePath: formatLocatedChapterUri(
            args.archivePath!,
            args.chapterPath,
          ),
          ...(args.depth === undefined ? {} : { depth: args.depth }),
        })
      )?.chapterIds ?? [
        await resolveChapterPathReadonly(document, args.chapterPath),
      ];
    },
  );
  return chapterIds;
}
