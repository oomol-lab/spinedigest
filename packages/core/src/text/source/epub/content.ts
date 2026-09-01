import { parseDocument } from "htmlparser2";

import { countTextWords } from "../../../utils/text-word-count.js";
import type {
  SourceArtifactInput,
  SourceTextMappingInput,
} from "../../../document/types.js";
import type { SourceSectionContent, SourceTextStream } from "../types.js";
import type { EpubArchive } from "./archive.js";

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);

const SKIPPED_TAGS = new Set(["script", "style"]);
const EMPTY_LOCATOR: Readonly<Record<string, unknown>> = {};

export interface EpubSectionTarget {
  readonly id: string;
  readonly path: string;
  readonly fragment: string | undefined;
  readonly spineIndex?: number | undefined;
}

export interface EpubSectionAnalysis {
  readonly hasContent: boolean;
  readonly wordsCount: number;
}

interface TextSegment {
  readonly locator: Readonly<Record<string, unknown>>;
  readonly text: string;
}

interface ParsedSectionContent {
  readonly segments: readonly TextSegment[];
  readonly text: string;
}

interface HtmlNode {
  readonly attribs?: Readonly<Record<string, string>>;
  readonly children?: readonly HtmlNode[];
  readonly data?: string;
  readonly name?: string;
  readonly type?: string;
}

export class EpubContentLoader {
  readonly #archive: EpubArchive;
  readonly #targetsBySectionId: ReadonlyMap<
    string,
    {
      readonly path: string;
      readonly targets: readonly EpubSectionTarget[];
    }
  >;

  public constructor(
    archive: EpubArchive,
    targetsByPath: ReadonlyMap<string, readonly EpubSectionTarget[]>,
  ) {
    this.#archive = archive;
    this.#targetsBySectionId = createTargetsBySectionId(targetsByPath);
  }

  public async openSection(sectionId: string): Promise<SourceTextStream> {
    const target = this.#targetsBySectionId.get(sectionId);

    if (target === undefined) {
      return [];
    }

    const sections = await this.#parseSections(target.path, target.targets);

    return [sections.get(sectionId) ?? ""];
  }

  public async openSectionWithProvenance(
    sectionId: string,
    artifact: SourceArtifactInput,
  ): Promise<SourceSectionContent> {
    const target = this.#targetsBySectionId.get(sectionId);

    if (target === undefined) {
      return { stream: [] };
    }

    const spineIndex = target.targets.find(
      (candidate) => candidate.id === sectionId,
    )?.spineIndex;
    if (spineIndex === undefined) {
      throw new Error(
        `EPUB section ${sectionId} is not associated with a spine item.`,
      );
    }

    const html = await this.#archive.readText(target.path);
    const parsed = parseHtmlSectionContent(html, target.targets, sectionId);
    const mappings = createProvenanceMappings(parsed.segments, artifact.digest);

    return {
      provenance: {
        artifacts: [artifact],
        mappings,
      },
      stream: [parsed.text],
    };
  }

  async #parseSections(
    path: string,
    targets: readonly EpubSectionTarget[],
  ): Promise<ReadonlyMap<string, string>> {
    const html = await readArchiveText(this.#archive, path);

    return parseHtmlSectionTexts(html, targets);
  }
}

export async function analyzeSectionTargets(
  archive: Pick<EpubArchive, "openReadStream">,
  targetsByPath: ReadonlyMap<string, readonly EpubSectionTarget[]>,
): Promise<ReadonlyMap<string, EpubSectionAnalysis>> {
  const analyses = new Map<string, EpubSectionAnalysis>();

  for (const [path, targets] of targetsByPath.entries()) {
    const html = await readArchiveText(archive, path);
    const sections = parseHtmlSectionTexts(html, targets);

    for (const target of targets) {
      const text = sections.get(target.id) ?? "";

      analyses.set(target.id, {
        hasContent: text.trim() !== "",
        wordsCount: countTextWords(text),
      });
    }
  }

  return analyses;
}

function createTargetsBySectionId(
  targetsByPath: ReadonlyMap<string, readonly EpubSectionTarget[]>,
): ReadonlyMap<
  string,
  {
    readonly path: string;
    readonly targets: readonly EpubSectionTarget[];
  }
> {
  const targetsBySectionId = new Map<
    string,
    {
      readonly path: string;
      readonly targets: readonly EpubSectionTarget[];
    }
  >();

  for (const [path, targets] of targetsByPath.entries()) {
    for (const target of targets) {
      targetsBySectionId.set(target.id, { path, targets });
    }
  }

  return targetsBySectionId;
}

