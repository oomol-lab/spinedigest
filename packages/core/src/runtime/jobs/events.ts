import { appendFileText, readFileText } from "../platform/index.js";
import type { BuildJob, BuildJobEvent } from "./types.js";

export async function readBuildJobEvents(
  job: Pick<BuildJob, "events">,
): Promise<BuildJobEvent[]> {
  let content: string;

  try {
    content = await readFileText(job.events);
  } catch {
    return [];
  }

  return content
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as BuildJobEvent);
}

export async function appendBuildJobEvent(
  job: Pick<BuildJob, "events" | "jobId">,
  event: BuildJobEvent,
): Promise<void> {
  const seq = (await readLastBuildJobEventSeq(job)) + 1;
  const nextEvent = {
    ...event,
    jobId: job.jobId,
    seq,
  };

  await appendFileText(job.events, `${JSON.stringify(nextEvent)}\n`);
}

async function readLastBuildJobEventSeq(
  job: Pick<BuildJob, "events">,
): Promise<number> {
  const events = await readBuildJobEvents(job);

  return events.at(-1)?.seq ?? 0;
}
