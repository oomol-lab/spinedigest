import type { BookMeta } from "../../source/index.js";

import type { EpubSection } from "./model.js";
import { escapeXml } from "./shared.js";

export function createFallbackSection(
  meta: BookMeta,
  language: string,
): EpubSection {
  return {
    href: "text/section-1.xhtml",
    id: "section-1",
    title: meta.title?.trim() || "Untitled",
    xhtml: createContentDocument(meta.title?.trim() || "Untitled", language, []),
  };
}

export function createSectionDocument(
  serialId: number,
  language: string,
  title: string,
  summary: string,
): EpubSection {
  const normalizedTitle = title.trim() || `Section ${serialId}`;

  return {
    href: `text/serial-${serialId}.xhtml`,
    id: `serial-${serialId}`,
    title: normalizedTitle,
    xhtml: createContentDocument(
      normalizedTitle,
      language,
      splitParagraphs(summary.trim()),
    ),
  };
}

function createContentDocument(
  title: string,
  language: string,
  paragraphs: readonly string[],
): string {
  const body = [
    `<h1>${escapeXml(title)}</h1>`,
    ...paragraphs.map((paragraph) => `<p>${escapeXml(paragraph)}</p>`),
  ].join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(language)}" lang="${escapeXml(language)}">
  <head>
    <title>${escapeXml(title)}</title>
  </head>
  <body>
    ${body}
  </body>
</html>
`;
}

function splitParagraphs(summary: string): string[] {
  return summary
    .split(/\n\s*\n/gu)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/gu, " ").trim())
    .filter((paragraph) => paragraph !== "");
}
