import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { CliError } from '../lib/cli-error.js';

export const llmConfigSchema = z.object({
  key: z.string().min(1, 'LLM API key is required'),
  model: z.string().min(1, 'LLM model is required'),
  sampling: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  timeout: z.number().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  url: z.string().url('LLM base URL must be a valid URL'),
});

export type LlmConfig = z.infer<typeof llmConfigSchema>;

export async function loadLlmConfig(configFile: string): Promise<LlmConfig> {
  let content: string;

  try {
    content = await readFile(configFile, 'utf8');
  } catch (error) {
    throw new CliError(`Failed to read config file: ${configFile}`, {
      cause: error,
      exitCode: 1,
    });
  }

  let parsedContent: unknown;

  try {
    parsedContent = JSON.parse(content) as unknown;
  } catch (error) {
    throw new CliError(`Config file is not valid JSON: ${configFile}`, {
      cause: error,
      exitCode: 1,
    });
  }

  const result = llmConfigSchema.safeParse(parsedContent);

  if (!result.success) {
    throw new CliError(
      `Config file validation failed: ${result.error.message}`,
      {
        exitCode: 1,
      },
    );
  }

  return result.data;
}
