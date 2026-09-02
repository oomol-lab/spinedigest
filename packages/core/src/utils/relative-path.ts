/** POSIX-style helpers for logical names inside a host-owned Directory. */
export function joinRelativePath(...parts: readonly string[]): string {
  const output: string[] = [];
  for (const part of parts) {
    for (const segment of part.replaceAll("\\", "/").split("/")) {
      if (segment === "" || segment === ".") continue;
      if (segment === "..") {
        if (output.length === 0)
          throw new TypeError("Relative path escapes its root");
        output.pop();
      } else {
        output.push(segment);
      }
    }
  }
  return output.join("/");
}

export function dirnameRelativePath(value: string): string {
  const normalized = joinRelativePath(value);
  return normalized.split("/").slice(0, -1).join("/");
}

export function basenameRelativePath(value: string): string {
  return joinRelativePath(value).split("/").at(-1) ?? "";
}

export function extnameRelativePath(value: string): string {
  const name = basenameRelativePath(value);
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index);
}
