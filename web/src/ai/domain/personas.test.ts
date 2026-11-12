// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERSONA,
  parsePersona,
  parsePersonaName,
  personaById,
  personasFor,
  PERSONAS,
  resolveDefault,
  resolveFace,
  voiceStem,
} from "./personas";
import { CHAT_KINDS } from "./types";
import type { PersonaDefinition } from "./types";

// Nothing here names a persona: every assertion is about a property of
// whatever the folder holds. Renaming a voice changes the folder and not the
// tests, and no test passes on a folder that drifted from a list it claims.

const file = (lines: string[]) => lines.join("\n");

/** Whatever the bundler hands back for a `.png`: a URL, and nothing more. */
const FACE = "/assets/a-voice.png";

const good = file([
  "---",
  "name: A Voice",
  "color: #336699",
  "description: A test reader",
  "compatibleWith: general, editorial",
  "preset.plain: B.causality, F.echo",
  "---",
  "",
  "Read it and say what you find.",
]);

describe("persona files", () => {
  it("takes the id and the default marker from the file NAME", () => {
    expect(parsePersonaName("./personas/10-one.default.md")).toEqual({
      id: "10",
      isDefault: true,
    });
    expect(parsePersonaName("./personas/20-two-words.md")).toEqual({
      id: "20",
      isDefault: false,
    });
    // The slug is matched and discarded: it exists so the folder reads to a
    // human, not so anything downstream can parse a name out of it.
    for (const bad of [
      "./personas/no-digits.md",
      "./personas/30.md",
      "./personas/40-Upper.md",
      "./personas/50-one.defaults.md",
      "./personas/60-one-.md",
    ])
      expect(() => parsePersonaName(bad)).toThrow(/is not <id>-<name>/);
  });

  it("refuses a malformed persona file rather than shipping a silent one", () => {
    // The failure this guards is the one a writer cannot see: a persona with
    // no instructions is a chat answering in the model's own default voice and
    // saying nothing about it. Throwing means build time for the bundle and
    // the first import in a test, which is where a broken file belongs.
    const parsed = parsePersona("./personas/90-a-voice.md", good, FACE);
    expect(parsed.id).toBe("90");
    expect(parsed.name).toBe("A Voice");
    expect(parsed.compatibleWith).toEqual(["general", "editorial"]);
    expect(parsed.instructions).toBe("Read it and say what you find.");

    const at = (path: string, text: string) => () =>
      parsePersona(path, text, FACE);
    expect(at("./personas/90-a-voice.md", "no frontmatter at all")).toThrow(
      /no frontmatter/,
    );
    expect(
      at("./personas/90-a-voice.md", good.replace("name: A Voice", "name")),
    ).toThrow(/bad line/);
    expect(
      at("./personas/90-a-voice.md", good.replace("name: A Voice", "name:")),
    ).toThrow(/missing name/);
    expect(
      at(
        "./personas/90-a-voice.md",
        good.replace("description: A test reader", "description:"),
      ),
    ).toThrow(/missing description/);
    // The body is the instructions, and the shared reader names it as the
    // body: the persona layer adds which fields are required, not a second
    // vocabulary for the same file's parts.
    expect(
      at(
        "./personas/90-a-voice.md",
        good.replace("Read it and say what you find.", ""),
      ),
    ).toThrow(/no body/);
  });
});

describe("a persona's face", () => {
  it("pairs the picture to the markdown by the stem they share", () => {
    // Not by id: `10-anything.png` would satisfy `10-phos.default.md` under an
    // id-keyed pairing, and the folder would be one careless rename away from
    // a voice wearing another's face with nothing failing to say so.
    expect(voiceStem("./personas/10-phos.default.md")).toBe("10-phos");
    expect(voiceStem("./personas/10-phos.png")).toBe("10-phos");
    expect(voiceStem("./personas/20-two-words.md")).toBe("20-two-words");

    const faces = { "./personas/10-phos.png": "/assets/10-phos-abc.png" };
    expect(resolveFace("./personas/10-phos.default.md", faces)).toBe(
      "/assets/10-phos-abc.png",
    );
  });

  it("refuses a voice with no face rather than drawing a hole", () => {
    // Unreachable from the shipped folder, so it is fired here: a guard
    // nobody has seen fire is a guard nobody knows works. Both alternatives
    // are worse than a build failure: a placeholder ships the hole and tells
    // nobody who could fix it, and a nullable avatar pushes the same silence
    // into both pickers.
    expect(() => resolveFace("./personas/10-phos.default.md", {})).toThrow(
      /10-phos\.md has no 10-phos\.png/,
    );
    // The id matching is not enough on its own.
    expect(() =>
      resolveFace("./personas/10-phos.default.md", {
        "./personas/10-other.png": "/assets/10-other.png",
      }),
    ).toThrow(/has no 10-phos/);
  });
});