async function readArchiveText(
  archive: Pick<EpubArchive, "openReadStream">,
  path: string,
): Promise<string> {
  const stream = await archive.openReadStream(path);
  stream.setEncoding("utf8");

  let text = "";
  for await (const chunk of stream as AsyncIterable<unknown>) {
    text += toTextChunk(chunk);
  }

  return text;
}

function parseHtmlSectionTexts(
  html: string,
  targets: readonly EpubSectionTarget[],
): ReadonlyMap<string, string> {
  const parsed = parseHtmlSections(html, targets, false);

  return new Map(
    [...parsed.entries()].map(
      ([index, content]) => [targets[index]!.id, content.text] as const,
    ),
  );
}

function parseHtmlSectionContent(
  html: string,
  targets: readonly EpubSectionTarget[],
  sectionId: string,
): ParsedSectionContent {
  const parsed = parseHtmlSections(html, targets, true);
  const targetIndex = targets.findIndex((target) => target.id === sectionId);
  const content = parsed.get(targetIndex);

  if (content === undefined) {
    throw new Error("EPUB section content could not be parsed.");
  }

  return content;
}

function parseHtmlSections(
  html: string,
  targets: readonly EpubSectionTarget[],
  withLocators: boolean,
): ReadonlyMap<number, ParsedSectionContent> {
  const fragments = new Map<string, number>();
  const sections = new Map<number, TextSegment[]>();
  const orderedTargets = [...targets];
  const rootSectionIndex =
    orderedTargets[0]?.fragment === undefined && orderedTargets[0] !== undefined
      ? 0
      : -1;
  let currentIndex = rootSectionIndex;

  orderedTargets.forEach((target, index) => {
    sections.set(index, []);
    if (target.fragment !== undefined && !fragments.has(target.fragment)) {
      fragments.set(target.fragment, index);
    }
  });

  const root = parseDocument(html, {
    decodeEntities: true,
  }) as unknown as HtmlNode;
  visitNode(root, "", undefined);

  return new Map(
    [...sections.entries()].map(([index, segments]) => {
      const normalized = normalizeMappedSegments(segments);
      return [
        index,
        {
          segments: normalized.segments,
          text: normalized.text,
        },
      ] as const;
    }),
  );

  function visitNode(
    node: HtmlNode,
    nodePath: string,
    elementPath: string | undefined,
  ): void {
    if (isTextNode(node)) {
      if (currentIndex < 0 || currentIndex >= orderedTargets.length) {
        return;
      }

      const text = node.data ?? "";
      if (text === "") {
        return;
      }

      const target = orderedTargets[currentIndex];
      const targetSpineIndex = target?.spineIndex;
      if (
        withLocators &&
        (targetSpineIndex === undefined || elementPath === undefined)
      ) {
        throw new Error(
          `EPUB section ${target?.id ?? "unknown"} cannot produce a CFI locator.`,
        );
      }

      const locator =
        withLocators && targetSpineIndex !== undefined
          ? createTextLocator(targetSpineIndex, nodePath, text)
          : EMPTY_LOCATOR;
      appendSegment(currentIndex, text, locator);
      return;
    }

    const tagName = getHtmlTagName(node);
    if (tagName === undefined) {
      visitChildren(node, nodePath);
      return;
    }
    if (SKIPPED_TAGS.has(tagName)) {
      return;
    }

    const path = nodePath;
    const anchorId = node.attribs?.id ?? node.attribs?.["xml:id"];
    if (anchorId !== undefined) {
      const nextIndex = fragments.get(anchorId);
      if (nextIndex !== undefined && nextIndex > currentIndex) {
        currentIndex = nextIndex;
      }
    }

    if (tagName === "br") {
      appendSynthetic(currentIndex, "\n", path);
    }

    visitChildren(node, path);

    if (BLOCK_TAGS.has(tagName)) {
      appendSynthetic(currentIndex, "\n\n", path);
    }
  }

  function visitChildren(node: HtmlNode, parentPath: string): void {
    let cfiIndex = 0;

    for (const child of node.children ?? []) {
      if (!isCfiNode(child)) {
        continue;
      }

      const childPath = appendCfiStep(parentPath, cfiIndex, isTextNode(child));
      cfiIndex += 1;
      visitNode(child, childPath, isTextNode(child) ? parentPath : childPath);
    }
  }

  function appendSegment(
    sectionIndex: number,
    text: string,
    locator: Readonly<Record<string, unknown>>,
  ): void {
    const segments = sections.get(sectionIndex);
    if (segments === undefined) {
      return;
    }

    segments.push({ locator, text });
  }

  function appendSynthetic(
    sectionIndex: number,
    text: string,
    elementPath: string,
  ): void {
    if (sectionIndex < 0 || sectionIndex >= orderedTargets.length) {
      return;
    }

    const target = orderedTargets[sectionIndex];
    const spineIndex = target?.spineIndex;
    if (withLocators && spineIndex === undefined) {
      throw new Error(
        `EPUB section ${target?.id ?? "unknown"} cannot produce a CFI locator.`,
      );
    }

    appendSegment(
      sectionIndex,
      text,
      withLocators && spineIndex !== undefined
        ? createPointLocator(spineIndex, elementPath)
        : EMPTY_LOCATOR,
    );
  }
}

