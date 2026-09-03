import {
  ensureRelativeDirectory,
  readHostZipEntries,
  type Directory,
  type File,
} from "../../../../runtime/platform/index.js";

const LEGACY_FORMAT_VERSION = 1;
const LEGACY_SDPUB_PATTERNS = [
  /^manifest\.json$/u,
  /^database\.db$/u,
  /^toc\.json$/u,
  /^cover\/(?:data\.bin|info\.json)$/u,
  /^summaries\/serial-\d+\.txt$/u,
  /^fragments\/serial-\d+\/fragment_\d+\.json$/u,
] as const;

export async function extractLegacySdpubArchive(
  inputFile: File,
  outputDirectory: Directory,
): Promise<void> {
  const entries = await readHostZipEntries(inputFile);
  const paths = new Set(entries.map((entry) => normalize(entry.name)));
  if (!paths.has("database.db") || !paths.has("toc.json")) {
    throw new Error("Unsupported legacy sdpub archive.");
  }
  const manifest = entries.find(
    (entry) => normalize(entry.name) === "manifest.json",
  );
  if (manifest !== undefined) {
    assertSupportedManifest(new TextDecoder().decode(manifest.data));
  }

  for (const entry of entries) {
    const name = normalize(entry.name);
    if (
      name === "" ||
      !LEGACY_SDPUB_PATTERNS.some((pattern) => pattern.test(name))
    ) {
      continue;
    }
    const parts = name.split("/");
    const fileName = parts.pop();
    if (!fileName) continue;
    const parent = await ensureRelativeDirectory(
      outputDirectory,
      parts.join("/"),
    );
    const file =
      (await parent.getFile(fileName)) ?? (await parent.createFile(fileName));
    const writer = await file.openWriter();
    try {
      await writer.write(entry.data);
      await writer.commit();
    } catch (error) {
      await writer.abort().catch(() => undefined);
      throw error;
    }
  }
}

function normalize(name: string): string {
  const parts = name.replaceAll("\\", "/").split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) return "";
  return parts.join("/");
}

function assertSupportedManifest(content: string): void {
  try {
    const parsed = JSON.parse(content) as { readonly formatVersion?: unknown };
    if (parsed.formatVersion === LEGACY_FORMAT_VERSION) return;
  } catch {
    // Report a uniform unsupported-archive error below.
  }
  throw new Error("Unsupported legacy sdpub archive.");
}
