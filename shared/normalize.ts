const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const KANA_OFFSET = 0x60;

/**
 * 表記ゆれを吸収した比較用の文字列にする。
 * 全角半角の統一 (NFKC)、英字の小文字化、カタカナをひらがなへ、空白と記号の除去を行う。
 * 10の扉の重複提案の検出と、AI GMの解答判定 (#27) で使う
 */
export function normalizeText(text: string): string {
  const unified = text.normalize('NFKC').toLowerCase();
  let out = '';
  for (const ch of unified) {
    const code = ch.codePointAt(0)!;
    out += code >= KATAKANA_START && code <= KATAKANA_END ? String.fromCodePoint(code - KANA_OFFSET) : ch;
  }
  // 長音符 (ー) は記号ではなく文字 (Lm) なので残る
  return out.replace(/[\s\p{P}\p{S}]/gu, '');
}
export const ciCheck: number = 'type error';
