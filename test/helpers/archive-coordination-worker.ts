import process from "process";

import { DirectoryDocument } from "../../packages/core/src/document/index.js";
import { WikgCoordinator } from "../../packages/core/src/storage/wikg/coordinator.js";
import {
  installNodeWikiGraphPlatform,
  NodeFile,
} from "../../packages/cli/src/runtime/node-platform.js";

const [archivePath, stateRoot, action] = process.argv.slice(2);
if (
  archivePath === undefined ||
  stateRoot === undefined ||
  action === undefined
) {
  throw new Error("Expected archive path, state root, and worker action");
}

installNodeWikiGraphPlatform(stateRoot);
const archive = new NodeFile(archivePath);
const coordinator = new WikgCoordinator();

await run();

async function run(): Promise<void> {
  if (action === "database") {
    await coordinator.withArchiveSession(archive, async (session) => {
      const document = await DirectoryDocument.openFileStore(
        session.createFileStore(),
      );
      send({ type: "ready" });
      await waitFor("write");
      const serialId = await document.createSerial();
      send({ serialId, type: "published" });
      const command = await waitFor("finish", "crash");
      if (command === "crash") process.exit(0);
      await document.release();
    });
    send({ type: "done" });
    return;
  }

  if (action === "observe-meta") {
    await coordinator.withArchiveSession(archive, async (session) => {
      const content = await session.readEntry("cover/info.json");
      const title =
        content === undefined
          ? undefined
          : (
              JSON.parse(new TextDecoder().decode(content)) as {
                title?: string;
              }
            ).title;
      send({ title, type: "observed" });
      await waitFor("finish");
    });
    send({ type: "done" });
    return;
  }

  await coordinator.withArchiveSession(archive, async (session) => {
    send({ type: "ready" });
    await waitFor("write");
    if (action === "meta") {
      await session.writeEntry(
        "cover/info.json",
        `${JSON.stringify({ title: "Written by metadata worker" })}\n`,
        { overwrite: true },
      );
    } else if (action === "toc") {
      await session.writeEntry(
        "toc.json",
        `${JSON.stringify({ items: [{ children: [], key: "chapter", serialId: 1, title: "Written by TOC worker" }], version: 1 })}\n`,
        { overwrite: true },
      );
    } else if (action === "delete-summary") {
      await session.deleteEntry("texts/summary/1.txt");
    } else {
      throw new Error(`Unsupported worker action: ${action}`);
    }
    send({ type: "published" });
    const command = await waitFor("finish", "crash");
    if (command === "crash") process.exit(0);
  });
  send({ type: "done" });
}

function send(message: Readonly<Record<string, unknown>>): void {
  process.send?.(message);
}

async function waitFor(...expected: readonly string[]): Promise<string> {
  return await new Promise((resolve) => {
    const listener = (message: unknown) => {
      if (
        typeof message !== "object" ||
        message === null ||
        !("type" in message) ||
        typeof message.type !== "string" ||
        !expected.includes(message.type)
      ) {
        return;
      }
      process.off("message", listener);
      resolve(message.type);
    };
    process.on("message", listener);
  });
}
