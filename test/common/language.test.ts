import { describe, expect, it } from "vitest";

import { Language } from "../../src/common/language.js";
import { getLanguageDetectionCode } from "../../src/common/tinyld-language.js";

describe("common/language", () => {
  it("exposes a stable language list", () => {
    const languages = Object.values(Language);

    expect(languages).toContain(Language.English);
    expect(languages).toContain(Language.SimplifiedChinese);
    expect(new Set(languages).size).toBe(languages.length);
  });

  it("maps languages to detection codes", () => {
    expect(getLanguageDetectionCode(Language.English)).toBe("en");
    expect(getLanguageDetectionCode(Language.SimplifiedChinese)).toBe("zh");
  });
});
