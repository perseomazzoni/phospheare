// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── Reading the words themselves ─────────────────────────────────────────────
//
// The small facts detection asks of a line of text: is it a scene break, is
// it a number (in digits, in Roman numerals, in words, in six languages), and
// what is it once the invisible debris of word processors is swept out.

/**
 * Characters a word processor leaves in text that a writer never typed and
 * cannot see: zero-width spaces, byte-order marks inside the text, soft
 * hyphens, the bidi controls a pasted web page brings. The zero-width joiner
 * and non-joiner stay: they shape emoji and some scripts.
 */
const INVISIBLE =
  /[\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u00AD]/g;

/** `C0` and `C1` controls, except the tab, which `tidyText` makes a space. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/**
 * A paragraph's text as the app keeps it: NFC (so "è" typed two ways is one
 * letter, and a search finds both), invisible debris and control characters
 * out, tabs and runs of spaces collapsed to one, since a manuscript's
 * first-line indents and double spaces after full stops were layout, and the
 * editor does its own. The line's ends are left to the caller, which knows
 * whether it is looking at a whole paragraph or a run inside one.
 */
export function tidyText(text: string): string {
  return text
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(/[\t\n\r\v\f]/g, " ")
    .replace(CONTROL, "")
    .replace(/ {2,}/g, " ");
}

/**
 * A line that marks a scene break: nothing but ornament, such as "* * *",
 * "***", "#", "~", "⁂", "§", "———". "o O o" is not, since it has letters, and
 * neither is "x x x", which some writers use; the separator rule exists for
 * those.
 */
export function isSceneGlyph(line: string): boolean {
  const text = line.trim();
  if (!text || text.length > 24) return false;
  if (/[\p{L}\p{N}]/u.test(text)) return false;
  // At least one real ornament: a line of nothing but dots or a lone hyphen
  // is more often a typing accident or an ellipsis paragraph than a break.
  return /[*#~⁂§•·◆◇❦❧✦✧★☆†‡※=_\-–—+^°]/u.test(text) && !/^\.+$/.test(text);
}

// ── Roman numerals ───────────────────────────────────────────────────────────

const ROMAN: Record<string, number> = {
  i: 1,
  v: 5,
  x: 10,
  l: 50,
  c: 100,
  d: 500,
  m: 1000,
};

/**
 * The value of a Roman numeral (any case), or null when it is not a
 * well-formed one.
 */
export function romanValue(raw: string): number | null {
  const text = raw.toLowerCase();
  if (!/^[ivxlcdm]+$/.test(text)) return null;
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const value = ROMAN[text[i]];
    const next = ROMAN[text[i + 1]] ?? 0;
    total += value < next ? -value : value;
  }
  // Round-trip to refuse "IIII", "VX", "IC": only the canonical spelling
  // counts, so the word "mix" or "dill" never reads as a number.
  return toRoman(total) === text ? total : null;
}

function toRoman(value: number): string {
  if (value <= 0 || value >= 4000) return "";
  const table: [number, string][] = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let out = "";
  let rest = value;
  for (const [n, s] of table)
    while (rest >= n) {
      out += s;
      rest -= n;
    }
  return out;
}

// ── Numbers in words ─────────────────────────────────────────────────────────
//
// "Chapter Twenty-One", "Capitolo ventuno", "Capítulo veintiuno". Built for
// 1–99 in the six languages the patterns know, plus the ordinals a chapter
// heading uses ("Chapter the First", "Capitolo primo"). Accents are folded
// before lookup, so "veintidós" and "veintidos" are the same number.

const fold = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\s\-‐‑]+/g, " ")
    .trim();

function build(
  units: readonly string[],
  tens: readonly string[],
  compose: (ten: string, unit: string, t: number, u: number) => string[],
): Map<string, number> {
  const map = new Map<string, number>();
  units.forEach((word, i) => {
    if (word) map.set(fold(word), i);
  });
  for (let t = 2; t <= 9; t++) {
    map.set(fold(tens[t]), t * 10);
    for (let u = 1; u <= 9; u++)
      for (const form of compose(tens[t], units[u], t, u))
        map.set(fold(form), t * 10 + u);
  }
  return map;
}

