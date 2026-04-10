import type { BookMeta } from "../../source/index.js";

import type { EpubSection } from "./model.js";
import { escapeXml } from "./shared.js";

export const EPUB_OUTPUT_VERSION = "3.0";

export function createPackageOpf(input: {
  readonly coverImageHref: string | undefined;
  readonly coverMediaType: string | undefined;
  readonly coverPageHref: string | undefined;
  readonly language: string;
  readonly meta: BookMeta;
  readonly modifiedAt: string;
  readonly sections: readonly EpubSection[];
}): string {
  const identifier =
    input.meta.identifier?.trim() || `urn:uuid:${crypto.randomUUID()}`;
  const title = input.meta.title?.trim() || "Untitled";
  const metadataLines = [
    `<dc:identifier id="book-id">${escapeXml(identifier)}</dc:identifier>`,
    `<dc:title>${escapeXml(title)}</dc:title>`,
    `<dc:language>${escapeXml(input.language)}</dc:language>`,
    ...input.meta.authors.map(
      (author) => `<dc:creator>${escapeXml(author)}</dc:creator>`,
    ),
    ...(input.meta.publisher === null
      ? []
      : [`<dc:publisher>${escapeXml(input.meta.publisher)}</dc:publisher>`]),
    ...(input.meta.publishedAt === null
      ? []
      : [`<dc:date>${escapeXml(input.meta.publishedAt)}</dc:date>`]),
    ...(input.meta.description === null
      ? []
      : [`<dc:description>${escapeXml(input.meta.description)}</dc:description>`]),
    `<meta property="dcterms:modified">${escapeXml(input.modifiedAt)}</meta>`,
  ];
  const manifestLines = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    ...input.sections.map(
      (section) =>
        `<item id="${escapeXml(section.id)}" href="${escapeXml(section.href)}" media-type="application/xhtml+xml"/>`,
    ),
  ];
  const spineLines = [
    ...(input.coverPageHref === undefined ? [] : ['<itemref idref="cover-page"/>']),
    ...input.sections.map(
      (section) => `<itemref idref="${escapeXml(section.id)}"/>`,
    ),
  ];

  if (input.coverImageHref !== undefined) {
    manifestLines.push(
      `<item id="cover-image" href="${escapeXml(input.coverImageHref)}" media-type="${escapeXml(input.coverMediaType ?? "application/octet-stream")}" properties="cover-image"/>`,
    );
    manifestLines.push(
      `<item id="cover-page" href="${escapeXml(input.coverPageHref ?? "text/cover.xhtml")}" media-type="application/xhtml+xml"/>`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<package version="${EPUB_OUTPUT_VERSION}" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${metadataLines.join("\n    ")}
  </metadata>
  <manifest>
    ${manifestLines.join("\n    ")}
  </manifest>
  <spine>
    ${spineLines.join("\n    ")}
  </spine>
</package>
`;
}
