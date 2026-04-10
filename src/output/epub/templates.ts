import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import { createEnv } from "../../common/template.js";

const DATA_DIR_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../data",
);
const templateEnvironment = createEnv(DATA_DIR_PATH);

export function renderCoverPage(input: {
  readonly coverImageHref: string;
  readonly language: string;
  readonly title: string;
}): string {
  return templateEnvironment.render("output/epub/cover.xhtml", input);
}

export function renderNavDocument(input: {
  readonly itemsMarkup: string;
  readonly language: string;
  readonly title: string;
}): string {
  return templateEnvironment.render("output/epub/nav.xhtml", input);
}

export function renderPackageOpf(input: {
  readonly authors: readonly string[];
  readonly coverImageHref: string | undefined;
  readonly coverMediaType: string | undefined;
  readonly coverPageHref: string | undefined;
  readonly description: string | null;
  readonly identifier: string;
  readonly language: string;
  readonly modifiedAt: string;
  readonly publishedAt: string | null;
  readonly publisher: string | null;
  readonly sections: readonly {
    readonly href: string;
    readonly id: string;
  }[];
  readonly title: string;
  readonly version: string;
}): string {
  return templateEnvironment.render("output/epub/package.opf.xml", input);
}

export function renderSectionDocument(input: {
  readonly language: string;
  readonly paragraphs: readonly string[];
  readonly title: string;
}): string {
  return templateEnvironment.render("output/epub/section.xhtml", input);
}