const EN = build(
  [
    "",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
  ],
  [
    "",
    "",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
  ],
  (ten, unit) => [`${ten}-${unit}`, `${ten} ${unit}`],
);

const IT = build(
  [
    "",
    "uno",
    "due",
    "tre",
    "quattro",
    "cinque",
    "sei",
    "sette",
    "otto",
    "nove",
    "dieci",
    "undici",
    "dodici",
    "tredici",
    "quattordici",
    "quindici",
    "sedici",
    "diciassette",
    "diciotto",
    "diciannove",
  ],
  [
    "",
    "",
    "venti",
    "trenta",
    "quaranta",
    "cinquanta",
    "sessanta",
    "settanta",
    "ottanta",
    "novanta",
  ],
  // "ventuno", "ventotto": the ten drops its vowel before uno and otto;
  // "ventitré" takes an accent the fold removes.
  (ten, unit, _t, u) =>
    u === 1 || u === 8 ? [ten.slice(0, -1) + unit] : [ten + unit],
);

const ES = build(
  [
    "",
    "uno",
    "dos",
    "tres",
    "cuatro",
    "cinco",
    "seis",
    "siete",
    "ocho",
    "nueve",
    "diez",
    "once",
    "doce",
    "trece",
    "catorce",
    "quince",
    "dieciseis",
    "diecisiete",
    "dieciocho",
    "diecinueve",
  ],
  [
    "",
    "",
    "veinte",
    "treinta",
    "cuarenta",
    "cincuenta",
    "sesenta",
    "setenta",
    "ochenta",
    "noventa",
  ],
  (ten, unit, t) => (t === 2 ? [`veinti${unit}`] : [`${ten} y ${unit}`]),
);

const PT = build(
  [
    "",
    "um",
    "dois",
    "tres",
    "quatro",
    "cinco",
    "seis",
    "sete",
    "oito",
    "nove",
    "dez",
    "onze",
    "doze",
    "treze",
    "catorze",
    "quinze",
    "dezesseis",
    "dezessete",
    "dezoito",
    "dezenove",
  ],
  [
    "",
    "",
    "vinte",
    "trinta",
    "quarenta",
    "cinquenta",
    "sessenta",
    "setenta",
    "oitenta",
    "noventa",
  ],
  (ten, unit) => [`${ten} e ${unit}`],
);

const DE = build(
  [
    "",
    "eins",
    "zwei",
    "drei",
    "vier",
    "funf",
    "sechs",
    "sieben",
    "acht",
    "neun",
    "zehn",
    "elf",
    "zwolf",
    "dreizehn",
    "vierzehn",
    "funfzehn",
    "sechzehn",
    "siebzehn",
    "achtzehn",
    "neunzehn",
  ],
  [
    "",
    "",
    "zwanzig",
    "dreissig",
    "vierzig",
    "funfzig",
    "sechzig",
    "siebzig",
    "achtzig",
    "neunzig",
  ],
  (ten, unit, _t, u) => [`${u === 1 ? "ein" : unit}und${ten}`],
);

const FR = (() => {
  const units = [
    "",
    "un",
    "deux",
    "trois",
    "quatre",
    "cinq",
    "six",
    "sept",
    "huit",
    "neuf",
    "dix",
    "onze",
    "douze",
    "treize",
    "quatorze",
    "quinze",
    "seize",
    "dix sept",
    "dix huit",
    "dix neuf",
  ];
  const map = new Map<string, number>();
  units.forEach((word, i) => word && map.set(fold(word), i));
  const tens = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];
  for (let t = 2; t <= 6; t++) {
    map.set(fold(tens[t]), t * 10);
    for (let u = 1; u <= 9; u++)
      map.set(
        fold(u === 1 ? `${tens[t]} et un` : `${tens[t]} ${units[u]}`),
        t * 10 + u,
      );
  }
  // 70–79 and 90–99 count on from sixty and eighty: "soixante-douze" is 72,
  // "quatre-vingt-quinze" is 95. Only 71 takes "et"; 81 does not.
  for (let u = 0; u <= 9; u++) {
    map.set(
      fold(u === 1 ? "soixante et onze" : `soixante ${units[10 + u]}`),
      70 + u,
    );
    map.set(fold(`quatre vingt ${units[10 + u]}`), 90 + u);
    if (u > 0) map.set(fold(`quatre vingt ${units[u]}`), 80 + u);
  }
  map.set(fold("quatre vingts"), 80);
  map.set(fold("quatre vingt"), 80);
  return map;
})();

