import type { ArchiveOutputContext } from "../object/types.js";

export function createOutputWarnings(
  context: ArchiveOutputContext,
): readonly { readonly message: string; readonly type: "skip-unindexed" }[] {
  if (context.skipUnindexed !== true) {
    return [];
  }

  return [
    {
      message:
        "--skip-unindexed was used; this command searched only chapters that already have a current FTS or source embedding index artifact. Run `inspect` to check index coverage before treating missing results as missing knowledge.",
      type: "skip-unindexed",
    },
  ];
}

export function formatOutputWarnings(
  warnings: readonly { readonly message: string }[],
): string {
  if (warnings.length === 0) {
    return "";
  }

  return `${warnings.map((warning) => `Warning: ${warning.message}`).join("\n")}\n\n`;
}

export function createWarningJSONLObject(warning: {
  readonly message: string;
  readonly type: "skip-unindexed";
}): {
  readonly message: string;
  readonly type: "warning";
  readonly warning: "skip-unindexed";
} {
  return {
    message: warning.message,
    type: "warning",
    warning: warning.type,
  };
}
