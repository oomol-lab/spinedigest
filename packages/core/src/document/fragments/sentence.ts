import { countTextWords } from "../../utils/text-word-count.js";
import type { SentenceRecord } from "../types.js";

export function splitTextIntoSentences(
  text: string,
): readonly SentenceRecord[] {
  return text
    .split(/\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "")
    .map((sentence) => ({
      text: sentence,
      wordsCount: countTextWords(sentence),
    }));
}
