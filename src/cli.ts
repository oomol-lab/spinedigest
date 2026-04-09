#!/usr/bin/env node

import { Command } from 'commander';

import { runCompressCommand } from './commands/compress.js';
import { CliError } from './lib/cli-error.js';

const program = new Command();

program
  .name('spinedigest')
  .description('AI-driven EPUB compression CLI')
  .version('0.1.0');

program
  .command('compress')
  .description('Validate inputs and prepare a compression run')
  .requiredOption('-i, --input-file <path>', 'Path to the source EPUB file')
  .requiredOption(
    '-c, --config-file <path>',
    'Path to the LLM config JSON file',
  )
  .option(
    '-o, --output-file <path>',
    'Path to the output EPUB file',
    'output.epub',
  )
  .option(
    '--workspace-dir <path>',
    'Path to the temporary workspace directory',
    '.spinedigest/workspace',
  )
  .option(
    '--cache-dir <path>',
    'Path to the cache directory',
    '.spinedigest/cache',
  )
  .option('--log-dir <path>', 'Path to the log directory', '.spinedigest/logs')
  .option('--intention <text>', 'Reading intention that guides compression')
  .action(async (options) => {
    await runCompressCommand(options);
  });

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof CliError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode;
  } else {
    throw error;
  }
}
