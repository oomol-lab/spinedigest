import { SpineDigestScope } from "../common/llm-scope.js";
import type {
  SamplingProfile,
  SamplingScopeConfig,
  TemperatureSetting,
} from "../llm/index.js";

export type SpineDigestSamplingConfig = SamplingScopeConfig<SpineDigestScope>;

const DEFAULT_SPINE_DIGEST_SAMPLING = Object.freeze({
  [SpineDigestScope.EditorCompress]: Object.freeze({
    temperature: 0.7,
    topP: 0.9,
  }),
  [SpineDigestScope.EditorReview]: Object.freeze({
    temperature: [0.3, 0.95] as const,
    topP: [0.4, 0.8] as const,
  }),
  [SpineDigestScope.EditorReviewGuide]: Object.freeze({
    temperature: 0.4,
    topP: 0.6,
  }),
  [SpineDigestScope.ReaderChoice]: Object.freeze({
    temperature: [0.3, 0.95] as const,
    topP: [0.4, 0.8] as const,
  }),
  [SpineDigestScope.ReaderExtraction]: Object.freeze({
    temperature: [0.3, 0.95] as const,
    topP: [0.4, 0.8] as const,
  }),
} satisfies SpineDigestSamplingConfig);

export function createDefaultSpineDigestSampling(
  input: {
    readonly temperature?: TemperatureSetting;
    readonly topP?: TemperatureSetting;
  } = {},
): SpineDigestSamplingConfig {
  return Object.freeze({
    [SpineDigestScope.EditorCompress]: applySamplingOverrides(
      DEFAULT_SPINE_DIGEST_SAMPLING[SpineDigestScope.EditorCompress],
      input,
    ),
    [SpineDigestScope.EditorReview]: applySamplingOverrides(
      DEFAULT_SPINE_DIGEST_SAMPLING[SpineDigestScope.EditorReview],
      input,
    ),
    [SpineDigestScope.EditorReviewGuide]: applySamplingOverrides(
      DEFAULT_SPINE_DIGEST_SAMPLING[SpineDigestScope.EditorReviewGuide],
      input,
    ),
    [SpineDigestScope.ReaderChoice]: applySamplingOverrides(
      DEFAULT_SPINE_DIGEST_SAMPLING[SpineDigestScope.ReaderChoice],
      input,
    ),
    [SpineDigestScope.ReaderExtraction]: applySamplingOverrides(
      DEFAULT_SPINE_DIGEST_SAMPLING[SpineDigestScope.ReaderExtraction],
      input,
    ),
  } satisfies SpineDigestSamplingConfig);
}

function applySamplingOverrides(
  profile: SamplingProfile,
  input: {
    readonly temperature?: TemperatureSetting;
    readonly topP?: TemperatureSetting;
  },
): SamplingProfile {
  return Object.freeze({
    ...profile,
    ...(input.temperature === undefined
      ? {}
      : { temperature: input.temperature }),
    ...(input.topP === undefined ? {} : { topP: input.topP }),
  });
}
