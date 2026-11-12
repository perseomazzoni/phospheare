// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { MatterKind } from "./source";
import { numberValue } from "./text";

// The words that start a chapter. Whole-line patterns, never substrings:
// "Chapter 3" alone on its line is a heading, and "Chapter 3 was her
// favourite" is a sentence, the one failure writers remember an importer
// for. A line matches only when, after the keyword and the number, nothing is
// left but an optional subtitle set off by punctuation ("Chapter 3: The
// Storm", "Capitolo 3 — La tempesta").
//
// Six languages: the five the interface speaks or is likely to (English,
// Italian, Spanish, French, German) and Portuguese. Matching folds accents and
// case, so "CAPÍTULO" and "capitulo" are the same keyword.

const fold = (text: string): string =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const CHAPTER_WORDS = [
  "chapter",
  "ch.",
  "chap.",
  "capitolo",
  "cap.",
  "capitulo",
  "chapitre",
  "kapitel",
];

const PART_WORDS = [
  "part",
  "book",
  "volume",
  "act",
  "parte",
  "libro",
  "atto",
  "partie",
  "livre",
  "acte",
  "teil",
  "buch",
  "akt",
  "livro",
];

/** Front and back matter by the words that head it, folded. */
const MATTER_WORDS: [MatterKind, string[]][] = [
  ["prologue", ["prologue", "prologo", "prolog"]],
  ["epilogue", ["epilogue", "epilogo", "epilog"]],
  [
    "toc",
    [
      "contents",
      "table of contents",
      "indice",
      "sommario",
      "contenido",
      "contenidos",
      "table des matieres",
      "sommaire",
      "inhalt",
      "inhaltsverzeichnis",
      "sumario",
    ],
  ],
  [
    "acknowledgments",
    [
      "acknowledgments",
      "acknowledgements",
      "ringraziamenti",
      "agradecimientos",
      "remerciements",
      "danksagung",
      "agradecimentos",
    ],
  ],
  [
    "dedication",
    ["dedication", "dedica", "dedicatoria", "dedicace", "widmung"],
  ],
  ["epigraph", ["epigraph", "epigrafe", "epigraphe"]],
  ["foreword", ["foreword"]],
  ["preface", ["preface", "prefazione", "prefacio", "vorwort", "premessa"]],
  [
    "introduction",
    [
      "introduction",
      "introduzione",
      "introduccion",
      "einleitung",
      "introducao",
    ],
  ],
  [
    "afterword",
    ["afterword", "postfazione", "postface", "nachwort", "posfacio"],
  ],
  [
    "about",
    [
      "about the author",
      "l'autore",
      "nota sull'autore",
      "sull'autore",
      "sobre el autor",
      "sobre la autora",
      "a propos de l'auteur",
      "uber den autor",
      "uber die autorin",
      "sobre o autor",
      "sobre a autora",
    ],
  ],
  [
    "alsoBy",
    [
      "also by",
      "books by",
      "other books by",
      "dello stesso autore",
      "della stessa autrice",
      "del mismo autor",
      "de la misma autora",
      "du meme auteur",
      "vom selben autor",
      "do mesmo autor",
    ],
  ],
  // The heading the app's own export prints over its facts page, in the
  // languages the interface speaks: a book exported and brought back leaves
  // it out.
  ["techPage", ["technical details", "scheda tecnica"]],
  ["copyright", ["copyright"]],
  ["appendix", ["appendix", "appendice", "apendice", "annexe", "anhang"]],
  ["glossary", ["glossary", "glossario", "glosario", "glossaire", "glossar"]],
  ["bibliography", ["bibliography", "bibliografia", "bibliographie"]],
  ["notes", ["notes", "note", "notas", "anmerkungen", "endnotes"]],
  ["index", ["index"]],
];

/** "also by" heads a line that continues with the author's name. */
const MATTER_PREFIXES: ReadonlySet<string> = new Set([
  "also by",
  "books by",
  "other books by",
]);

/** A line longer than this is never a heading, whatever it starts with. */
export const MAX_HEADING_CHARS = 120;

export interface HeadingMatch {
  kind: "chapter" | "part";
  /** The keyword as written ("CHAPTER", "Capitolo"). */
  keyword: string;
  /** The number's value, or null for "Chapter" followed by something else. */
  number: number | null;
  /** The number as written ("Twenty-One", "XII"). */
  numberText: string;
  /**
   * What follows the number, after its punctuation ("The Storm"); "" when
   * nothing does.
   */
  subtitle: string;
}

