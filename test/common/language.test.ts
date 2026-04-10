import { describe, expect, it } from "vitest";

import {
  ENGLISH,
  LANGUAGES,
  SIMPLIFIED_CHINESE,
  getLanguageDetectionCode,
  getLanguageTag,
} from "../../src/common/language.js";

describe("common/language", () => {
  it("exposes a stable language list", () => {
    expect(LANGUAGES).toContain(ENGLISH);
    expect(LANGUAGES).toContain(SIMPLIFIED_CHINESE);
    expect(new Set(LANGUAGES).size).toBe(LANGUAGES.length);
  });

  it("maps languages to tags and detection codes", () => {
    expect(getLanguageTag(ENGLISH)).toBe("en");
    expect(getLanguageTag(SIMPLIFIED_CHINESE)).toBe("zh-CN");
    expect(getLanguageDetectionCode(ENGLISH)).toBe("en");
    expect(getLanguageDetectionCode(SIMPLIFIED_CHINESE)).toBe("zh");
  });
});