describe("a folder's coherence", () => {
  // The shipped folder satisfies all three of these by construction, so none
  // of `resolveDefault`'s guards is reachable from the real set. They are
  // fired here against folders this test invents, the only way to know they
  // work: a guard nobody has seen fire is a guard nobody knows works.
  const voice = (id: string): PersonaDefinition => ({
    id,
    name: `Voice ${id}`,
    description: "A voice",
    compatibleWith: ["general"],
    instructions: "Answer plainly.",
    presets: [],
    ignores: [],
    avatar: FACE,
    color: "#336699",
  });

  it("names the one default, and refuses every other arrangement", () => {
    const two = [voice("10"), voice("20")];
    expect(resolveDefault(two, ["20"])).toBe(two[1]);
    expect(() => resolveDefault(two, [])).toThrow(/exactly one/);
    expect(() => resolveDefault(two, ["10", "20"])).toThrow(/exactly one/);
    expect(() => resolveDefault(two, ["30"])).toThrow(/did not parse/);
    expect(() => resolveDefault([voice("10"), voice("10")], ["10"])).toThrow(
      /duplicate id 10/,
    );
  });
});

describe("the persona folder", () => {
  it("is the list, in the order of the ids on the files", () => {
    // The folder is the list: adding a voice is adding a file, and there is no
    // second table of names to keep in step with the first.
    expect(PERSONAS.length).toBeGreaterThan(1);
    const ids = PERSONAS.map((one) => one.id);
    expect(ids).toEqual([...ids].sort((a, b) => Number(a) - Number(b)));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries a whole definition in every file", () => {
    for (const one of PERSONAS) {
      expect(one.name.trim()).toBe(one.name);
      expect(one.name).not.toBe("");
      expect(one.description).not.toBe("");
      // The instructions are the file's body rather than one of its headers.
      expect(one.instructions).toBe(one.instructions.trim());
      expect(one.instructions).not.toContain("---");
      expect(one.instructions.length).toBeGreaterThan(80);
      // A voice is the sound, never the form; the room owns form
      // (`policy.ts`).
      expect(one.instructions, one.id).not.toMatch(
        /\b(tables?|bullet(ed)?|numbered lists?|headings?|headed sections|markdown|word count|in \d+ words)\b/i,
      );
      // `compatibleWith` is a comma list in the file and must arrive as real
      // kinds, not as one string with commas in it.
      expect(one.compatibleWith.length).toBeGreaterThan(0);
      for (const kind of one.compatibleWith) expect(CHAT_KINDS).toContain(kind);
    }
  });

  it("gives every voice a face from the folder beside it", () => {
    // The pickers draw the face next to the name, so a voice without one is a
    // ragged row in one surface and an empty chip in the other. `resolveFace`
    // throws at module load rather than letting either happen, which means
    // this assertion can only fail by the field being dropped; the missing
    // file case never gets this far.
    for (const one of PERSONAS) {
      expect(one.avatar).not.toBe("");
      expect(one.avatar).toMatch(/\.png/);
    }
    // And no two voices share one face, which an id-keyed pairing could not
    // have promised.
    const faces = PERSONAS.map((one) => one.avatar);
    expect(new Set(faces).size).toBe(faces.length);
  });

  it("declares exactly one default, first in every room it works in", () => {
    // Not every voice works in every room, and the editor-in-chief does not
    // read as a first reader. `assistant.ts` opens a new chat on the first
    // compatible persona, so where the default works it must be first,
    // because a blank page meeting a specialist is silent in a way a file
    // name is not. Every room must have some voice, or a new chat opens on
    // nothing.
    expect(PERSONAS).toContain(DEFAULT_PERSONA);
    for (const kind of CHAT_KINDS) {
      expect(personasFor(kind).length).toBeGreaterThan(0);
      if (DEFAULT_PERSONA.compatibleWith.includes(kind))
        expect(personasFor(kind)[0]).toBe(DEFAULT_PERSONA);
    }
  });

  it("offers each chat kind only the voices that declare it", () => {
    for (const kind of CHAT_KINDS) {
      const offered = personasFor(kind);
      expect(offered.length).toBeGreaterThan(0);
      for (const one of PERSONAS)
        expect(offered.includes(one)).toBe(one.compatibleWith.includes(kind));
    }
  });

  it("keeps the reader voices out of a drafting chat", () => {
    // A drafting chat is the writer mid-scene wanting prose back, and every
    // reader persona is horizon-bound by construction: it knows only what
    // has been read up to a point. A partner that cannot see the scene being
    // written is worse than no partner, so a voice offered for drafting must
    // not be reader-only.
    for (const one of personasFor("drafting"))
      expect(
        one.compatibleWith.some(
          (kind) => kind !== "alpha-reader" && kind !== "beta-reader",
        ),
      ).toBe(true);
  });

  it("answers by id only within a compatible kind", () => {
    const [first] = PERSONAS;
    expect(personaById(first.id, first.compatibleWith[0])).toBe(first);
    expect(personaById("no-such-id", "general")).toBeNull();
    // An id that exists but whose voice does not suit the kind is a miss, not
    // a match: `assistant.ts` reads that as `persona-missing` and asks the
    // writer to choose, which is why the kind is a parameter.
    const narrow = PERSONAS.filter(
      (one) => !one.compatibleWith.includes("drafting"),
    );
    expect(narrow.length).toBeGreaterThan(0);
    for (const one of narrow)
      expect(personaById(one.id, "drafting")).toBeNull();
  });
});

