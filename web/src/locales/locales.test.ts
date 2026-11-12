// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import i18next from "i18next";
import en from "./en.json";
// Not `it`: vitest owns that name here.
import italian from "./it.json";
// The same two files as text. A parsed import cannot show a duplicate key,
// because `JSON.parse` has already dropped one.
import enRaw from "./en.json?raw";
import italianRaw from "./it.json?raw";
import { SHAPE_IDS, partKeysFor } from "../project/startingShape";
import { COVERAGE_SKIP_REASONS, MODEL_FAILURE_CODES } from "../ai/domain/types";
import { TOOL_DEFINITIONS } from "../ai/application/tools";
import { GUIDE_LANGUAGES, actionOf, aiSkills } from "../ai/domain/skills";
import { APP_LANGUAGES } from "./languages";
import { SCOPE_WORDS } from "../ai/domain/scope";
import { MAP_SHAPES } from "../ai/domain/structureShapes";
import { PERSONAS } from "../ai/domain/personas";
import { AGE_CATEGORIES, GENRE_IDS } from "../project/genres";
import { addFormatters, interpolation } from "./i18nOptions";
import { PRODUCT } from "../product";

// Pins the locale files as data: parity between languages, completeness
// against the code's own unions, and the rules every string keeps. A writer
// can switch language in Settings, so a key missing from one file is visible.

/** Every leaf key, dotted. An i18next plural suffix makes a key of its own. */
function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) =>
    keys(v, prefix ? `${prefix}.${k}` : k),
  );
}

/**
 * Duplicate keys in one object, as dotted paths.
 *
 * A parsed import cannot answer this: `JSON.parse` keeps the last of a
 * repeated key and drops the earlier one silently, so only the raw text shows
 * it.
 *
 * Walks a stack of container paths, pushed on a line that opens an object and
 * popped on the line that closes it. That holds because the format gate keeps
 * both files at one key per line.
 */
function duplicateKeys(raw: string): string[] {
  const path: string[] = [];
  const seen = new Map<string, Set<string>>();
  const found: string[] = [];

  for (const line of raw.split("\n")) {
    const text = line.trim();
    if (text.startsWith("}")) {
      path.pop();
      continue;
    }
    const key = /^"([^"]+)":/.exec(text)?.[1];
    if (!key) continue;

    const where = path.join(".");
    const here = seen.get(where) ?? new Set<string>();
    if (here.has(key)) found.push(where ? `${where}.${key}` : key);
    here.add(key);
    seen.set(where, here);

    if (text.endsWith("{")) path.push(key);
  }
  return found;
}

