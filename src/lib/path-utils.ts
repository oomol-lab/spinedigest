import { access } from 'node:fs/promises';
import path from 'node:path';

import { CliError } from './cli-error.js';

export function resolveFromCwd(value: string): string {
  return path.resolve(process.cwd(), value);
}

export async function ensureFileExists(
  filePath: string,
  label: string,
): Promise<void> {
  try {
    await access(filePath);
  } catch (error) {
    throw new CliError(`${label} not found: ${filePath}`, {
      cause: error,
      exitCode: 1,
    });
  }
}
