import {
  isDirectory,
  readFileText,
  type Directory,
} from "../../../../../runtime/platform/index.js";
import type { LegacyFragmentFile, LegacyFragmentRecord } from "./types.js";

export async function listLegacySourceSerials(
  workspace: Directory,
): Promise<readonly number[]> {
  const fragments = await workspace.getDirectory("fragments");
  if (fragments === undefined) return [];
  const serialIds: number[] = [];
  for (const entry of await fragments.list()) {
    if (!isDirectory(entry)) continue;
    const match = /^serial-(\d+)$/u.exec(entry.name);
    if (match !== null) serialIds.push(Number(match[1]));
  }
  return serialIds.sort((left, right) => left - right);
}

export async function readLegacySourceFragments(
  workspace: Directory,
  serialId: number,
): Promise<readonly LegacyFragmentRecord[]> {
  const fragments = await workspace.getDirectory("fragments");
  const serial = await fragments?.getDirectory(`serial-${serialId}`);
  if (serial === undefined) return [];
  const records: LegacyFragmentRecord[] = [];
  for (const entry of await serial.list()) {
    if (isDirectory(entry)) continue;
    const match = /^fragment_(\d+)\.json$/u.exec(entry.name);
    if (match === null) continue;
    const content = parseLegacyFragmentFile(await readFileText(entry));
    records.push({
      content,
      fragmentId: Number(match[1]),
      signature: createLegacyFragmentSignature(content),
    });
  }
  return records.sort((left, right) => left.fragmentId - right.fragmentId);
}

function parseLegacyFragmentFile(content: string): LegacyFragmentFile {
  const parsed = JSON.parse(content) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError("Legacy fragment file must contain sentences.");
  }
  const raw = parsed as Record<string, unknown>;
  if (!Array.isArray(raw.sentences)) {
    throw new TypeError("Legacy fragment file must contain sentences.");
  }
  const sentences = raw.sentences.map((sentence) => {
    if (
      typeof sentence !== "object" ||
      sentence === null ||
      typeof (sentence as Record<string, unknown>).text !== "string"
    ) {
      throw new TypeError("Legacy fragment sentence must contain text.");
    }
    const value = sentence as Record<string, unknown>;
    const text = value.text as string;
    return {
      text,
      wordsCount:
        typeof value.wordsCount === "number"
          ? value.wordsCount
          : countWords(text),
    };
  });
  return {
    sentences,
    summary: typeof raw.summary === "string" ? raw.summary : "",
  };
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

function createLegacyFragmentSignature(fragment: LegacyFragmentFile): string {
  return JSON.stringify(fragment.sentences.map((sentence) => sentence.text));
}

export function createDuplicateHalfCanonicalizationPlan(
  fragments: readonly LegacyFragmentRecord[],
):
  | {
      readonly canonicalFragments: readonly LegacyFragmentRecord[];
      readonly fragmentIdMap: ReadonlyMap<number, number>;
    }
  | undefined {
  if (fragments.length < 2 || fragments.length % 2 !== 0) return undefined;
  const halfLength = fragments.length / 2;
  const leftHalf = fragments.slice(0, halfLength);
  const rightHalf = fragments.slice(halfLength);
  for (let index = 0; index < halfLength; index += 1) {
    if (leftHalf[index]?.signature !== rightHalf[index]?.signature)
      return undefined;
  }
  const source = rightHalf.some(
    (fragment) => fragment.content.summary.trim() !== "",
  )
    ? rightHalf
    : leftHalf;
  const fragmentIdMap = new Map<number, number>();
  const canonicalFragments = source.map((fragment, index) => {
    const left = leftHalf[index];
    const right = rightHalf[index];
    if (left !== undefined) fragmentIdMap.set(left.fragmentId, index);
    if (right !== undefined) fragmentIdMap.set(right.fragmentId, index);
    return { ...fragment, fragmentId: index };
  });
  return { canonicalFragments, fragmentIdMap };
}
