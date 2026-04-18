import { SpineDigestApp } from "../index.js";
import type { SpineDigest } from "../facade/index.js";
import type { TocFile, TocItem } from "../source/index.js";

import type { CLISdpubArguments } from "./args.js";
import { writeBinaryToStdout, writeTextToStdout } from "./io.js";

export async function runSdpubCommand(args: CLISdpubArguments): Promise<void> {
  const app = new SpineDigestApp({});

  await app.openSession(args.inputPath, async (digest) => {
    switch (args.subcommand) {
      case "info":
        await writeSdpubInfo(digest);
        return;
      case "toc":
        await writeSdpubToc(digest);
        return;
      case "list":
        await writeSdpubSerialList(digest);
        return;
      case "cat":
        await writeTextToStdout(await digest.readSerialSummary(args.serialId!));
        return;
      case "cover":
        await writeSdpubCover(digest);
        return;
    }
  });
}

async function writeSdpubInfo(digest: SpineDigest): Promise<void> {
  const [meta, cover, toc, serials] = await Promise.all([
    digest.readMeta(),
    digest.readCover(),
    digest.readToc(),
    digest.listSerials().catch((error: unknown) => {
      if (
        error instanceof Error &&
        error.message === "Document TOC is missing"
      ) {
        return [];
      }

      throw error;
    }),
  ]);
  const lines: string[] = [];

  appendOptionalLine(lines, "Title", meta?.title);
  if (meta?.authors.length !== undefined && meta.authors.length > 0) {
    lines.push(`Authors: ${meta.authors.join(", ")}`);
  }
  appendOptionalLine(lines, "Language", meta?.language);
  appendOptionalLine(lines, "Source Format", meta?.sourceFormat);
  appendOptionalLine(lines, "Identifier", meta?.identifier);
  appendOptionalLine(lines, "Publisher", meta?.publisher);
  appendOptionalLine(lines, "Published At", meta?.publishedAt);
  appendOptionalLine(lines, "Description", meta?.description);
  lines.push(`Cover: ${cover === undefined ? "no" : "yes"}`);
  appendOptionalLine(lines, "Cover Media Type", cover?.mediaType);
  appendOptionalLine(lines, "Cover Path", cover?.path);

  if (toc !== undefined) {
    if (lines.length > 0) {
      lines.push("");
    }

    lines.push(`Top-level Sections: ${toc.items.length}`);
    lines.push(`Referenced Serials: ${serials.length}`);
    lines.push(
      `Fragments: ${serials.reduce(
        (total, serial) => total + serial.fragmentCount,
        0,
      )}`,
    );
  }

  if (lines.length === 0) {
    lines.push("No document metadata is available.");
  }

  await writeTextToStdout(`${lines.join("\n")}\n`);
}

async function writeSdpubToc(digest: SpineDigest): Promise<void> {
  const [meta, toc] = await Promise.all([
    digest.readMeta(),
    requireToc(digest),
  ]);
  const lines: string[] = [];
  const title = normalizeDisplayValue(meta?.title);

  if (title !== undefined) {
    lines.push(title, "");
  }

  const tocLines = renderTocLines(toc.items);

  if (tocLines.length === 0) {
    lines.push("No TOC items.");
  } else {
    lines.push(...tocLines);
  }

  await writeTextToStdout(`${lines.join("\n")}\n`);
}

async function writeSdpubSerialList(digest: SpineDigest): Promise<void> {
  const serials = await digest.listSerials();

  if (serials.length === 0) {
    await writeTextToStdout("No serials referenced by TOC.\n");
    return;
  }

  await writeTextToStdout(
    `${serials
      .map(
        (serial) =>
          `[${serial.serialId}] ${serial.tocPath.join(" / ")} (fragments: ${serial.fragmentCount})`,
      )
      .join("\n")}\n`,
  );
}

async function writeSdpubCover(digest: SpineDigest): Promise<void> {
  if (process.stdout.isTTY === true) {
    throw new Error(
      "Refusing to write binary cover data to an interactive terminal. Redirect stdout or pipe it.",
    );
  }

  const cover = await digest.readCover();

  if (cover === undefined) {
    throw new Error("Document cover is missing.");
  }

  await writeBinaryToStdout(cover.data);
}

function appendOptionalLine(
  lines: string[],
  label: string,
  value: string | null | undefined,
): void {
  const normalized = normalizeDisplayValue(value);

  if (normalized !== undefined) {
    lines.push(`${label}: ${normalized}`);
  }
}

function normalizeDisplayValue(
  value: string | null | undefined,
): string | undefined {
  const normalized = value?.trim();

  return normalized === undefined || normalized === "" ? undefined : normalized;
}

async function requireToc(digest: SpineDigest): Promise<TocFile> {
  const toc = await digest.readToc();

  if (toc === undefined) {
    throw new Error("Document TOC is missing");
  }

  return toc;
}

function renderTocLines(
  items: readonly TocItem[],
  depth = 0,
): readonly string[] {
  const lines: string[] = [];

  for (const item of items) {
    lines.push(
      `${"  ".repeat(depth)}${item.title}${
        item.serialId === undefined ? "" : ` [serial ${item.serialId}]`
      }`,
    );
    lines.push(...renderTocLines(item.children, depth + 1));
  }

  return lines;
}
