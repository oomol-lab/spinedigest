import { detect, validateISO2 } from "tinyld";

import { Language } from "./language.js";

const LANGUAGE_DETECTION_CODES = {
  [Language.Arabic]: "ar",
  [Language.Danish]: "da",
  [Language.Dutch]: "nl",
  [Language.English]: "en",
  [Language.Finnish]: "fi",
  [Language.French]: "fr",
  [Language.German]: "de",
  [Language.Hindi]: "hi",
  [Language.Indonesian]: "id",
  [Language.Italian]: "it",
  [Language.Japanese]: "ja",
  [Language.Korean]: "ko",
  [Language.Norwegian]: "no",
  [Language.Polish]: "pl",
  [Language.Portuguese]: "pt",
  [Language.Russian]: "ru",
  [Language.SimplifiedChinese]: "zh",
  [Language.Spanish]: "es",
  [Language.Swedish]: "sv",
  [Language.Thai]: "th",
  [Language.TraditionalChinese]: "zh",
  [Language.Turkish]: "tr",
  [Language.Vietnamese]: "vi",
} satisfies Record<Language, string>;

export function detectLanguageCode(text: string): string | undefined {
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

export function getLanguageDetectionCode(language: Language): string {
  return LANGUAGE_DETECTION_CODES[language];
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