const ORDINALS: Record<string, number> = Object.fromEntries(
  (
    [
      [
        "first",
        "second",
        "third",
        "fourth",
        "fifth",
        "sixth",
        "seventh",
        "eighth",
        "ninth",
        "tenth",
        "eleventh",
        "twelfth",
        "thirteenth",
        "fourteenth",
        "fifteenth",
        "sixteenth",
        "seventeenth",
        "eighteenth",
        "nineteenth",
        "twentieth",
      ],
      [
        "primo",
        "secondo",
        "terzo",
        "quarto",
        "quinto",
        "sesto",
        "settimo",
        "ottavo",
        "nono",
        "decimo",
        "undicesimo",
        "dodicesimo",
        "tredicesimo",
        "quattordicesimo",
        "quindicesimo",
        "sedicesimo",
        "diciassettesimo",
        "diciottesimo",
        "diciannovesimo",
        "ventesimo",
      ],
      [
        "primero",
        "segundo",
        "tercero",
        "cuarto",
        "quinto",
        "sexto",
        "septimo",
        "octavo",
        "noveno",
        "decimo",
      ],
      [
        "premier",
        "deuxieme",
        "troisieme",
        "quatrieme",
        "cinquieme",
        "sixieme",
        "septieme",
        "huitieme",
        "neuvieme",
        "dixieme",
      ],
    ] as const
  ).flatMap((list) =>
    list.flatMap((word, i) =>
      // Italian and Spanish ordinals agree with the noun: "Parte seconda",
      // "Parte prima", "Segunda parte". French has one feminine, "première".
      word.endsWith("o")
        ? [[word, i + 1] as const, [word.slice(0, -1) + "a", i + 1] as const]
        : word === "premier"
          ? [[word, 1] as const, ["premiere", 1] as const]
          : [[word, i + 1] as const],
    ),
  ),
);

const WORD_TABLES = [EN, IT, ES, PT, DE, FR];

const MAX_ROMAN = 300;

/**
 * The value of a chapter number however it is written ("12", "XII", "xii",
 * "twelve", "Twenty-One", "ventuno", "the First", "primo"), or null.
 */
export function numberValue(raw: string): number | null {
  const text = fold(raw)
    .replace(/^the /, "")
    .replace(/[.:)]$/, "");
  if (!text) return null;
  if (/^\d{1,4}$/.test(text)) return Number(text);
  // Capped: no book has a chapter `CCCI`, and above it Roman numerals start to
  // spell words ("mix" is 1009, "di" 501) far more often than numbers.
  const roman = romanValue(text);
  if (roman !== null && roman <= MAX_ROMAN) return roman;
  if (text in ORDINALS) return ORDINALS[text];
  for (const table of WORD_TABLES) {
    const value = table.get(text);
    if (value !== undefined) return value;
  }
  return null;
}

/**
 * How many letters of a line are capitals, out of its letters (0 when it has
 * none).
 */
export function capsShare(text: string): number {
  let letters = 0;
  let caps = 0;
  for (const ch of text) {
    if (/\p{L}/u.test(ch)) {
      letters += 1;
      if (ch !== ch.toLowerCase() && ch === ch.toUpperCase()) caps += 1;
    }
  }
  return letters ? caps / letters : 0;
}

/** Whether a line reads like prose: it ends like a sentence, or runs long. */
export function isSentenceLike(text: string): boolean {
  const trimmed = text.trim();
  return (
    (/[.!?…"'»”’)\]]$/u.test(trimmed) && trimmed.split(/\s+/).length > 3) ||
    trimmed.length > 120
  );
}
