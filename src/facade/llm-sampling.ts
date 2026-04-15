import type { SamplingScopeConfig, TemperatureSetting } from "../llm/index.js";

const SPINE_DIGEST_SCOPE_IDS = {
  editorCompress: "serial-generation/editor-compress",
  editorReview: "serial-generation/editor-review",
  editorReviewGuide: "serial-generation/editor-review-guide",
  readerChoice: "serial-generation/reader-choice",
  readerExtraction: "serial-generation/reader-extraction",
} as const;

type SpineDigestSamplingScope =
  (typeof SPINE_DIGEST_SCOPE_IDS)[keyof typeof SPINE_DIGEST_SCOPE_IDS];

type SpineDigestSamplingConfig = SamplingScopeConfig<SpineDigestSamplingScope>;

const DEFAULT_SPINE_DIGEST_SAMPLING = Object.freeze({
  [SPINE_DIGEST_SCOPE_IDS.editorCompress]: Object.freeze({
    temperature: 0.7,
    topP: 0.9,
  }),
  [SPINE_DIGEST_SCOPE_IDS.editorReview]: Object.freeze({
    temperature: [0.3, 0.95] as const,
    topP: [0.4, 0.8] as const,
  }),
  [SPINE_DIGEST_SCOPE_IDS.editorReviewGuide]: Object.freeze({
    temperature: 0.4,
    topP: 0.6,
  }),
  [SPINE_DIGEST_SCOPE_IDS.readerChoice]: Object.freeze({
    temperature: [0.3, 0.95] as const,
    topP: [0.4, 0.8] as const,
  }),
  [SPINE_DIGEST_SCOPE_IDS.readerExtraction]: Object.freeze({
    temperature: [0.3, 0.95] as const,
    topP: [0.4, 0.8] as const,
  }),
} satisfies SpineDigestSamplingConfig);

export function createDefaultSpineDigestSampling(input: {
  readonly temperature?: TemperatureSetting;
  readonly topP?: TemperatureSetting;
} = {}): SpineDigestSamplingConfig {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(DEFAULT_SPINE_DIGEST_SAMPLING).map(([scope, profile]) => [
        scope,
        Object.freeze({
          ...profile,
          ...(input.temperature === undefined
            ? {}
            : { temperature: input.temperature }),
          ...(input.topP === undefined ? {} : { topP: input.topP }),
        }),
      ]),
    ),
  ) as SpineDigestSamplingConfig;
}
