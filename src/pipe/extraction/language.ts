import { detect, validateISO2 } from "tinyld";

import { getLanguageDetectionCode, type Language } from "../../language.js";

export function needsTranslation(input: {
  content: string;
  label: string;
  targetLanguage: Language;
}): boolean {
  const targetLanguageCode = getLanguageDetectionCode(input.targetLanguage);

  return (
    fieldNeedsTranslation(input.label, targetLanguageCode) ||
    fieldNeedsTranslation(input.content, targetLanguageCode)
  );
}

function fieldNeedsTranslation(
  text: string,
  targetLanguageCode: string,
): boolean {
  if (text.trim() === "") {
    return false;
  }

  const detectedLanguageCode = detectLanguageCode(text);

  if (detectedLanguageCode === undefined) {
    return true;
  }

  return detectedLanguageCode !== targetLanguageCode;
}

function detectLanguageCode(text: string): string | undefined {
  const normalizedText = text.trim();

  if (normalizedText === "") {
    return undefined;
  }

  try {
    return validateLanguageCode(detect(normalizedText));
  } catch {
    return undefined;
  }
}

function validateLanguageCode(languageCode: string): string | undefined {
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
