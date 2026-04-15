import {
  detectLanguageCode,
  getLanguageDetectionCode,
} from "../../common/tinyld-language.js";
import { type Language } from "../../common/language.js";

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