function createProvenanceMappings(
  segments: readonly TextSegment[],
  artifactDigest: string,
): readonly SourceTextMappingInput[] {
  const mappings: SourceTextMappingInput[] = [];
  let sourceOffset = 0;

  for (const segment of segments) {
    const sourceStart = sourceOffset;
    sourceOffset += Array.from(segment.text).length;
    if (sourceStart === sourceOffset) {
      continue;
    }

    mappings.push({
      artifactDigest,
      locator: segment.locator,
      sourceEnd: sourceOffset,
      sourceStart,
    });
  }

  return mappings;
}

function normalizeMappedSegments(segments: readonly TextSegment[]): {
  readonly segments: readonly TextSegment[];
  readonly text: string;
} {
  const chars: Array<{
    readonly char: string;
    readonly locator: Readonly<Record<string, unknown>>;
  }> = [];

  for (const segment of segments) {
    const segmentChars = Array.from(segment.text);
    for (let index = 0; index < segmentChars.length; index += 1) {
      const char = segmentChars[index]!;
      if (char === "\r" && segmentChars[index + 1] === "\n") {
        chars.push({ char: "\n", locator: segment.locator });
        index += 1;
      } else {
        chars.push({ char, locator: segment.locator });
      }
    }
  }

  const collapsed: typeof chars = [];
  let newlineCount = 0;
  for (const item of chars) {
    if (item.char === "\n") {
      newlineCount += 1;
      if (newlineCount > 2) {
        continue;
      }
    } else {
      newlineCount = 0;
    }
    collapsed.push(item);
  }

  let start = 0;
  while (start < collapsed.length && collapsed[start]!.char.trim() === "") {
    start += 1;
  }
  let end = collapsed.length;
  while (end > start && collapsed[end - 1]!.char.trim() === "") {
    end -= 1;
  }

  const trimmed = collapsed.slice(start, end);
  const normalizedSegments: TextSegment[] = [];
  for (const item of trimmed) {
    const previous = normalizedSegments.at(-1);
    if (previous !== undefined && previous.locator === item.locator) {
      normalizedSegments[normalizedSegments.length - 1] = {
        locator: previous.locator,
        text: previous.text + item.char,
      };
    } else {
      normalizedSegments.push({ locator: item.locator, text: item.char });
    }
  }

  return {
    segments: normalizedSegments,
    text: trimmed.map((item) => item.char).join(""),
  };
}

function getHtmlTagName(node: HtmlNode): string | undefined {
  return node.name?.toLowerCase();
}

function isTextNode(node: HtmlNode): boolean {
  return node.type === "text";
}

function isCfiNode(node: HtmlNode): boolean {
  return isTextNode(node) || node.name !== undefined;
}

function appendCfiStep(
  parentPath: string,
  index: number,
  textNode: boolean,
): string {
  const step = textNode ? index * 2 + 1 : (index + 1) * 2;

  return `${parentPath}/${step}`;
}

function createTextLocator(
  spineIndex: number,
  path: string,
  text: string,
): Readonly<Record<string, unknown>> {
  const prefix = createCfiPrefix(spineIndex);
  const length = Array.from(text).length;

  return {
    cfi: `epubcfi(${prefix}${path}:0,${path}:${length})`,
  };
}

function createPointLocator(
  spineIndex: number,
  path: string,
): Readonly<Record<string, unknown>> {
  return { cfi: `epubcfi(${createCfiPrefix(spineIndex)}${path})` };
}

function createCfiPrefix(spineIndex: number): string {
  return `/6/${(spineIndex + 1) * 2}!`;
}

function toTextChunk(chunk: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }

  if (Buffer.isBuffer(chunk)) {
    return chunk.toString("utf8");
  }

  throw new Error("Unexpected HTML stream chunk type");
}