describe("a persona file's presets and referrals", () => {
  const lines = (...extra: string[]) =>
    file([
      "---",
      "name: A Voice",
      "color: #336699",
      "description: A test reader",
      "compatibleWith: general, editorial",
      ...extra,
      "---",
      "",
      "Read it and say what you find.",
    ]);
  const at = (text: string) => () =>
    parsePersona("./personas/90-a-voice.md", text, FACE);

  it("takes the persona's colour as #rrggbb, and refuses anything else", () => {
    const plain = lines("preset.plain: B.causality");
    expect(at(plain)().color).toBe("#336699");
    const without = plain.replace("color: #336699\n", "");
    expect(at(without)).toThrow(/missing color/);
    expect(at(plain.replace("#336699", "teal"))).toThrow(
      /color must be #rrggbb/,
    );
    // Every shipped voice declares one, for the margin's marks and counts.
    for (const one of PERSONAS) expect(one.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("reads presets in file order, with their rooms and reads", () => {
    const parsed = at(
      lines(
        "preset.first: B.causality, F.echo",
        "preset.first.chats: editorial",
        "preset.first.reads: guidebook:prose-style, characters",
        "preset.second: G.tags",
        "ignores: A > 10, B > 20",
      ),
    )();
    expect(parsed.presets).toEqual([
      {
        id: "first",
        chats: ["editorial"],
        obsessions: ["B.causality", "F.echo"],
        reads: [
          { group: "guidebook", sectionId: "prose-style" },
          { group: "characters" },
        ],
      },
      {
        id: "second",
        chats: ["general", "editorial"],
        obsessions: ["G.tags"],
        reads: [],
      },
    ]);
    expect(parsed.ignores).toEqual([
      { domain: "A", personaId: "10" },
      { domain: "B", personaId: "20" },
    ]);
  });

  it("refuses a preset the file cannot keep", () => {
    expect(at(lines("preset.Bad: B.causality"))).toThrow(/not a preset line/);
    expect(
      at(lines("preset.one: B.causality", "preset.two.chats: general")),
    ).toThrow(/names no preset/);
    expect(
      at(
        lines(
          "preset.one: A.hook, A.promise, A.title, A.length, A.comps, A.series",
        ),
      ),
    ).toThrow(/more than 5/);
    expect(at(lines("preset.one: A.hook, A.hook"))).toThrow(
      /names an obsession twice/,
    );
    expect(
      at(lines("preset.one: A.hook", "preset.one.chats: beta-reader")),
    ).toThrow(/works in beta-reader, the persona does not/);
    expect(
      at(lines("preset.one: A.hook", "preset.one.chats: general")),
    ).toThrow(/no preset for editorial/);
    expect(at(lines("preset.one: A.hook", "ignores: structure"))).toThrow(
      /not <domain> > <id>/,
    );
  });
});

// How each voice sounds: not the wording, which is copy and free to change,
// but the one marker per voice that makes it audible in any language, its
// register and address.
describe("the four voices", () => {
  const body = (name: string) =>
    PERSONAS.find((one) => one.name === name)?.instructions ?? "";

  it("gives each voice a register the writer can hear", () => {
    expect(body("Phos")).toMatch(/formal "you"/);
    expect(body("Phos")).toContain("respectful and structured");
    expect(body("Nova")).toContain("strict professional tone");
    expect(body("Nova")).toMatch(/formal "you"/);
    expect(body("Spark")).toContain("enthusiastic");
    expect(body("Spark")).toMatch(/informal "you"/);
    expect(body("Lumi")).toContain("someone who loves to read");
    expect(body("Lumi")).toMatch(/informal "you"/);
  });

  it("keeps Nova in the formal singular, never the plural", () => {
    // A plural "fate vedere" beside a singular "desidera" in one answer
    // breaks the address.
    expect(body("Nova")).toContain('the Italian "Lei"');
    expect(body("Nova")).toContain("never switch to a plural address");
  });

  it("keeps Lumi one speaker, in one gender and a reader's words", () => {
    // One page must not move from "mi sono affezionata" to "da lettore", nor
    // speak of a "conflitto promettente" in a room that forbids a teacher's
    // words.
    expect(body("Lumi")).toContain("every word that refers to you is feminine");
    expect(body("Lumi")).toMatch(/not arc, conflict, pacing/);
  });
});
