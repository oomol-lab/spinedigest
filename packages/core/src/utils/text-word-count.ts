const HAN_CHARACTER_PATTERN = /\p{Script=Han}/u;
const WORD_CHARACTER_PATTERN = /[\p{Letter}\p{Number}]/u;
const WORD_MARK_PATTERN = /\p{Mark}/u;

export function countTextWords(text: string): number {
  let words = 0;
  let inWord = false;

  for (const character of text.trim()) {
    if (HAN_CHARACTER_PATTERN.test(character)) {
      words += 1;
      inWord = false;
      continue;
    }

    if (WORD_CHARACTER_PATTERN.test(character)) {
      if (!inWord) {
        words += 1;
      }
      inWord = true;
      continue;
    }

    if (inWord && WORD_MARK_PATTERN.test(character)) {
      continue;
    }

    inWord = false;
  }

  return words;
}
