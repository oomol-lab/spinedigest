export const ARABIC = "Arabic";
export const DANISH = "Danish";
export const DUTCH = "Dutch";
export const ENGLISH = "English";
export const FINNISH = "Finnish";
export const FRENCH = "French";
export const GERMAN = "German";
export const HINDI = "Hindi";
export const INDONESIAN = "Indonesian";
export const ITALIAN = "Italian";
export const JAPANESE = "Japanese";
export const KOREAN = "Korean";
export const NORWEGIAN = "Norwegian";
export const POLISH = "Polish";
export const PORTUGUESE = "Portuguese";
export const RUSSIAN = "Russian";
export const SIMPLIFIED_CHINESE = "Simplified Chinese";
export const SPANISH = "Spanish";
export const SWEDISH = "Swedish";
export const THAI = "Thai";
export const TRADITIONAL_CHINESE = "Traditional Chinese";
export const TURKISH = "Turkish";
export const VIETNAMESE = "Vietnamese";

export const LANGUAGES = [
  ARABIC,
  DANISH,
  DUTCH,
  ENGLISH,
  FINNISH,
  FRENCH,
  GERMAN,
  HINDI,
  INDONESIAN,
  ITALIAN,
  JAPANESE,
  KOREAN,
  NORWEGIAN,
  POLISH,
  PORTUGUESE,
  RUSSIAN,
  SIMPLIFIED_CHINESE,
  SPANISH,
  SWEDISH,
  THAI,
  TRADITIONAL_CHINESE,
  TURKISH,
  VIETNAMESE,
] as const;

export type Language = (typeof LANGUAGES)[number];

const LANGUAGE_TAGS = new Map<Language, string>([
  [ARABIC, "ar"],
  [DANISH, "da"],
  [DUTCH, "nl"],
  [ENGLISH, "en"],
  [FINNISH, "fi"],
  [FRENCH, "fr"],
  [GERMAN, "de"],
  [HINDI, "hi"],
  [INDONESIAN, "id"],
  [ITALIAN, "it"],
  [JAPANESE, "ja"],
  [KOREAN, "ko"],
  [NORWEGIAN, "no"],
  [POLISH, "pl"],
  [PORTUGUESE, "pt"],
  [RUSSIAN, "ru"],
  [SIMPLIFIED_CHINESE, "zh-CN"],
  [SPANISH, "es"],
  [SWEDISH, "sv"],
  [THAI, "th"],
  [TRADITIONAL_CHINESE, "zh-TW"],
  [TURKISH, "tr"],
  [VIETNAMESE, "vi"],
]);

const LANGUAGE_DETECTION_CODES = new Map<Language, string>([
  [ARABIC, "ar"],
  [DANISH, "da"],
  [DUTCH, "nl"],
  [ENGLISH, "en"],
  [FINNISH, "fi"],
  [FRENCH, "fr"],
  [GERMAN, "de"],
  [HINDI, "hi"],
  [INDONESIAN, "id"],
  [ITALIAN, "it"],
  [JAPANESE, "ja"],
  [KOREAN, "ko"],
  [NORWEGIAN, "no"],
  [POLISH, "pl"],
  [PORTUGUESE, "pt"],
  [RUSSIAN, "ru"],
  [SIMPLIFIED_CHINESE, "zh"],
  [SPANISH, "es"],
  [SWEDISH, "sv"],
  [THAI, "th"],
  [TRADITIONAL_CHINESE, "zh"],
  [TURKISH, "tr"],
  [VIETNAMESE, "vi"],
]);

export function getLanguageTag(language: Language): string {
  return LANGUAGE_TAGS.get(language) ?? "";
}

export function getLanguageDetectionCode(language: Language): string {
  return LANGUAGE_DETECTION_CODES.get(language) ?? "";
}
