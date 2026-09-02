import type { LLM } from "../../external/llm/index.js";
import type { Language } from "../../runtime/common/language.js";
import type { WikiGraphScope } from "../../runtime/common/llm-scope.js";
import type { SerialProgressSink } from "../../serial.js";
import type { Directory, File } from "../../runtime/platform/index.js";

export interface ChapterGraphBuildArtifact {
  readonly documentDirectory: Directory;
  readonly chapterId: number;
  readonly objectsFile: File;
  readonly parameter: GraphBuildParameterInput;
}

export interface GraphBuildParameterInput {
  readonly language?: string;
  readonly prompt: string;
}

export interface BuildChapterGraphArtifactOptions {
  readonly extractionPrompt?: string;
  readonly llm: LLM<WikiGraphScope>;
  readonly logDirectory?: Directory;
  readonly progressTracker?: SerialProgressSink;
  readonly sourceText: readonly string[];
  readonly userLanguage?: Language;
  readonly workspace: Directory;
}
