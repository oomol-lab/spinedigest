import {
  ensureRelativeDirectory,
  ensureRelativeFile,
  getWikiGraphStorage,
  type Directory,
  type File,
} from "../platform/index.js";

export async function createJobWorkspace(jobId: string): Promise<Directory> {
  return await ensureRelativeDirectory(
    getWikiGraphStorage().library,
    `jobs/work/${jobId}`,
  );
}

export async function createJobCache(jobId: string): Promise<Directory> {
  return await ensureRelativeDirectory(
    getWikiGraphStorage().library,
    `jobs/cache/${jobId}`,
  );
}

export async function createJobLog(jobId: string): Promise<Directory> {
  return await ensureRelativeDirectory(
    getWikiGraphStorage().library,
    `jobs/logs/${jobId}`,
  );
}

export async function createJobEvents(jobId: string): Promise<File> {
  return await ensureRelativeFile(
    getWikiGraphStorage().library,
    `jobs/events/${jobId}.ndjson`,
  );
}

export async function getBuildJobWorkspaceRoot(): Promise<Directory> {
  return await ensureRelativeDirectory(
    getWikiGraphStorage().library,
    "jobs/work",
  );
}

export async function removeJobResources(jobId: string): Promise<void> {
  const jobs = await getWikiGraphStorage().library.getDirectory("jobs");
  if (jobs === undefined) return;
  for (const [parentName, childName, recursive] of [
    ["work", jobId, true],
    ["cache", jobId, true],
    ["logs", jobId, true],
    ["events", `${jobId}.ndjson`, false],
  ] as const) {
    const parent = await jobs.getDirectory(parentName);
    if (parent !== undefined) await parent.remove(childName, { recursive });
  }
}

export async function removeJobWorkspace(jobId: string): Promise<void> {
  const jobs = await getWikiGraphStorage().library.getDirectory("jobs");
  const work = await jobs?.getDirectory("work");
  if (work !== undefined) await work.remove(jobId, { recursive: true });
}
