import {
  getWikiGraphPlatform,
  type File,
  type HostZipEntry,
} from "../../../runtime/platform/index.js";

import type { BookMeta, SourceAsset } from "../../source/index.js";
import type { EpubBook } from "./model.js";
import { normalizeLanguage } from "./shared.js";
import { renderCoverPage } from "./templates.js";

const EPUB_CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

export async function writeEpubArchive(
  file: File,
  book: EpubBook,
): Promise<void> {
  const entries: HostZipEntry[] = [
    textEntry("mimetype", "application/epub+zip"),
    textEntry("META-INF/container.xml", EPUB_CONTAINER_XML),
    textEntry("OEBPS/package.opf", book.packageOpf),
    textEntry("OEBPS/nav.xhtml", book.navXhtml),
    ...book.sections.map((section) =>
      textEntry(`OEBPS/${section.href}`, section.xhtml),
    ),
  ];

  if (book.cover !== undefined) {
    const coverImageHref = createCoverImageHref(book.cover);
    const language = normalizeLanguage(book.meta.language);
    entries.push(
      { data: book.cover.data, name: `OEBPS/${coverImageHref}` },
      textEntry(
        "OEBPS/text/cover.xhtml",
        createCoverPage(book.meta, coverImageHref, language),
      ),
    );
  }

  await getWikiGraphPlatform().zip.write(file, entries);
}

export function createCoverImageHref(cover: SourceAsset): string {
  return `images/cover${normalizeCoverExtension(cover)}`;
}

function textEntry(name: string, text: string): HostZipEntry {
  return { data: new TextEncoder().encode(text), name };
}

function createCoverPage(
  meta: BookMeta,
  coverImageHref: string,
  language: string,
): string {
  return renderCoverPage({
    coverImageHref,
    language,
    title: meta.title?.trim() || "Untitled",
  });
}

function normalizeCoverExtension(cover: SourceAsset): string {
  const name = cover.path.split("/").at(-1) ?? cover.path;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot).toLowerCase() : "";
  if (extension !== "") return extension;

  switch (cover.mediaType) {
    case "image/gif":
      return ".gif";
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/svg+xml":
      return ".svg";
    case "image/webp":
      return ".webp";
    default:
      return ".bin";
  }
}
