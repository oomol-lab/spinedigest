import { mkdir } from 'node:fs/promises';

import type { z } from 'zod';

import { loadLlmConfig } from '../config/llm-config.js';
import { ensureFileExists, resolveFromCwd } from '../lib/path-utils.js';
import { compressOptionsSchema } from '../types/compress-options.js';

export type CompressCommandOptions = z.output<typeof compressOptionsSchema>;

export async function runCompressCommand(rawOptions: unknown): Promise<void> {
  const options = compressOptionsSchema.parse(rawOptions);

  const inputFile = resolveFromCwd(options.inputFile);
  const configFile = resolveFromCwd(options.configFile);
  const outputFile = resolveFromCwd(options.outputFile);
  const workspaceDir = resolveFromCwd(options.workspaceDir);
  const cacheDir = resolveFromCwd(options.cacheDir);
  const logDir = resolveFromCwd(options.logDir);

  await ensureFileExists(inputFile, 'Input EPUB file');
  await ensureFileExists(configFile, 'Config file');

  const llmConfig = await loadLlmConfig(configFile);
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  await mkdir(logDir, { recursive: true });

  const summary = {
    cacheDir,
    configFile,
    inputFile,
    intention:
      options.intention ??
      'Preserve the main storyline, key character development, and important dialogue.',
    llmBaseUrl: llmConfig.url,
    llmModel: llmConfig.model,
    logDir,
    outputFile,
    workspaceDir,
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.stderr.write(
    'Compression pipeline is not migrated yet. This command currently validates inputs and prepares runtime directories.\n',
  );
}