const SUBTITLE_SEP = /^\s*(?:[:.\-–—|]+|\s+[-–—]\s+)\s*/;

function afterKeyword(
  line: string,
  words: readonly string[],
): {
  keyword: string;
  rest: string;
} | null {
  const folded = fold(line);
  for (const word of words) {
    if (!folded.startsWith(word)) continue;
    const next = folded[word.length];
    // "Partridge" does not start with the keyword "part"; "Ch.3" does.
    if (!word.endsWith(".") && next !== undefined && !/[\s\d]/.test(next))
      continue;
    return {
      keyword: line.slice(0, word.length),
      rest: line.slice(word.length).trim(),
    };
  }
  return null;
}

/**
 * The number at the start of `rest`, however many words it takes ("Twenty
 * One", "quatre vingt dix"), and what is left after it. Longest parse wins.
 */
function leadingNumber(
  rest: string,
): { value: number; text: string; tail: string } | null {
  const words = rest.split(/\s+/);
  for (let take = Math.min(4, words.length); take >= 1; take--) {
    const head = words.slice(0, take).join(" ");
    // Punctuation glued to the number ("3:", "XII.") belongs to the separator.
    const match = /^(.*?)([:.\-–—|)]*)$/.exec(head);
    const text = match ? match[1] : head;
    const value = numberValue(text);
    if (value === null) continue;
    const glued = match ? match[2] : "";
    const tail = (glued + " " + words.slice(take).join(" ")).trim();
    return { value, text, tail };
  }
  return null;
}

/**
 * Reads a line as a chapter or Part heading: the keyword, a number, and an
 * optional subtitle set off by punctuation. Null for anything else, notably
 * for a sentence that merely begins with "Chapter 3".
 */
export function matchHeading(line: string): HeadingMatch | null {
  const text = line.trim();
  if (!text || text.length > MAX_HEADING_CHARS) return null;
  for (const [kind, words] of [
    ["chapter", CHAPTER_WORDS],
    ["part", PART_WORDS],
  ] as const) {
    const hit = afterKeyword(text, words);
    if (!hit) continue;
    const number = leadingNumber(hit.rest);
    if (!number) continue;
    if (!number.tail)
      return {
        kind,
        keyword: hit.keyword,
        number: number.value,
        numberText: number.text,
        subtitle: "",
      };
    const sep = SUBTITLE_SEP.exec(number.tail);
    if (!sep) continue;
    return {
      kind,
      keyword: hit.keyword,
      number: number.value,
      numberText: number.text,
      subtitle: number.tail.slice(sep[0].length).trim(),
    };
  }
  return null;
}

/** A line that is only a number ("7", "VII", "Seven", "7."), or null. */
export function matchBareNumber(line: string): number | null {
  const text = line.trim();
  if (!text || text.length > 30) return null;
  return numberValue(text);
}

export interface MatterMatch {
  kind: MatterKind;
  /** What follows the keyword after punctuation ("Prologue: 1947" → "1947"). */
  subtitle: string;
}

/** Reads a line as the heading of front or back matter, or null. */
export function matchMatter(line: string): MatterMatch | null {
  const text = line.trim();
  if (!text || text.length > MAX_HEADING_CHARS) return null;
  const folded = fold(text).replace(/[’`]/g, "'");
  for (const [kind, words] of MATTER_WORDS) {
    for (const word of words) {
      if (!folded.startsWith(word)) continue;
      const rest = text.slice(word.length);
      if (!rest.trim()) return { kind, subtitle: "" };
      if (MATTER_PREFIXES.has(word) && /^\s/.test(rest))
        return { kind, subtitle: rest.trim() };
      const sep = SUBTITLE_SEP.exec(rest);
      if (sep && sep[0].length > 0)
        return { kind, subtitle: rest.slice(sep[0].length).trim() };
    }
  }
  return null;
}

/** A line that reads as a contents entry: a title, dots, a page number. */
export function looksLikeTocEntry(line: string): boolean {
  return /(?:\.{3,}|…|\t|\s{2,})\s*\d{1,4}\s*$/.test(line.trim());
}
