import type { ArchiveOutputSource } from "../object/types.js";

export function formatSourceObject(source: ArchiveOutputSource): string {
  return formatSourceCitationBlock(source.uri, source.text, source.locators);
}

export function formatSourceCitationBlock(
  uri: string,
  text: string,
  locators: Readonly<Record<string, string>> = {},
): string {
  const locatorLines = Object.entries(locators).map(
    ([range, locator]) => `${range} -> ${locator}`,
  );
  // Locator ranges address the exact text below. Legacy whitespace cleanup is
  // safe only when there is no map to invalidate.
  const renderedText =
    locatorLines.length === 0 ? normalizeUnmappedSourceText(text) : text;

  return [
    `@@ ${uri} @@`,
    ...locatorLines,
    ...(locatorLines.length === 0 ? [] : [""]),
    renderedText,
  ].join("\n");
}

function normalizeUnmappedSourceText(text: string): string {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");

  while (lines.length > 0 && lines[0]?.trim() === "") lines.shift();
  while (lines.length > 0 && lines.at(-1)?.trim() === "") lines.pop();

  const normalizedLines: string[] = [];
  for (const line of lines) {
    if (line.trim() === "" && normalizedLines.at(-1) === "") continue;
    normalizedLines.push(line.trim() === "" ? "" : line);
  }

  return normalizedLines.join("\n");
}
