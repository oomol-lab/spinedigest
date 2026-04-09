import { z } from 'zod';

export const compressOptionsSchema = z.object({
  cacheDir: z.string().min(1),
  configFile: z.string().min(1),
  inputFile: z.string().min(1),
  intention: z.string().min(1).optional(),
  logDir: z.string().min(1),
  outputFile: z.string().min(1),
  workspaceDir: z.string().min(1),
});
