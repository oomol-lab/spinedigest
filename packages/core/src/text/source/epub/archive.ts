import {
  getWikiGraphPlatform,
  type File,
  type HostZipEntry,
} from "../../../runtime/platform/index.js";
import { createPortableHash as createHash } from "../../../utils/crypto.js";

/** EPUB reader backed only by the host ZIP and File capabilities. */
export class EpubArchive {
  readonly #file: File;
  readonly #entries: ReadonlyMap<string, HostZipEntry>;
  readonly #digest: string;

  // eslint-disable-next-line no-restricted-syntax -- constructors cannot use JavaScript #private syntax.
  private constructor(
    file: File,
    entries: ReadonlyMap<string, HostZipEntry>,
    digest: string,
  ) {
    this.#file = file;
    this.#entries = entries;
    this.#digest = digest;
  }

  public static async open(file: File): Promise<EpubArchive> {
    const content = await file.read();
    const bytes =
      typeof content === "string" ? new TextEncoder().encode(content) : content;
    const digest = createHash("sha256").update(bytes).digest("hex");
    const entries = new Map<string, HostZipEntry>();
    for (const entry of await getWikiGraphPlatform().zip.read(file)) {
      const name = normalizeArchivePath(entry.name);
      if (name !== "") entries.set(name, entry);
    }
    return new EpubArchive(file, entries, digest);
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }

  public hasEntry(path: string): boolean {
    return this.#entries.has(normalizeArchivePath(path));
  }

  public listEntries(): readonly string[] {
    return [...this.#entries.keys()];
  }

  public async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBuffer(path));
  }

  public async readBuffer(path: string): Promise<Uint8Array> {
    return this.#getEntry(path).data;
  }

  public resolveRelativePath(basePath: string, href: string): string {
    const normalizedHref = normalizeHref(href);
    if (normalizedHref === "") {
      throw new Error(`Invalid EPUB href: ${href}`);
    }
    return normalizeArchivePath(
      joinArchivePath(
        dirnameArchivePath(normalizeArchivePath(basePath)),
        normalizedHref,
      ),
    );
  }

  public createSectionId(path: string, fragment?: string): string {
    const normalizedPath = normalizeArchivePath(path);
    return fragment === undefined || fragment === ""
      ? normalizedPath
      : `${normalizedPath}#${fragment}`;
  }

  public createSyntheticSectionId(path: string, title?: string): string {
    const normalizedPath = normalizeArchivePath(path);
    const hash = createHash("sha1")
      .update(`${normalizedPath}:${title ?? ""}`)
      .digest("hex")
      .slice(0, 10);
    return `toc:${hash}`;
  }

  public get name(): string {
    return this.#file.name;
  }

  public get digest(): string {
    return this.#digest;
  }

  #getEntry(path: string): HostZipEntry {
    const normalizedPath = normalizeArchivePath(path);
    const entry = this.#entries.get(normalizedPath);
    if (entry === undefined) {
      throw new Error(`EPUB entry does not exist: ${normalizedPath}`);
    }
    return entry;
  }
}

export function normalizeArchivePath(path: string): string {
  const output: string[] = [];
  for (const part of path.replaceAll("\\", "/").trim().split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") output.pop();
    else output.push(part);
  }
  return output.join("/");
}

export function normalizeHref(href: string): string {
  const [path] = href.split("#", 1);
  return normalizeArchivePath(path ?? "");
}

export function normalizeFragment(
  fragment: string | undefined,
): string | undefined {
  if (fragment === undefined) return undefined;
  const normalized = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  return normalized === "" ? undefined : normalized;
}

export function splitHref(href: string): {
  readonly path: string;
  readonly fragment: string | undefined;
} {
  const [pathPart, fragmentPart] = href.split("#", 2);
  return {
    path: normalizeArchivePath(pathPart ?? ""),
    fragment: normalizeFragment(fragmentPart),
  };
}

function dirnameArchivePath(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function joinArchivePath(...parts: readonly string[]): string {
  return parts.filter(Boolean).join("/");
}
