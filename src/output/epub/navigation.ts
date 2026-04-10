import type { BookMeta, TocItem } from "../../source/index.js";

import type { EpubNavItem, EpubSection } from "./model.js";
import { escapeXml } from "./shared.js";

export function buildNavItems(
  items: readonly TocItem[],
  sectionMap: ReadonlyMap<number, EpubSection>,
): EpubNavItem[] {
  return items.map((item) => ({
    children: buildNavItems(item.children, sectionMap),
    href:
      item.serialId === undefined ? undefined : sectionMap.get(item.serialId)?.href,
    title: item.title,
  }));
}

export function createNavDocument(
  meta: BookMeta,
  language: string,
  items: readonly EpubNavItem[],
): string {
  const title = meta.title?.trim() || "Untitled";
  const navContent =
    items.length === 0
      ? "<ol></ol>"
      : `<ol>\n${items.map((item) => renderNavItem(item, 3)).join("\n")}\n      </ol>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(language)}" lang="${escapeXml(language)}">
  <head>
    <title>${escapeXml(title)}</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>${escapeXml(title)}</h1>
      ${navContent}
    </nav>
  </body>
</html>
`;
}

function renderNavItem(item: EpubNavItem, depth: number): string {
  const indent = "  ".repeat(depth);
  const label =
    item.href === undefined
      ? `<span>${escapeXml(item.title)}</span>`
      : `<a href="${escapeXml(item.href)}">${escapeXml(item.title)}</a>`;
  const children =
    item.children.length === 0
      ? ""
      : `\n${indent}  <ol>\n${item.children
          .map((child) => renderNavItem(child, depth + 2))
          .join("\n")}\n${indent}  </ol>`;

  return `${indent}<li>${label}${children}</li>`;
}
