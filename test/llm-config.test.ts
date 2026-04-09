import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadLlmConfig } from '../src/config/llm-config.js';
import { CliError } from '../src/lib/cli-error.js';

describe('loadLlmConfig', () => {
  it('loads a valid config file', async () => {
    const workspace = await mkdtemp(
      path.join(os.tmpdir(), 'spinedigest-config-'),
    );
    const configFile = path.join(workspace, 'format.json');

    await writeFile(
      configFile,
      JSON.stringify({
        key: 'test-key',
        model: 'gpt-4.1',
        url: 'https://api.openai.com/v1',
      }),
    );

    await expect(loadLlmConfig(configFile)).resolves.toEqual({
      key: 'test-key',
      model: 'gpt-4.1',
      url: 'https://api.openai.com/v1',
    });
  });

  it('throws a CliError when validation fails', async () => {
    const workspace = await mkdtemp(
      path.join(os.tmpdir(), 'spinedigest-config-'),
    );
    const configFile = path.join(workspace, 'format.json');

    await writeFile(
      configFile,
      JSON.stringify({
        key: '',
        model: 'gpt-4.1',
        url: 'not-a-url',
      }),
    );

    await expect(loadLlmConfig(configFile)).rejects.toBeInstanceOf(CliError);
  });
});
