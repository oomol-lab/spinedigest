import { detect, validateISO2 } from "tinyld";

import { getLanguageDetectionCode, type Language } from "../common/language.js";
import { ReviewSeverity, type ReviewResult } from "./types.js";

export interface LanguageReview {
  readonly detectedLanguageCode: string;
  readonly review: ReviewResult;
  readonly targetLanguageCode: string;
}

export function checkOutputLanguage(input: {
  compressedText: string;
  userLanguage?: Language;
}): LanguageReview | undefined {
  if (input.userLanguage === undefined) {
    return undefined;
  }

  const targetLanguageCode = getLanguageDetectionCode(input.userLanguage);

  if (targetLanguageCode === "") {
    return undefined;
  }

  const detectedLanguageCode = detectLanguageCode(input.compressedText);

  if (
    detectedLanguageCode === undefined ||
    detectedLanguageCode === targetLanguageCode
  ) {
    return undefined;
  }

  return {
    detectedLanguageCode,
    review: {
      clueId: -1,
      issues: [
        {
          problem: `Output language error: detected ${detectedLanguageCode}, but ${targetLanguageCode} (${input.userLanguage}) is required.`,
          severity: ReviewSeverity.Critical,
          suggestion: `Please translate the entire compressed text to ${input.userLanguage}. Maintain all information integrity and ensure the translation sounds natural and native, not machine-translated.`,
        },
      ],
      weight: 1,
    },
    targetLanguageCode,
  };
}

function detectLanguageCode(text: string): string | undefined {
  const normalizedText = text.trim();

  if (normalizedText === "") {
    return undefined;
  }

  try {
    return normalizeLanguageCode(detect(normalizedText));
  } catch {
    return undefined;
  }
}

function normalizeLanguageCode(languageCode: string): string | undefined {
  const normalizedLanguageCode = languageCode.trim().toLowerCase();
  const directLanguageCode = validateISO2(normalizedLanguageCode);

  if (directLanguageCode !== "") {
    return directLanguageCode;
  }

  const baseLanguageCode = normalizedLanguageCode.split("-")[0];

  if (baseLanguageCode === undefined) {
    return undefined;
  }

  const validatedBaseLanguageCode = validateISO2(baseLanguageCode);

  return validatedBaseLanguageCode === ""
    ? undefined
    : validatedBaseLanguageCode;
}