describe("translations", () => {
  const enKeys = keys(en);
  const itKeys = keys(italian);

  // The scope words the parser accepts live once, in `SCOPE_WORDS`, and the
  // shape words `/map` takes live once, on the shape table. A copy in
  // a locale would show a word the parser may not take once the two drift.
  it("never restates a scope or shape word the parser owns", () => {
    const words = new Set([
      ...Object.values(SCOPE_WORDS).flatMap((one) => [one.en, one.it]),
      ...Object.values(MAP_SHAPES).flatMap(({ word }) => [
        word.en,
        word.it,
        ...(word.also ?? []),
      ]),
    ]);
    const values = (tree: unknown): string[] =>
      typeof tree === "string"
        ? [tree]
        : Object.values(tree as Record<string, unknown>).flatMap(values);
    for (const value of [...values(en), ...values(italian)])
      expect(words.has(value)).toBe(false);
  });

  // A repeated key drops the earlier one at runtime, and its strings render
  // as raw keys with no compiler or parity failure.
  it("declares every key once", () => {
    expect(duplicateKeys(enRaw)).toEqual([]);
    expect(duplicateKeys(italianRaw)).toEqual([]);
  });

  it("says the same things in Italian as in English", () => {
    expect(itKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
    expect(enKeys.filter((k) => !itKeys.includes(k))).toEqual([]);
  });

  it("leaves nothing untranslated", () => {
    const blank = [
      ...enKeys.filter((k) => read(en, k) === ""),
      ...itKeys.filter((k) => read(italian, k) === ""),
    ];
    expect(blank).toEqual([]);
  });

  it("gives no counted key a base sibling, in either language", () => {
    // A base key beside its plural forms makes a call with `count: 0` resolve
    // the base rather than a plural, silently, in whichever language has one.
    // The rule holds for every key, not per key, because each new counted
    // string can repeat the mistake.
    const offenders: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (typeof node !== "object" || node === null) return;
      const entries = node as Record<string, unknown>;
      for (const [key, value] of Object.entries(entries)) {
        if (key.endsWith("_one") && key.slice(0, -4) in entries)
          offenders.push(`${path}${key.slice(0, -4)}`);
        walk(value, `${path}${key}.`);
      }
    };
    walk(en, "");
    walk(italian, "");
    expect(offenders).toEqual([]);
  });

  // The dock builds `dock.modelError.<code>` from the provider failure union,
  // so a code with no string renders its raw key in the chat bubble. The code
  // list is the union's source; `unknown` is the explicit fallback.
  it("has a dock.modelError string for every model error code", () => {
    for (const code of [...MODEL_FAILURE_CODES, "unknown"]) {
      expect(
        read(en, `dock.modelError.${code}`),
        `en dock.modelError.${code}`,
      ).toBeTruthy();
      expect(
        read(italian, `dock.modelError.${code}`),
        `it dock.modelError.${code}`,
      ).toBeTruthy();
    }
  });

  // `provider-rejected` is the catch-all for a failure nothing more specific
  // explains: a provider's 4xx not about the key, an unknown code, a local
  // runtime's non-network error. The model saw none of those, and a content
  // refusal is a completion reason rather than this code, so the string must
  // not say the model refused. Both languages are checked.
  it("never tells a writer the model refused them when it never saw the request", () => {
    expect(en.dock.modelError["provider-rejected"]).not.toMatch(
      /model\b.*\brefused/i,
    );
    expect(italian.dock.modelError["provider-rejected"]).not.toMatch(
      /modello\b.*\brifiutat/i,
    );
  });

  // The coverage detail builds `dock.coverageSkip.<reason>` for every source a
  // run meant to inspect and did not, so a reason without copy would print a
  // key path beside the source's title. The reason list is the union's source;
  // `unknown` is the fallback a hand-edited chat's stray reason reads as.
  it("has a dock.coverageSkip string for every coverage skip reason", () => {
    for (const reason of [...COVERAGE_SKIP_REASONS, "unknown"]) {
      expect(
        read(en, `dock.coverageSkip.${reason}`),
        `en dock.coverageSkip.${reason}`,
      ).toBeTruthy();
      expect(
        read(italian, `dock.coverageSkip.${reason}`),
        `it dock.coverageSkip.${reason}`,
      ).toBeTruthy();
    }
  });

  // A command's guide lives in its own file, one per interface language. A
  // new interface language fails here until every command has a guide in it,
  // rather than showing its writers another language's guide.
  it("has a command guide language for every interface language", () => {
    expect([...GUIDE_LANGUAGES].sort()).toEqual(
      APP_LANGUAGES.map((one) => one.value).sort(),
    );
  });

  // The persona dialog draws a focus by `dock.preset.<id>.name` and `.hint`,
  // and the pill by its name; the genre fields draw each id's label. A preset
  // or genre added to its file with no copy would draw its raw key.
  it("has a name and a hint for every persona's focus, and a label for every genre", () => {
    for (const persona of PERSONAS)
      for (const { id } of persona.presets)
        for (const leaf of ["name", "hint"])
          for (const [lang, bundle] of [
            ["en", en],
            ["it", italian],
          ] as const)
            expect(
              read(bundle, `dock.preset.${id}.${leaf}`),
              `${lang} ${id}.${leaf}`,
            ).toBeTruthy();
    for (const [lang, bundle] of [
      ["en", en],
      ["it", italian],
    ] as const) {
      for (const id of GENRE_IDS)
        expect(read(bundle, `genre.name.${id}`), `${lang} ${id}`).toBeTruthy();
      for (const id of AGE_CATEGORIES)
        expect(read(bundle, `genre.age.${id}`), `${lang} ${id}`).toBeTruthy();
    }
  });

  // The command menu draws `dock.commandNote.<command>` under every command,
  // built from the skill file's own name, so a new file with no note
  // would draw its raw key in the menu.
  it("has a dock.commandNote string for every skill", () => {
    for (const { command } of aiSkills) {
      expect(
        read(en, `dock.commandNote.${command}`),
        `en ${command}`,
      ).toBeTruthy();
      expect(
        read(italian, `dock.commandNote.${command}`),
        `it ${command}`,
      ).toBeTruthy();
    }
  });

  // A command that takes the writer's words draws its ghost and speaks its
  // description from its own keys, and a question also takes a quote
  // in their place, so a new text command without them would draw
  // `[dock.<command>.hint]` in the field.
  it("has the hint strings for every command that takes words", () => {
    for (const skill of aiSkills.filter((one) => one.argument === "text")) {
      const keys = ["hint", "hintDescription"];
      if (actionOf(skill) === "question") keys.push("hintQuoteDescription");
      for (const key of keys)
        for (const [name, locale] of [
          ["en", en],
          ["it", italian],
        ] as const)
          expect(
            read(locale, `dock.${skill.command}.${key}`),
            `${name} ${skill.command}.${key}`,
          ).toBeTruthy();
    }
  });

  // The waiting line builds `dock.doing.<tool>` from the tool's own name, so a
  // tool added without copy would show its raw key while a writer waits. The
  // `_named` variants are i18next contexts and are not required of every
  // tool: only a tool that acts on something nameable has one, and i18next
  // falls back to the plain key when the context is absent.
  it("has a dock.doing string for every tool the assistant can run", () => {
    // From `TOOL_DEFINITIONS`, the runtime list the model is offered; a list
    // written out here would be a second copy that drifts silently.
    for (const tool of Object.keys(TOOL_DEFINITIONS)) {
      expect(
        read(en, `dock.doing.${tool}`),
        `en dock.doing.${tool}`,
      ).toBeTruthy();
      expect(
        read(italian, `dock.doing.${tool}`),
        `it dock.doing.${tool}`,
      ).toBeTruthy();
    }
  });

  // WCAG 2.5.3: the ask's Edit is named for what it edits, and the name starts
  // with the word on the button, so a voice command naming the visible word
  // still finds it.
  it("names the ask's Edit with the word it shows, in each language", () => {
    for (const web of [en.dock.web, italian.dock.web])
      expect(
        web.editName.toLowerCase().startsWith(web.edit.toLowerCase()),
      ).toBe(true);
  });

  // A `_one` form that types the digit itself cannot follow the count it is
  // given: i18next hands it `{{count}}`, and the number is interpolated, never
  // spelled. Phrasing around the count stays legal; only the literal digit is
  // an offender.
  it("never writes the digit into a _one form", () => {
    const offenders: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (typeof node !== "object" || node === null) return;
      for (const [key, value] of Object.entries(
        node as Record<string, unknown>,
      )) {
        if (
          key.endsWith("_one") &&
          typeof value === "string" &&
          /\b1\b/.test(value)
        ) {
          offenders.push(`${path}${key}`);
        }
        walk(value, `${path}${key}.`);
      }
    };
    walk(en, "");
    walk(italian, "");
    expect(offenders).toEqual([]);
  });

  // Vendors are never spelled: storage is Remote Storage or
  // Local Storage, the vendor reaches the copy only through `{{storage}}`,
  // the AI side only through `{{provider}}`, `{{searchProvider}}` and
  // `{{localProvider}}`, and no competing writing app is named at all. The
  // allow-list is the Google sign-in identity and nothing else.
  it("never spells a vendor outside the allow-list", () => {
    const allowed = new Set([
      "landing.head.logIn",
      "landing.hero.note",
      "settings.accountNote",
      "settings.deleteAccountReauth",
      "settings.deleteAccountContinue",
      "settings.deleteAccountConfirmedBody",
      "settings.deleteAccountUnconfirmed",
      "settings.deleteAccountLapsed",
      "library.driveAccountMismatch",
    ]);
    const vendor =
      /[Gg]oogle|\b[Dd]rive\b|[Oo]pen[Rr]outer|[Oo]llama|[Ss]crivener|[Vv]ellum|[Aa]tticus|[Ll]ibre[Oo]ffice|[Mm]icrosoft|\bWord (file|or)\b|\bin Word\b|› Word/;
    const offenders: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (typeof node !== "object" || node === null) return;
      for (const [key, value] of Object.entries(
        node as Record<string, unknown>,
      )) {
        const at = `${path}${key}`;
        if (typeof value === "string" && vendor.test(value) && !allowed.has(at))
          offenders.push(at);
        walk(value, `${at}.`);
      }
    };
    walk(en, "");
    walk(italian, "");
    expect(offenders).toEqual([]);
  });

  // i18next's default interpolation is `{{ }}`; a single-brace `{name}` is
  // rendered literally, so the sentence shows `{title}`. The
  // component tests' mock `t` interpolates whatever it is handed, so only the
  // raw strings can catch this.
  it("interpolates with double braces everywhere", () => {
    const offenders: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (typeof node !== "object" || node === null) return;
      for (const [key, value] of Object.entries(
        node as Record<string, unknown>,
      )) {
        if (typeof value === "string") {
          const stripped = value.replace(/\{\{[^{}]*\}\}/g, "");
          if (/[{}]/.test(stripped)) offenders.push(`${path}${key}`);
        }
        walk(value, `${path}${key}.`);
      }
    };
    walk(en, "");
    walk(italian, "");
    expect(offenders).toEqual([]);
  });

  // A writer reads the public name from `product.json`, reached through the
  // `{{product}}` default variable, never the internal name. A string that
  // spells either name is one a rename misses, so neither appears literally.
  it("never spells the product name, internal or public", () => {
    const offenders: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (typeof node !== "object" || node === null) return;
      for (const [key, value] of Object.entries(
        node as Record<string, unknown>,
      )) {
        if (
          typeof value === "string" &&
          (/phospheare/i.test(value) ||
            value.toLowerCase().includes(PRODUCT.lower))
        ) {
          offenders.push(`${path}${key}`);
        }
        walk(value, `${path}${key}.`);
      }
    };
    walk(en, "");
    walk(italian, "");
    expect(offenders).toEqual([]);
  });

  it("renders the public product name, and its all-caps form, through real i18next", async () => {
    for (const [lng, locale] of [
      ["en", en],
      ["it", italian],
    ] as const) {
      const i18n = i18next.createInstance();
      await i18n.init({
        lng,
        resources: {
          [lng]: { translation: { ...locale, caps: "{{product, uppercase}}" } },
        },
        interpolation,
      });
      addFormatters(i18n);
      expect(i18n.t("caps")).toBe(PRODUCT.upper);
      // The landing hands in the model provider; the product comes alone.
      const cost = i18n.t("landing.faq.cost.a", { provider: "Provider" });
      expect(cost).toContain(PRODUCT.name);
      expect(cost).not.toContain("{");
    }
  });

  it("renders the named save failure with the chat's title, through real i18next", async () => {
    for (const [lng, locale] of [
      ["en", en],
      ["it", italian],
    ] as const) {
      const i18n = i18next.createInstance();
      await i18n.init({
        lng,
        resources: { [lng]: { translation: locale } },
        interpolation,
      });
      const text = i18n.t("dock.saveFailedNamed", { title: "Once Dark" });
      expect(text).toContain("Once Dark");
      expect(text).not.toContain("{");
    }
  });

  it("counts the trace's rungs at the one/other boundary, through real i18next", async () => {
    // A mocked translator prints the key and cannot pin a plural: only real
    // i18next picks `_one` or `_other`, per language.
    const expected = {
      en: [
        "Read 1 source",
        "Read 2 sources",
        "1 step failed",
        "3 steps failed",
      ],
      it: [
        "1 fonte letta",
        "2 fonti lette",
        "1 passo non riuscito",
        "3 passi non riusciti",
      ],
    };
    for (const [lng, locale] of [
      ["en", en],
      ["it", italian],
    ] as const) {
      const i18n = i18next.createInstance();
      await i18n.init({
        lng,
        resources: { [lng]: { translation: locale } },
        interpolation,
      });
      expect([
        i18n.t("dock.trail.read", { count: 1 }),
        i18n.t("dock.trail.read", { count: 2 }),
        i18n.t("dock.trail.failed", { count: 1 }),
        i18n.t("dock.trail.failed", { count: 3 }),
      ]).toEqual(expected[lng]);
      // Waiting names the model, whatever its name starts with.
      expect(i18n.t("dock.waiting", { model: "NVIDIA: Nemotron" })).toContain(
        "NVIDIA: Nemotron",
      );
    }
  });

  it("drops the count from a one-step review or map, through real i18next", async () => {
    // A mocked translator prints the key and cannot pin a plural. One step
    // has nothing to count, so the line is the bare verb; more than one keeps
    // "steps done: n of m".
    const expected = {
      en: [
        "Reviewing",
        "Reviewing · steps done: 1 of 3",
        "Mapping",
        "Mapping · steps done: 2 of 4",
      ],
      it: [
        "Revisione in corso",
        "Revisione in corso · passi fatti: 1 su 3",
        "Mappatura in corso",
        "Mappatura in corso · passi fatti: 2 su 4",
      ],
    };
    for (const [lng, locale] of [
      ["en", en],
      ["it", italian],
    ] as const) {
      const i18n = i18next.createInstance();
      await i18n.init({
        lng,
        resources: { [lng]: { translation: locale } },
        interpolation,
      });
      expect([
        i18n.t("dock.reviewProgress", { complete: 0, count: 1 }),
        i18n.t("dock.reviewProgress", { complete: 1, count: 3 }),
        i18n.t("dock.mapProgress", { complete: 0, count: 1 }),
        i18n.t("dock.mapProgress", { complete: 2, count: 4 }),
      ]).toEqual(expected[lng]);
    }
  });

  // The run line has one ellipsis over its words (`RunLine` in
  // `runStatus.tsx`), so every live phrase with a growing part must end in it,
  // a closing quote aside. A growing part mid-sentence cuts the words after
  // it instead of itself.
  it("ends every live phrase that can grow in its growing part", () => {
    const growing = /\{\{(subject|model)\}\}[”»"]?$/;
    for (const [name, locale] of [
      ["en", en],
      ["it", italian],
    ] as const) {
      const live: Record<string, string> = {
        waiting: locale.dock.waiting,
        ...Object.fromEntries(
          Object.entries(locale.dock.doing).filter(([key]) =>
            key.endsWith("_named"),
          ),
        ),
      };
      for (const [key, phrase] of Object.entries(live))
        expect(phrase, `${name} dock.${key}`).toMatch(growing);
    }
  });

  // The starting-shape catalogue holds locale keys as plain strings, so a typo
  // in one is invisible to the compiler and lands in the writer's own folder
  // as a Part title spelling the raw key.
  it("has a name for every shape and every Part it creates", () => {
    for (const id of SHAPE_IDS) {
      expect(
        read(en, `create.shape.${id}`),
        `en create.shape.${id}`,
      ).toBeTruthy();
      expect(
        read(italian, `create.shape.${id}`),
        `it create.shape.${id}`,
      ).toBeTruthy();
      for (const key of partKeysFor(id)) {
        expect(read(en, key), `en ${key}`).toBeTruthy();
        expect(read(italian, key), `it ${key}`).toBeTruthy();
      }
    }
  });

  // A Part title is a file name, so an accent or a macron in one lands on the
  // writer's disk.
  it("keeps every Part title plain ASCII in both languages", () => {
    for (const id of SHAPE_IDS) {
      for (const key of partKeysFor(id)) {
        expect(String(read(en, key)), `en ${key}`).toMatch(/^[\x20-\x7E]+$/);
        expect(String(read(italian, key)), `it ${key}`).toMatch(
          /^[\x20-\x7E]+$/,
        );
      }
    }
  });

  // A `/map` refusal names the move that maps it instead, and that move must
  // be one the parser runs: every scope word a refusal teaches is in the
  // `/map` skill's scopes.
  it("never has a /map refusal teach a scope word /map does not take", () => {
    const map = aiSkills.find((skill) => skill.command === "map");
    expect(map).toBeDefined();
    for (const [name, locale] of [
      ["en", en],
      ["it", italian],
    ] as const) {
      const problems = locale.dock.problem as Record<string, string>;
      for (const [key, text] of Object.entries(problems)) {
        if (!key.startsWith("map-")) continue;
        for (const kind of ["section", "part", "structure"] as const)
          if (text.includes(`{{${kind}}}`))
            expect(map?.scopes, `${name} ${key}`).toContain(kind);
      }
    }
  });
});

const read = (obj: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (acc, part) => (acc as Record<string, unknown>)?.[part],
      obj,
    );
