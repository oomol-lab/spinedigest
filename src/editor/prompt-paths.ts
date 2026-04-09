import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const MODULE_DIR_PATH = dirname(fileURLToPath(import.meta.url));
const DATA_DIR_PATH = resolve(MODULE_DIR_PATH, "..", "..", "data", "editor");

export const CLUE_REVIEWER_PROMPT_PATH = resolve(
  DATA_DIR_PATH,
  "clue_reviewer.jinja",
);
export const CLUE_REVIEWER_GENERATOR_PROMPT_PATH = resolve(
  DATA_DIR_PATH,
  "clue_reviewer_generator.jinja",
);
export const REVISION_FEEDBACK_PROMPT_PATH = resolve(
  DATA_DIR_PATH,
  "revision_feedback.jinja",
);
export const TEXT_COMPRESSOR_PROMPT_PATH = resolve(
  DATA_DIR_PATH,
  "text_compressor.jinja",
);
