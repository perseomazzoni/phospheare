// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Each language's number, colour and weekday words, for the planter
// (`plant.ts`). Test tooling only: the product reads facts through a model
// (`ledger.ts`), and nothing in the product imports this file.

export interface PlantWords {
  /** Colour words, each to the colour it names (gender and number folded). */
  readonly colours: Readonly<Record<string, string>>;
  /** Weekdays, Sunday first, as `Date.getDay()` numbers them. */
  readonly weekdays: readonly string[];
  /** Months, January first. */
  readonly months: readonly string[];
  /** A number word to its value, or null. */
  readonly number: (word: string) => number | null;
}

const IT_UNITS: Record<string, number> = {
  uno: 1,
  un: 1,
  una: 1,
  due: 2,
  tre: 3,
  tré: 3,
  quattro: 4,
  cinque: 5,
  sei: 6,
  sette: 7,
  otto: 8,
  nove: 9,
};
const IT_TEENS: Record<string, number> = {
  dieci: 10,
  undici: 11,
  dodici: 12,
  tredici: 13,
  quattordici: 14,
  quindici: 15,
  sedici: 16,
  diciassette: 17,
  diciotto: 18,
  diciannove: 19,
};
const IT_TENS: Array<[string, number]> = [
  ["venti", 20],
  ["trenta", 30],
  ["quaranta", 40],
  ["cinquanta", 50],
  ["sessanta", 60],
  ["settanta", 70],
  ["ottanta", 80],
  ["novanta", 90],
];

/** An Italian number word below a thousand ("settantadue", "ottocento"). */
function italianBelowThousand(word: string): number | null {
  if (word === "") return 0;
  if (word in IT_UNITS) return IT_UNITS[word];
  if (word in IT_TEENS) return IT_TEENS[word];
  const hundred = word.indexOf("cento");
  if (hundred >= 0) {
    const head = word.slice(0, hundred);
    const times = head === "" ? 1 : IT_UNITS[head];
    const rest = italianBelowThousand(word.slice(hundred + "cento".length));
    return times === undefined || rest === null ? null : times * 100 + rest;
  }
  for (const [ten, value] of IT_TENS) {
    // "ventuno", "trentotto": the ten drops its vowel before uno and otto.
    for (const stem of [ten, ten.slice(0, -1)]) {
      if (!word.startsWith(stem)) continue;
      const rest = word.slice(stem.length);
      if (rest === "") return stem === ten ? value : null;
      if (rest in IT_UNITS && rest !== "un" && rest !== "una")
        return value + IT_UNITS[rest];
    }
  }
  return null;
}

function italianNumber(word: string): number | null {
  const lower = word.toLowerCase();
  if (/^\d+(?:[.,]\d+)?$/.test(lower)) return Number(lower.replace(",", "."));
  if (lower === "mille") return 1000;
  const thousands = lower.indexOf("mila");
  if (thousands > 0) {
    const times = italianBelowThousand(lower.slice(0, thousands));
    const rest = italianBelowThousand(lower.slice(thousands + 4));
    return times === null || rest === null ? null : times * 1000 + rest;
  }
  return italianBelowThousand(lower);
}

const EN_SMALL: Record<string, number> = {
  a: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const EN_TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function englishNumber(word: string): number | null {
  const lower = word.toLowerCase();
  if (/^\d+(?:[.,]\d+)?$/.test(lower)) return Number(lower.replace(",", "."));
  if (lower in EN_SMALL) return EN_SMALL[lower];
  if (lower in EN_TENS) return EN_TENS[lower];
  const [ten, unit] = lower.split("-");
  if (ten in EN_TENS && unit in EN_SMALL && EN_SMALL[unit] < 10)
    return EN_TENS[ten] + EN_SMALL[unit];
  return null;
}

const ITALIAN: PlantWords = {
  colours: {
    giallo: "giallo",
    gialla: "giallo",
    gialli: "giallo",
    gialle: "giallo",
    azzurro: "azzurro",
    azzurra: "azzurro",
    azzurri: "azzurro",
    azzurre: "azzurro",
    celeste: "celeste",
    celesti: "celeste",
    blu: "blu",
    rosso: "rosso",
    rossa: "rosso",
    rossi: "rosso",
    rosse: "rosso",
    verde: "verde",
    verdi: "verde",
    bianco: "bianco",
    bianca: "bianco",
    bianchi: "bianco",
    bianche: "bianco",
    nero: "nero",
    nera: "nero",
    neri: "nero",
    nere: "nero",
    grigio: "grigio",
    grigia: "grigio",
    grigi: "grigio",
    grigie: "grigio",
    marrone: "marrone",
    marroni: "marrone",
    viola: "viola",
    arancione: "arancione",
    arancioni: "arancione",
    biondo: "biondo",
    bionda: "biondo",
    biondi: "biondo",
    bionde: "biondo",
    castano: "castano",
    castana: "castano",
    castani: "castano",
    castane: "castano",
    dorato: "dorato",
    dorata: "dorato",
    dorati: "dorato",
    dorate: "dorato",
  },
  weekdays: [
    "domenica",
    "lunedì",
    "martedì",
    "mercoledì",
    "giovedì",
    "venerdì",
    "sabato",
  ],
  months: [
    "gennaio",
    "febbraio",
    "marzo",
    "aprile",
    "maggio",
    "giugno",
    "luglio",
    "agosto",
    "settembre",
    "ottobre",
    "novembre",
    "dicembre",
  ],
  number: italianNumber,
};

const ENGLISH: PlantWords = {
  colours: {
    yellow: "yellow",
    blue: "blue",
    red: "red",
    green: "green",
    white: "white",
    black: "black",
    grey: "grey",
    gray: "grey",
    pink: "pink",
    purple: "purple",
    orange: "orange",
    brown: "brown",
    blond: "blond",
    blonde: "blond",
    golden: "golden",
    silver: "silver",
  },
  weekdays: [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ],
  months: [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ],
  number: englishNumber,
};

/** The words for a language code ("it", "en-GB"), or null for any other. */
export function plantWordsFor(code: string | undefined): PlantWords | null {
  const base = (code ?? "").toLowerCase().split(/[-_]/)[0];
  return base === "it" ? ITALIAN : base === "en" ? ENGLISH : null;
}
