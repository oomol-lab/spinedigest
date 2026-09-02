import type { Database } from "../../document/index.js";
import {
  getNumber,
  getOptionalString,
  hydrateBuildJob,
  mapBuildJob,
} from "./row.js";
import { markBuildJobCanceled, markBuildJobFailedInState } from "./state.js";
import { removeJobWorkspace } from "./paths.js";

const WORKER_LEASE_STALE_MS = 20_000;

export async function recoverStaleBuildJobs(state: Database): Promise<void> {
  const workspaceJobIdsToDelete: string[] = [];

  await state.transaction(async () => {
    const lease = await state.queryOne(
      "SELECT owner_id, heartbeat_at FROM build_worker_lease WHERE id = 1",
      undefined,
      (row) => ({
        heartbeatAt:
          row.heartbeat_at === null
            ? undefined
            : getNumber(row, "heartbeat_at"),
        ownerId: getOptionalString(row, "owner_id"),
      }),
    );
    const activeOwnerId =
      lease?.ownerId !== undefined &&
      lease.heartbeatAt !== undefined &&
      Date.now() - lease.heartbeatAt <= WORKER_LEASE_STALE_MS
        ? lease.ownerId
        : undefined;
    const storedJobs = await state.queryAll(
      `
SELECT *
FROM build_jobs
WHERE state IN ('running', 'canceling')
  AND owner_id IS NOT NULL
`,
      undefined,
      mapBuildJob,
    );
    const jobs = await Promise.all(storedJobs.map(hydrateBuildJob));

    for (const job of jobs) {
      if (job.ownerId === activeOwnerId) {
        continue;
      }

      if (job.state === "canceling") {
        await markBuildJobCanceled(state, job);
        continue;
      }

      await markBuildJobFailedInState(state, job, {
        message: "Build worker lease expired before finishing the job.",
        name: "BuildJobWorkerLost",
      });
      workspaceJobIdsToDelete.push(job.jobId);
    }
  });

  for (const jobId of workspaceJobIdsToDelete) {
    await removeJobWorkspace(jobId);
  }
}
