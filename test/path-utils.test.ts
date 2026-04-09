import { describe, expect, it } from 'vitest';

import { ensureFileExists } from '../src/lib/path-utils.js';
import { CliError } from '../src/lib/cli-error.js';

describe('ensureFileExists', () => {
  it('throws a CliError for missing files', async () => {
    await expect(
      ensureFileExists('/definitely/missing.epub', 'Input EPUB file'),
    ).rejects.toBeInstanceOf(CliError);
  });
});
