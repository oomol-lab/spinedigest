import type { ArchiveOutputSource } from "../object/types.js";

export function formatSourceObject(source: ArchiveOutputSource): string {
  return formatSourceCitationBlock(source.uri, source.text);
}

export function formatSourceCitationBlock(uri: string, text: string): string {
  return [`@@ ${uri} @@`, normalizeSourceText(text)].join("\n");
}

function normalizeSourceText(text: string): string {
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
