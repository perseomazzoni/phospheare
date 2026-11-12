// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  EDITING_BRIEF,
  READER_WORKFLOWS,
  actionOf,
  aiSkills,
  asksAt,
  autonomousSkills,
  bySkillFile,
  commandArgument,
  completesTitle,
  summariseSkill,
  commandLine,
  mapSkill,
  nearestCommand,
  offersReviewAgain,
  offersWorkflow,
  parseCommand,
  questionOf,
  quoteIsArgument,
  readsFor,
  whereSkill,
  workflowSkill,
  readSkill as readSkillFile,
  GUIDE_LANGUAGES,
  skillFor,
  skillsFor,
  verifySkill,
  type AiSkill,
  type Workflow,
} from "./skills";
import { CHAT_KINDS, type ChatKind, type ReviewScope } from "./types";
import { OBSESSIONS } from "./obsessions";

// Every synthetic file below carries a full guide, so each row still fails
// (or loads) for the reason it is about; the guide's own rows use
// `readSkillFile` directly.
const GUIDE_LINES = GUIDE_LANGUAGES.flatMap((language) =>
  ["what", "when", "how"].map((part) => `guide.${language}.${part}: ${part}`),
).join("\n");
const readSkill = (path: string, text: string) =>
  readSkillFile(path, text.replace(/^---\n/, `---\n${GUIDE_LINES}\n`));

// A command's guide is required of every file; these hand-built commands
// test other things, so any guide will do.
const TEST_GUIDE = {
  en: { what: "What.", when: "When.", how: "How." },
  it: { what: "Cosa.", when: "Quando.", how: "Come." },
};

// The registry is built from a folder, so what is worth pinning is not the
// contents of any one instruction, which is editorial copy and will be
// rewritten, but the rules that make a folder safe to be a list.

describe("the editorial skills", () => {
  it("names one command per file, with its ordering prefix stripped", () => {
    expect(aiSkills.map((skill) => skill.command)).toEqual([
      "unresolved",
      "continuity",
      "summarise",
      "canon",
      "structure-and-motivation",
      "line-editing",
      "where",
      "map",
      "how-to-say",
      // `100-verify.md`, after `90-how-to-say.md` only because the prefixes
      // sort as numbers (`bySkillFile`).
      "verify",
      // The readers' own, after every editor's command: the beta reader's
      // first.
      "read-on",
      "predict",
      "put-down",
      "review",
      "blurb",
      // And the alpha reader's.
      "heart",
      "intent",
      // The drafting room's own.
      "unstick",
      "what-if",
      "scene-plan",
      // And the editor's other three.
      "letter",
      "sensitivity",
      "first-pages",
      // And the genre's contract, read against the declared genre.
      "genre",
    ]);
  });

  // Both halves of the split: the registry keeps the prefixes' order, and
  // every chat's menu is sorted alphabetically.
  it("keeps the files' order in the registry, and offers each menu alphabetically", () => {
    const alphabetical = [...aiSkills].map((skill) => skill.command).sort();
    expect(aiSkills.map((skill) => skill.command)).not.toEqual(alphabetical);
    expect(aiSkills[0].command).toBe("unresolved");
    for (const kind of CHAT_KINDS) {
      const menu = skillsFor(kind).map((skill) => skill.command);
      expect(menu).toEqual([...menu].sort());
    }
    expect(skillsFor("editorial")[0].command).toBe("canon");
  });

  it("orders the prefixes as numbers, so a hundred comes after ninety", () => {
    const files = [
      "./skills/100-verify.md",
      "./skills/20-continuity.md",
      "./skills/90-how-to-say.md",
      "./skills/10-unresolved.md",
    ];
    expect([...files].sort(bySkillFile)).toEqual([
      "./skills/10-unresolved.md",
      "./skills/20-continuity.md",
      "./skills/90-how-to-say.md",
      "./skills/100-verify.md",
    ]);
  });

  it("carries a guide for the writer in every interface language, beside the instruction", () => {
    for (const skill of aiSkills)
      for (const language of GUIDE_LANGUAGES)
        for (const part of ["what", "when", "how"] as const) {
          const line = skill.guide[language][part];
          expect(line.length).toBeGreaterThan(10);
          // Copy for the writer, never for the model: the instruction is
          // what is sent, and it must not carry the guide by accident.
          expect(skill.instruction).not.toContain(line);
        }
    // A command without one does not load: the writer is never shown a
    // command nobody explained.
    const bare = "---\nchats: general\n---\nAsk this.";
    expect(() => readSkillFile("x.md", bare)).toThrow(
      "x.md: missing guide.en.what",
    );
    expect(() =>
      readSkillFile(
        "x.md",
        bare.replace(
          "---\n",
          "---\nguide.en.what: a\nguide.en.when: b\nguide.en.how: c\n",
        ),
      ),
    ).toThrow("x.md: missing guide.it.what");
  });

  it("carries an instruction behind every command", () => {
    expect(aiSkills.length).toBeGreaterThan(0);
    for (const skill of aiSkills) {
      // Trimmed, because the instruction is handed to the model as the
      // writer's question and a leading blank line is a token spent on
      // nothing.
      expect(skill.instruction).toBe(skill.instruction.trim());
      expect(skill.instruction).not.toBe("");
      // No `{{token}}` substitution here, unlike the reference templates: a
      // skill is asked as-is, so a placeholder would reach the model verbatim.
      expect(skill.instruction).not.toContain("{{");
    }
  });

  it("matches a command exactly, with or without its slash, and guesses nothing", () => {
    expect(skillFor("/continuity")?.command).toBe("continuity");
    expect(skillFor("continuity")?.command).toBe("continuity");
    // A prefix is not a command. The composer opens its menu on a bare `/`
    // and never completes what the writer is still typing, so a lookup that
    // resolved "con" to the first match would be a second, conflicting rule
    // about what a half-typed word means.
    expect(skillFor("/con")).toBeNull();
    expect(skillFor("")).toBeNull();
    expect(skillFor("/")).toBeNull();
  });
});

// Where a command lives, and what it reads.

const skill = (over: Partial<AiSkill>): AiSkill => ({
  command: "unresolved",
  instruction: "What is open.",
  chats: ["editorial"],
  scopes: [],
  reads: [],
  needs: [],
  lenses: [],
  guide: TEST_GUIDE,
  ...over,
});

const where = skill({
  command: "where",
  chats: ["general", "drafting", "editorial"],
  argument: "text",
});
const continuity = skill({
  command: "continuity",
  reviewTask: "continuity",
  scopes: ["section", "structure"],
});
const lineEditing = skill({
  command: "line-editing",
  reviewTask: "line",
  scopes: ["section"],
});

describe("which chats offer a command", () => {
  it("keeps every command that says nothing in the Editorial chat", () => {
    // Editorial is the default, so a file that names no chats lands in
    // Editorial alone and leaves every other chat's menu as it is.
    expect(
      readSkill("x.md", "---\nreviewTask: line\n---\nBody.").chats,
    ).toEqual(["editorial"]);
    expect(
      readSkill("x.md", "---\nargument: text\n---\nAsk this.").chats,
    ).toEqual(["editorial"]);
    // Only a command that takes the writer's own words, a workflow or a
    // question (`/how-to-say`), names chats beyond it, and never a reader's
    // alongside an editor's. A review keeps Editorial alone. A reader's
    // command is offered to readers alone, takes no words and no scope, and
    // runs a reader's workflow or none; `readSkill` holds that at build time,
    // so a reader is never handed a command that could point past its
    // horizon.
    const reader = (kind: string) =>
      kind === "alpha-reader" || kind === "beta-reader";
    const settled = (one: AiSkill) =>
      actionOf(one) === "review"
        ? one.chats.length === 1 && one.chats[0] === "editorial"
        : one.chats.some(reader)
          ? one.chats.every(reader) &&
            one.argument === undefined &&
            one.scopes.length === 0 &&
            (one.workflow === undefined ||
              READER_WORKFLOWS.includes(one.workflow))
          : one.workflow !== undefined ||
            one.argument === "text" ||
            // The drafting room's own questions: `/unstick`, `/what-if` and
            // `/scene-plan` take no words, because the open scene is their
            // subject, and are offered there alone.
            one.chats.every((kind) => kind === "drafting");
    for (const one of aiSkills)
      if (one.chats.length > 1 || one.chats[0] !== "editorial")
        expect(settled(one), one.command).toBe(true);
    // And the rule bites: a review that names chats is caught, and so is a
    // question that takes no words of the writer's, or one offered to a
    // reader.
    expect(
      settled(readSkill("x.md", "---\nchats: general\n---\nAsk this.")),
    ).toBe(false);
    // A question offered to a reader beside an editor does not load: the
    // build-time guard refuses it before any menu could offer it.
    expect(() =>
      readSkill(
        "x.md",
        "---\nargument: text\nchats: general, beta-reader\n---\nAsk this.",
      ),
    ).toThrow(/readers alone/);
    expect(
      settled(
        readSkill(
          "x.md",
          "---\nreviewTask: consistency\nchats: general, editorial\n---\nBody.",
        ),
      ),
    ).toBe(false);
  });

  it("gives a reader only commands that stay inside its horizon", () => {
    // Every way a reader's command could reach past the horizon is refused
    // at build time, by name.
    const load = (head: string) => () =>
      readSkill("x.md", `---\n${head}\n---\nBody.`);
    expect(load("chats: beta-reader")).not.toThrow();
    expect(load("workflow: journal\nchats: beta-reader")).not.toThrow();
    expect(load("workflow: predict\nchats: beta-reader")).not.toThrow();
    expect(load("chats: alpha-reader, editorial")).toThrow(/readers alone/);
    expect(load("reviewTask: line\nchats: beta-reader")).toThrow(
      /runs no review/,
    );
    expect(load("argument: text\nchats: beta-reader")).toThrow(
      /no words and no scope/,
    );
    expect(load("workflow: map\nscopes: part\nchats: beta-reader")).toThrow(
      /no words and no scope/,
    );
    // Every shipped reader command is one of these.
    for (const kind of ["alpha-reader", "beta-reader"] as const)
      for (const one of skillsFor(kind)) {
        expect(one.chats.every((chat) => chat.endsWith("-reader"))).toBe(true);
        expect(one.scopes).toEqual([]);
        expect(one.argument).toBeUndefined();
      }
  });

  it("reads what a command cannot do without, and never past a reader's sight", () => {
    const load = (head: string) =>
      readSkill("x.md", `---\n${head}\n---\nBody.`);
    expect(load("chats: general").needs).toEqual([]);
    expect(
      load("chats: general\nneeds: guidebook:promise, characters").needs,
    ).toEqual([
      { group: "guidebook", sectionId: "promise" },
      { group: "characters" },
    ]);
    // A beta reader sees only the back cover, so it can need only that.
    expect(
      load("chats: beta-reader\nneeds: guidebook:blurb").needs,
    ).toHaveLength(1);
    expect(() => load("chats: beta-reader\nneeds: guidebook:promise")).toThrow(
      /cannot see "guidebook:promise"/,
    );
    expect(() => load("chats: alpha-reader\nneeds: characters")).toThrow(
      /cannot see "characters"/,
    );
    expect(() => load("chats: general\nneeds: nowhere")).toThrow(
      /unknown reference group/,
    );
    // The shipped ones.
    expect(skillFor("/blurb")?.needs).toEqual([
      { group: "guidebook", sectionId: "blurb" },
    ]);
    expect(skillFor("/intent")?.needs.length).toBeGreaterThan(1);
  });

  it("lets only an editor's question read the other chats, and only a question read the opening", () => {
    const load = (head: string) => () =>
      readSkill("x.md", `---\n${head}\n---\nBody.`);
    expect(load("chats: editorial\nevidence: rooms")().evidence).toBe("rooms");
    expect(load("chats: general\ntarget: opening")().target).toBe("opening");
    // The direction rule, at build time.
    expect(load("chats: general\nevidence: rooms")).toThrow(
      /only an Editorial command reads the other chats/,
    );
    expect(load("chats: beta-reader\nevidence: rooms")).toThrow(
      /only an Editorial command/,
    );
    expect(load("chats: editorial\nevidence: all")).toThrow(
      /evidence must be "rooms"/,
    );
    expect(load("reviewTask: line\nevidence: rooms")).toThrow(
      /only a question reads evidence or a target/,
    );
    expect(load("chats: editorial\ntarget: middle")).toThrow(
      /target must be "opening"/,
    );
    expect(load("chats: alpha-reader\ntarget: opening")).toThrow(
      /a reader reads where its horizon says/,
    );
    expect(skillFor("/letter")?.evidence).toBe("rooms");
    expect(skillFor("/first-pages")?.target).toBe("opening");
    expect(skillFor("/sensitivity")?.reviewTask).toBe("sensitivity");
  });

  it("offers a command only in the chats it names", () => {
    const skills = [continuity, where];
    expect(skillsFor("editorial", skills)).toEqual([continuity, where]);
    expect(skillsFor("general", skills)).toEqual([where]);
    expect(skillsFor("alpha-reader", skills)).toEqual([]);
  });
});

describe("a skill file, read strictly", () => {
  it("refuses a file that says something this app cannot do", () => {
    expect(() =>
      readSkill("x.md", "---\nargument: text\nscopes: section\n---\nBody."),
    ).toThrow("x.md: a command takes an argument or scopes, not both");
    expect(() =>
      readSkill("x.md", "---\nreviewTask: vibes\n---\nBody."),
    ).toThrow('x.md: unknown review task "vibes"');
  });

  it("refuses words after a review, which reads the manuscript, not a line", () => {
    expect(() =>
      readSkill("x.md", "---\nargument: text\nreviewTask: line\n---\nBody."),
    ).toThrow("x.md: a review takes no text");
  });

  it("reads the Editing brief first in every review, from one place", () => {
    const read = readSkill(
      "x.md",
      "---\nreviewTask: line\nreads: guidebook:prose-style, characters\n---\nBody.",
    );
    expect(read.reads).toEqual([
      EDITING_BRIEF,
      { group: "guidebook", sectionId: "prose-style" },
      { group: "characters" },
    ]);
    // A review that declares nothing still reads what the writer asked of
    // every review.
    expect(
      readSkill("x.md", "---\nreviewTask: line\n---\nBody.").reads,
    ).toEqual([EDITING_BRIEF]);
    // Only a review reads the brief first; a question reads its own list
    // (`/scene-plan`'s cast and places) and never the brief by default,
    // which is the editor's paperwork, not the drafter's.
    for (const one of aiSkills)
      if (one.reviewTask) expect(one.reads[0]).toEqual(EDITING_BRIEF);
      else expect(one.reads).not.toContainEqual(EDITING_BRIEF);
  });

  it("answers every task's reads from its one file (readsFor)", () => {
    for (const one of aiSkills)
      if (one.reviewTask) expect(readsFor(one.reviewTask)).toBe(one.reads);
    expect(readsFor("continuity")[0]).toEqual(EDITING_BRIEF);
  });

  it("refuses reads a review cannot honour", () => {
    // A second home for the brief would drift from the first.
    expect(() =>
      readSkill(
        "x.md",
        "---\nreviewTask: line\nreads: guidebook:editing-brief\n---\nBody.",
      ),
    ).toThrow("x.md: every review reads the Editing brief already");
    // A question's reads go with its one turn, so they are kept; a workflow
    // builds its own request and would read none of them.
    expect(
      readSkill("x.md", "---\nreads: characters\n---\nBody.").reads,
    ).toEqual([{ group: "characters" }]);
    expect(() =>
      readSkill(
        "x.md",
        "---\nworkflow: journal\nchats: beta-reader\nreads: characters\n---\nBody.",
      ),
    ).toThrow("x.md: a workflow command reads no references");
  });
});

describe("parseCommand", () => {
  const skills = [continuity, where];

  const scoped = (one: AiSkill, scope: ReviewScope) => ({
    kind: "scoped",
    skill: one,
    scope,
  });

  it("reads a review command strictly, at the nearest scope unless told otherwise", () => {
    expect(parseCommand("/continuity", skills)).toEqual(
      scoped(continuity, { kind: "current" }),
    );
    expect(parseCommand("/continuity structure", skills)).toEqual(
      scoped(continuity, { kind: "structure" }),
    );
    // `full` is no scope word: it is a question, like any word the
    // command does not know.
    expect(parseCommand("/continuity full", skills)).toBeNull();
    expect(parseCommand("/continuity focused", skills)).toBeNull();
    // A sentence is a question, never a guess at what was meant.
    expect(parseCommand("/continuity in chapter two", skills)).toBeNull();
  });

  it("takes the scope words in both languages, whatever the case", () => {
    expect(parseCommand("/continuity Sezione", skills)).toEqual(
      scoped(continuity, { kind: "section" }),
    );
    expect(parseCommand("/continuity  STRUTTURA ", skills)).toEqual(
      scoped(continuity, { kind: "structure" }),
    );
  });

  it("offers a scope only to a command that declares it", () => {
    // `/line-editing` over the whole Structure is hundreds of findings and
    // hours; the word is a question there, and never read as a title.
    const nodes = [{ id: "s", title: "structure" }];
    expect(
      parseCommand("/line-editing structure", [lineEditing], {
        nodes,
        references: [],
      }),
    ).toBeNull();
    expect(parseCommand("/line-editing section", [lineEditing])).toEqual(
      scoped(lineEditing, { kind: "section" }),
    );
  });

  it("offers part to every shipped review, and structure to all but line editing", () => {
    const shipped = (command: string) =>
      aiSkills.find((one) => one.command === command);
    for (const command of [
      "unresolved",
      "continuity",
      "canon",
      "structure-and-motivation",
    ])
      expect(shipped(command)?.scopes).toEqual([
        "section",
        "part",
        "structure",
      ]);
    expect(shipped("line-editing")?.scopes).toEqual(["section", "part"]);
    expect(parseCommand("/continuity parte")).toMatchObject({
      kind: "scoped",
      scope: { kind: "part" },
    });
    expect(parseCommand("/line-editing Part")).toMatchObject({
      scope: { kind: "part" },
    });
    expect(parseCommand("/line-editing structure")).toBeNull();
  });

  it("resolves a title to its node, and holds only the id", () => {
    const nodes = [
      { id: "harbour", title: "The Harbour" },
      { id: "fire", title: "The  Fire" },
    ];
    expect(
      parseCommand("/continuity the harbour", skills, {
        nodes,
        references: [],
      }),
    ).toEqual(scoped(continuity, { kind: "node", nodeId: "harbour" }));
    expect(
      parseCommand("/continuity The Fire", skills, { nodes, references: [] }),
    ).toEqual(scoped(continuity, { kind: "node", nodeId: "fire" }));
    // Exact: a prefix or a sentence that begins like a title is a question.
    expect(
      parseCommand("/continuity The Harb", skills, { nodes, references: [] }),
    ).toBeNull();
    expect(
      parseCommand("/continuity The Harbour at night", skills, {
        nodes,
        references: [],
      }),
    ).toBeNull();
    // With no Structure handed in, no title matches.
    expect(parseCommand("/continuity The Harbour", skills)).toBeNull();
  });

  it("lets a scope word win over a title that spells it, and names no twin", () => {
    // A Section called "Struttura" loses to the word: the word is the one
    // the menu teaches, and the Section can still be read with its Part.
    const nodes = [
      { id: "odd", title: "Struttura" },
      { id: "a", title: "Twin" },
      { id: "b", title: "twin" },
    ];
    expect(
      parseCommand("/continuity struttura", skills, { nodes, references: [] }),
    ).toEqual(scoped(continuity, { kind: "structure" }));
    // Two nodes with one title name neither: guessing would read the wrong
    // one without a word said.
    expect(
      parseCommand("/continuity twin", skills, { nodes, references: [] }),
    ).toBeNull();
  });

  it("gives a command that takes an argument the rest of the line, verbatim", () => {
    expect(
      parseCommand("  /where   the car crash, at night  ", skills),
    ).toEqual({
      kind: "text",
      skill: where,
      argument: "the car crash, at night",
    });
  });

  it("holds a bare argument command as a command, never a question", () => {
    expect(parseCommand("/where", skills)).toEqual({
      kind: "text",
      skill: where,
      argument: "",
    });
  });

  it("does not know a command the chat does not offer", () => {
    expect(parseCommand("/where the crash", [continuity])).toBeNull();
  });

  // `/map` alone is the whole Structure, its workflow's bare scope, so
  // `current` keeps its one meaning.
  it("reads a bare /map as the whole Structure, and its words as offered", () => {
    const map = skill({
      command: "map",
      workflow: "map",
      chats: ["general", "drafting", "editorial"],
      scopes: ["part", "structure"],
    });
    const nodes = [
      { id: "one", title: "Part One" },
      { id: "s1", title: "Harbour" },
    ];
    expect(parseCommand("/map", [map])).toEqual(
      scoped(map, { kind: "structure" }),
    );
    expect(parseCommand("/map parte", [map])).toEqual(
      scoped(map, { kind: "part" }),
    );
    // A title parses to its node; a Section's maps that Section, never
    // widening to its Part.
    expect(
      parseCommand("/map Harbour", [map], { nodes, references: [] }),
    ).toEqual(scoped(map, { kind: "node", nodeId: "s1" }));
    // A word the command does not offer stays a question.
    expect(
      parseCommand("/map section", [map], { nodes, references: [] }),
    ).toBeNull();
  });

  // A shape word may close a `/map` line. The order is the scope
  // word, then the exact title, then the shape, so a line that parses
  // without a shape keeps its meaning and only one that parsed to nothing
  // gains one.
  describe("a shape word after /map", () => {
    const map = skill({
      command: "map",
      workflow: "map",
      chats: ["general", "drafting", "editorial"],
      scopes: ["part", "structure"],
    });
    const nodes = [
      { id: "one", title: "Part One" },
      { id: "hero", title: "The Hero" },
      { id: "s1", title: "Harbour" },
    ];
    const withShape = (scope: ReviewScope, shape: string) => ({
      ...scoped(map, scope),
      shape,
    });

    it("reads a shape alone as the bare reach on that shape, in either language", () => {
      expect(parseCommand("/map hero", [map])).toEqual(
        withShape({ kind: "structure" }, "herosjourney"),
      );
      expect(parseCommand("/map tre-atti", [map])).toEqual(
        withShape({ kind: "structure" }, "threeact"),
      );
      expect(parseCommand("/map Freytag", [map])).toEqual(
        withShape({ kind: "structure" }, "freytagspyramid"),
      );
    });

    it("reads a reach and then a shape", () => {
      expect(parseCommand("/map parte eroe", [map])).toEqual(
        withShape({ kind: "part" }, "herosjourney"),
      );
      expect(parseCommand("/map structure three-act", [map])).toEqual(
        withShape({ kind: "structure" }, "threeact"),
      );
      expect(
        parseCommand("/map Part One kishotenketsu", [map], {
          nodes,
          references: [],
        }),
      ).toEqual(withShape({ kind: "node", nodeId: "one" }, "kishotenketsu"));
    });

    it("takes the macron the app itself shows, never showing it back", () => {
      expect(parseCommand("/map part kishōtenketsu", [map])).toEqual(
        withShape({ kind: "part" }, "kishotenketsu"),
      );
    });

    it("keeps a title that ends in a shape's word a title", () => {
      expect(
        parseCommand("/map The Hero", [map], { nodes, references: [] }),
      ).toEqual(scoped(map, { kind: "node", nodeId: "hero" }));
      expect(
        parseCommand("/map The Hero hero", [map], { nodes, references: [] }),
      ).toEqual(withShape({ kind: "node", nodeId: "hero" }, "herosjourney"));
    });

    // The shipped skill offers `section`, so a Section map takes a shape the
    // same way, in either language.
    it("reads /map section and a shape with the shipped skill", () => {
      const shipped = skillsFor("general").filter(
        (one) => one.command === "map",
      );
      expect(parseCommand("/map sezione eroe", shipped)).toMatchObject({
        scope: { kind: "section" },
        shape: "herosjourney",
      });
      expect(parseCommand("/map section", shipped)).toMatchObject({
        scope: { kind: "section" },
      });
    });

    it("takes off one word, never two", () => {
      expect(parseCommand("/map three-act hero", [map])).toBeNull();
    });

    it("leaves a line with no reach before the shape a question", () => {
      expect(
        parseCommand("/map the ending hero", [map], { nodes, references: [] }),
      ).toBeNull();
      // A scope word the command does not offer is no reach, shape or not.
      expect(
        parseCommand("/map section hero", [map], { nodes, references: [] }),
      ).toBeNull();
      expect(parseCommand("/map hero part", [map])).toBeNull();
    });

    it("takes a shape word only after a command whose workflow maps", () => {
      const continuity = skill({
        command: "continuity",
        reviewTask: "continuity",
        scopes: ["section", "part", "structure"],
      });
      expect(parseCommand("/continuity part hero", [continuity])).toBeNull();
    });
  });
});

// A command that takes a reference reads a reach and then a name,
// matched exactly against the names the caller hands the parse: fixture
// skills here, since no shipped file declares one until `/canon`.
describe("a reference after the reach", () => {
  const read = (front: string) => () =>
    readSkill("x.md", `---\n${front}\n---\nBody.`);

  it("takes a reference only on a review that declares what it reads", () => {
    const canon = read(
      "reviewTask: consistency\nargument: reference\nscopes: section, part\nreads: characters, notes",
    )();
    expect(canon.argument).toBe("reference");
    expect(canon.scopes).toEqual(["section", "part"]);
    expect(read("argument: reference")).toThrow(
      "x.md: only a review takes a reference",
    );
    expect(read("workflow: map\nargument: reference\nscopes: part")).toThrow(
      "x.md: only a review takes a reference",
    );
    expect(read("reviewTask: consistency\nargument: reference")).toThrow(
      "x.md: a reference is named from the file's reads",
    );
    expect(read("reviewTask: consistency\nargument: vibes")).toThrow(
      "x.md: argument must be one of text, reference",
    );
    // Text is still refused on a review, and still refused beside scopes.
    expect(read("reviewTask: consistency\nargument: text")).toThrow(
      "x.md: a review takes no text",
    );
  });

  const canon = skill({
    command: "canon",
    reviewTask: "consistency",
    argument: "reference",
    scopes: ["section", "part", "structure"],
    reads: [{ group: "characters" }],
  });
  const names = {
    nodes: [
      { id: "P1", title: "The Harbour" },
      { id: "S9", title: "Marta" },
      { id: "P2", title: "The Fire" },
    ],
    references: [
      {
        name: "Aldo",
        ids: ["reference:character--Aldo.md", "reference:arc--Aldo.md"],
      },
      { name: "Marta", ids: ["reference:character--Marta.md"] },
      { name: "Key Locations", ids: ["reference:world--locations.md"] },
      { name: "Structure", ids: ["reference:character--Structure.md"] },
      { name: "Twin", ids: ["reference:character--a.md"] },
      { name: "twin", ids: ["reference:character--b.md"] },
      { name: "Nobody", ids: [] },
    ],
  };
  const parse = (text: string) => parseCommand(text, [canon], names);

  it("keeps every line that parses today: a reach first, with no reference", () => {
    const plain = parse("/canon part");
    expect(plain).toEqual({
      kind: "scoped",
      skill: canon,
      scope: { kind: "part" },
    });
    // Absent, never `[]`: absent means every document the review reads.
    expect(plain && "references" in plain).toBe(false);
    expect(parse("/canon")).toEqual({
      kind: "scoped",
      skill: canon,
      scope: { kind: "current" },
    });
    // A scope word beats a sheet of that name, and a title beats a sheet.
    expect(parse("/canon structure")).toEqual({
      kind: "scoped",
      skill: canon,
      scope: { kind: "structure" },
    });
    expect(parse("/canon marta")).toEqual({
      kind: "scoped",
      skill: canon,
      scope: { kind: "node", nodeId: "S9" },
    });
  });

  it("reads the whole tail as a name, at the bare scope, as the set it stands for", () => {
    expect(parse("/canon aldo")).toEqual({
      kind: "scoped",
      skill: canon,
      scope: { kind: "current" },
      references: ["reference:character--Aldo.md", "reference:arc--Aldo.md"],
    });
    expect(parse("/canon  key   locations ")).toEqual({
      kind: "scoped",
      skill: canon,
      scope: { kind: "current" },
      references: ["reference:world--locations.md"],
    });
  });

  it("reads a scope word the command offers, then a name", () => {
    expect(parse("/canon section Marta")).toEqual({
      kind: "scoped",
      skill: canon,
      scope: { kind: "section" },
      references: ["reference:character--Marta.md"],
    });
    expect(parse("/canon parte Aldo")).toEqual({
      kind: "scoped",
      skill: canon,
      scope: { kind: "part" },
      references: ["reference:character--Aldo.md", "reference:arc--Aldo.md"],
    });
  });

  it("reads a title, then a name, only when exactly one split makes both", () => {
    expect(parse("/canon The Harbour Aldo")).toEqual({
      kind: "scoped",
      skill: canon,
      scope: { kind: "node", nodeId: "P1" },
      references: ["reference:character--Aldo.md", "reference:arc--Aldo.md"],
    });
    // Two readings are a guess: "A B C" is the title "A" and the name "B C",
    // and the title "A B" and the name "C".
    const two = parseCommand("/canon A B C", [canon], {
      nodes: [
        { id: "a", title: "A" },
        { id: "ab", title: "A B" },
      ],
      references: [
        { name: "B C", ids: ["reference:character--bc.md"] },
        { name: "C", ids: ["reference:character--c.md"] },
      ],
    });
    expect(two).toEqual({
      kind: "unknown-reference",
      skill: canon,
      typed: "A B C",
    });
  });

  it("refuses a tail that names nothing, with what was typed where the name goes", () => {
    expect(parse("/canon Bruno")).toEqual({
      kind: "unknown-reference",
      skill: canon,
      typed: "Bruno",
    });
    expect(parse("/canon part Bruno")).toEqual({
      kind: "unknown-reference",
      skill: canon,
      typed: "Bruno",
    });
    // Two entries of one name name neither; a name standing for nothing is
    // no name.
    expect(parse("/canon twin")?.kind).toBe("unknown-reference");
    expect(parse("/canon Nobody")?.kind).toBe("unknown-reference");
    // A scope word the command does not offer is no reach, and no name.
    const narrow = skill({ ...canon, scopes: ["section"] });
    expect(parseCommand("/canon part Aldo", [narrow], names)).toEqual({
      kind: "unknown-reference",
      skill: narrow,
      typed: "part Aldo",
    });
  });

  // An offered scope word as the first word must not end the parse with
  // `unknown-reference` before the title split is tried: "Part Two",
  // "Parte seconda" and "Section 3" are the commonest titles a writer gives
  // a Part or Section.
  it("reads a title that begins with a scope word, then a name", () => {
    const books = {
      nodes: [
        { id: "P2", title: "Part Two" },
        { id: "P3", title: "Parte seconda" },
      ],
      references: names.references,
    };
    expect(parseCommand("/canon Part Two Marta", [canon], books)).toEqual({
      kind: "scoped",
      skill: canon,
      scope: { kind: "node", nodeId: "P2" },
      references: ["reference:character--Marta.md"],
    });
    expect(parseCommand("/canon parte seconda Aldo", [canon], books)).toEqual({
      kind: "scoped",
      skill: canon,
      scope: { kind: "node", nodeId: "P3" },
      references: ["reference:character--Aldo.md", "reference:arc--Aldo.md"],
    });
    // The scope word still comes first when a name reads after it.
    expect(parseCommand("/canon part Marta", [canon], books)).toEqual({
      kind: "scoped",
      skill: canon,
      scope: { kind: "part" },
      references: ["reference:character--Marta.md"],
    });
  });

  // The parse runs on every keystroke, so re-normalising every title and
  // every name at every split point costs too much on a long line over a
  // large book. Counted, not timed: a title's `title` is read a bounded
  // number of times whatever the line's length.
  it("reads each title a bounded number of times, however long the line", () => {
    let reads = 0;
    const nodes = Array.from({ length: 50 }, (_, i) => ({
      id: `n${i}`,
      get title() {
        reads += 1;
        return `Chapter ${i}`;
      },
    }));
    const line = `/canon ${Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ")}`;
    expect(
      parseCommand(line, [canon], { nodes, references: names.references })
        ?.kind,
    ).toBe("unknown-reference");
    expect(reads).toBeLessThanOrEqual(nodes.length * 3);
  });

  it("never reads a name after a command that takes none: the line stays a question", () => {
    expect(parseCommand("/continuity Aldo", [continuity], names)).toBeNull();
  });
});

describe("workflows", () => {
  it("finds the one skill that runs each workflow, by what it runs", () => {
    expect(workflowSkill("locate").command).toBe("where");
    expect(workflowSkill("map").command).toBe("map");
    expect(whereSkill).toBe(workflowSkill("locate"));
    expect(mapSkill).toBe(workflowSkill("map"));
    // None, or two, fails at build time rather than as a silent run.
    expect(() => workflowSkill("map", [])).toThrow(
      '0 files run workflow "map"',
    );
    const twice = skill({ command: "a", workflow: "map" });
    expect(() => workflowSkill("map", [twice, twice])).toThrow(
      '2 files run workflow "map"',
    );
  });

  it("says what a command runs, one answer per kind", () => {
    expect(actionOf(continuity)).toBe("review");
    expect(actionOf(mapSkill)).toBe("map");
    expect(actionOf(whereSkill)).toBe("locate");
    expect(actionOf(skill({ command: "summarise" }))).toBe("question");
  });

  it("refuses a workflow file that promises what it cannot run", () => {
    const read = (front: string) => () =>
      readSkill("x.md", `---\n${front}\n---\nBody.`);
    expect(read("workflow: dance")).toThrow('x.md: unknown workflow "dance"');
    expect(
      read("workflow: map\nreviewTask: consistency\nscopes: part"),
    ).toThrow("x.md: a command runs a review or a workflow, not both");
    expect(read("workflow: locate")).toThrow(
      'x.md: workflow "locate" takes text',
    );
    expect(read("workflow: map")).toThrow(
      'x.md: workflow "map" declares scopes',
    );
    expect(read("workflow: map\nargument: text")).toThrow(
      'x.md: workflow "map" takes no text',
    );
    expect(read("workflow: locate\nargument: text\nscopes: part")).toThrow(
      'x.md: workflow "locate" takes no scopes',
    );
    // `/map` reads no references: a workflow's reads would be a promise
    // nothing keeps.
    expect(read("workflow: map\nscopes: part\nreads: characters")).toThrow(
      "x.md: a workflow command reads no references",
    );
  });

  it("declares which word counts a command prints, strictly", () => {
    // The key is the switch: `/map` prints a Part's and a Section's counts
    // because its file says so, and a file without it prints none.
    expect(mapSkill.words).toEqual(["part", "section"]);
    expect(whereSkill.words).toBeUndefined();
    expect(skillFor("continuity")?.words).toBeUndefined();
    const read = (front: string) => () =>
      readSkill("x.md", `---\n${front}\n---\nBody.`);
    expect(read("workflow: map\nscopes: part\nwords: chapter")).toThrow(
      'x.md: unknown word count "chapter" in words',
    );
    // A command whose run prints none would carry a promise nothing keeps.
    expect(read("chats: general\nwords: part")).toThrow(
      "x.md: this command prints no word counts",
    );
    expect(read("workflow: locate\nargument: text\nwords: part")).toThrow(
      "x.md: this command prints no word counts",
    );
  });

  it("lets a review ask for its LENGTHS, never the line sweep", () => {
    expect(skillFor("structure-and-motivation")?.words).toEqual([
      "part",
      "section",
    ]);
    const read = (front: string) => () =>
      readSkill("x.md", `---\n${front}\n---\nBody.`);
    // With `scopes: part`, because a review with no wide scope may not ask.
    expect(
      read("reviewTask: developmental\nscopes: part\nwords: part")().words,
    ).toEqual(["part"]);
    // The line sweep reads each Section alone: a count would be read by
    // nothing.
    expect(read("reviewTask: line\nwords: part")).toThrow(
      "x.md: this command prints no word counts",
    );
  });

  it("refuses counts on a review that can never reach past one Section", () => {
    // The lengths block is built only for a `structure` or Part reach
    // (`lengthsBlock`), and a review offering neither scope only ever runs
    // on one Section, which the Sections engine never reads: its `words:`
    // would be read by nothing, the same silent promise as the line sweep's.
    const read = (front: string) => () =>
      readSkill("x.md", `---\n${front}\n---\nBody.`);
    expect(read("reviewTask: developmental\nwords: part")).toThrow(
      "x.md: this command prints no word counts",
    );
    expect(
      read("reviewTask: developmental\nscopes: section\nwords: part"),
    ).toThrow("x.md: this command prints no word counts");
    // A review that offers a wide scope still may.
    expect(
      read("reviewTask: developmental\nscopes: section, part\nwords: section")()
        .words,
    ).toEqual(["section"]);
  });
});

// The Review again button and the run ask one question of a pair a chat file
// supplies: a wide scope the task's command offers, on a task that maps over
// summaries.
describe("offersReviewAgain", () => {
  const part = { kind: "node", nodeId: "one" } as const;
  it("offers a mapping review of a Part or the Structure", () => {
    expect(offersReviewAgain("continuity", { kind: "structure" })).toBe(true);
    expect(offersReviewAgain("consistency", part)).toBe(true);
  });
  it("never offers a line sweep, whose Sections are read alone", () => {
    expect(offersReviewAgain("line", part)).toBe(false);
    expect(offersReviewAgain("line", { kind: "structure" })).toBe(false);
  });
  it("never offers a focused scope", () => {
    expect(offersReviewAgain("continuity", { kind: "current" })).toBe(false);
    expect(offersReviewAgain("continuity", { kind: "section" })).toBe(false);
  });
});

describe("a command asked as a question", () => {
  const asks = (argument?: "text"): AiSkill =>
    readSkill(
      "90-asks.md",
      `---\nchats: general\n${argument ? "argument: text\n" : ""}---\nAsk this.`,
    );

  it("sends the instruction alone, and remembers only the command", () => {
    expect(questionOf(asks())).toEqual({
      text: "Ask this.",
      command: { skill: "asks" },
    });
  });

  it("puts the writer's words last, quoted as data, never inside the instruction", () => {
    const asked = questionOf(asks("text"), '  say "no" twice\n ');
    expect(asked.text).toBe('Ask this.\n\nMEANING: "say \\"no\\" twice"');
    expect(asked.command).toEqual({
      skill: "asks",
      argument: 'say "no" twice',
    });
  });

  it("drops words a command does not take, and a blank line entirely", () => {
    expect(questionOf(asks(), "stray")).toEqual(questionOf(asks()));
    expect(questionOf(asks("text"), "   ")).toEqual(questionOf(asks("text")));
  });

  it("shows the command as the writer typed it", () => {
    expect(commandLine({ skill: "asks" })).toBe("/asks");
    expect(commandLine({ skill: "asks", argument: "a sigh" })).toBe(
      "/asks a sigh",
    );
  });
});

describe("/summarise part", () => {
  const names = {
    nodes: [
      { id: "one", title: "Part One", kind: "part" as const },
      { id: "first", title: "First", kind: "section" as const },
    ],
    references: [],
  };

  it("is the summarise workflow, offered where its file says", () => {
    expect(summariseSkill).toBe(workflowSkill("summarise"));
    expect(actionOf(summariseSkill)).toBe("summarise");
    expect(summariseSkill.scopes).toEqual(["section", "part"]);
    // A Part's account reads every summary in the Part: never a reader's.
    expect(summariseSkill.chats).toEqual(["editorial"]);
  });

  it("parses the reach a writer types, and a Part by its title", () => {
    const skills = skillsFor("editorial");
    expect(parseCommand("/summarise", skills, names)).toMatchObject({
      kind: "scoped",
      scope: { kind: "current" },
    });
    expect(parseCommand("/summarise part", skills, names)).toMatchObject({
      kind: "scoped",
      scope: { kind: "part" },
    });
    expect(parseCommand("/summarise parte", skills, names)).toMatchObject({
      scope: { kind: "part" },
    });
    expect(parseCommand("/summarise Part One", skills, names)).toMatchObject({
      scope: { kind: "node", nodeId: "one" },
    });
    // Offered no `structure`: the word is a sentence, never a wider run.
    expect(parseCommand("/summarise structure", skills, names)?.kind).not.toBe(
      "scoped",
    );
  });

  it("asks as today's question at the near scopes, and only there", () => {
    const at = (kind: AiSkill, scope: ReviewScope) => asksAt(kind, scope);
    // The quote or the open Section: the rubric sent as the writer's words.
    expect(at(summariseSkill, { kind: "current" })).toBe(true);
    expect(at(summariseSkill, { kind: "section" })).toBe(true);
    // A Part composes.
    expect(at(summariseSkill, { kind: "part" })).toBe(false);
    expect(at(summariseSkill, { kind: "node", nodeId: "one" })).toBe(false);
    // A question command asks at every scope; a review or another workflow
    // never does.
    const question = skill({ command: "how-to-say" });
    expect(at(question, { kind: "current" })).toBe(true);
    expect(at(question, { kind: "part" })).toBe(true);
    expect(at(continuity, { kind: "current" })).toBe(false);
    expect(at(mapSkill, { kind: "section" })).toBe(false);
    expect(at(whereSkill, { kind: "current" })).toBe(false);
  });

  it("completes a Part's title after it, never a Section's", () => {
    const [part, section] = names.nodes;
    expect(completesTitle(summariseSkill, part)).toBe(true);
    expect(completesTitle(summariseSkill, section)).toBe(false);
    // Every other scoped command completes both; one with no scopes, none.
    expect(completesTitle(continuity, section)).toBe(true);
    expect(completesTitle(mapSkill, section)).toBe(true);
    expect(completesTitle(whereSkill, part)).toBe(false);
  });
});

describe("/verify's command", () => {
  it("runs its own workflow, takes the writer's words, and is offered where the web is", () => {
    expect(actionOf(verifySkill)).toBe("verify");
    expect(verifySkill.argument).toBe("text");
    expect(verifySkill.scopes).toEqual([]);
    expect(verifySkill.chats).toEqual(["general", "drafting", "editorial"]);
    // The rubric is the file's body: what each verdict means.
    expect(verifySkill.instruction).toMatch(/plausible:/);
    expect(verifySkill.instruction).toMatch(/inconclusive:/);
  });

  it("parses a claim verbatim, and a bare line as an empty one", () => {
    const typed = parseCommand("/verify  Calvino died in Rome in 1985 ");
    expect(typed).toMatchObject({
      kind: "text",
      skill: verifySkill,
      argument: "Calvino died in Rome in 1985",
    });
    expect(parseCommand("/verify")).toMatchObject({
      kind: "text",
      argument: "",
    });
  });

  it("offers each workflow in the chats its command lists, and nowhere else", () => {
    // Written from the files' `chats:` lines; a file with none is Editorial's.
    const writers: readonly ChatKind[] = ["general", "drafting", "editorial"];
    const offeredIn: Record<Workflow, readonly ChatKind[]> = {
      locate: writers,
      map: writers,
      summarise: ["editorial"],
      verify: writers,
      journal: ["beta-reader"],
      predict: ["beta-reader"],
    };
    for (const [workflow, kinds] of Object.entries(offeredIn) as [
      Workflow,
      readonly ChatKind[],
    ][])
      for (const kind of CHAT_KINDS)
        expect(offersWorkflow(kind, workflow), `${workflow} in ${kind}`).toBe(
          kinds.includes(kind),
        );
  });

  it("reads a stored line back to the words commandLine wrote (11.3)", () => {
    for (const skill of aiSkills.filter((one) => one.argument === "text"))
      for (const argument of ["", "a claim", "  spaced  words ", "/where x"]) {
        const line = commandLine({
          skill: skill.command,
          ...(argument ? { argument } : {}),
        });
        expect(commandArgument(line, skill)).toBe(argument);
      }
  });

  it("never reads a longer command as a shorter one (11.4)", () => {
    // A plain `startsWith("/where")` would take "/whereabouts x".
    expect(commandArgument("/whereabouts x", whereSkill)).toBeNull();
    expect(commandArgument("/verifying", verifySkill)).toBeNull();
    expect(commandArgument("/where", whereSkill)).toBe("");
    expect(commandArgument("where x", whereSkill)).toBeNull();
  });

  it("lets a quote stand for the words only where it can be them (7.1)", () => {
    const expected = new Map<string, boolean>(
      aiSkills.map((skill) => [
        skill.command,
        actionOf(skill) === "question" || actionOf(skill) === "verify",
      ]),
    );
    for (const skill of aiSkills)
      expect(quoteIsArgument(skill)).toBe(expected.get(skill.command));
    expect(quoteIsArgument(verifySkill)).toBe(true);
    expect(quoteIsArgument(whereSkill)).toBe(false);
    expect(quoteIsArgument(mapSkill)).toBe(false);
    expect(quoteIsArgument(summariseSkill)).toBe(false);
  });
});

describe("the command a lone slash-word reached for (the fourth chat review)", () => {
  it("prefers this chat's own, then names the chat that offers it", () => {
    // `/structure` in General: the command lives in Editorial.
    expect(nearestCommand("/structure", "general")).toMatchObject({
      skill: { command: "structure-and-motivation" },
      kind: "editorial",
    });
    // `/line` in Editorial is this chat's own `/line-editing`.
    expect(nearestCommand("/line", "editorial")).toMatchObject({
      skill: { command: "line-editing" },
      kind: "editorial",
    });
    // Containing, after starting: `/motivation` still finds it.
    expect(nearestCommand("/motivation", "general")?.skill.command).toBe(
      "structure-and-motivation",
    );
    expect(nearestCommand("/zzz", "general")).toBeNull();
    expect(nearestCommand("/", "general")).toBeNull();
  });
});

describe("the skills a persona may pick up itself", () => {
  it("are each kind's commands that run no workflow", () => {
    for (const kind of CHAT_KINDS) {
      const offered = autonomousSkills(kind);
      expect(offered.every((skill) => skill.workflow === undefined)).toBe(true);
      expect(offered.every((skill) => skill.chats.includes(kind))).toBe(true);
    }
    const editorial = autonomousSkills("editorial").map((one) => one.command);
    expect(editorial).toContain("continuity");
    expect(editorial).toContain("letter");
    expect(editorial).not.toContain("map");
    expect(editorial).not.toContain("summarise");
    expect(
      autonomousSkills("beta-reader").map((one) => one.command),
    ).not.toContain("read-on");
  });

  it("name only real obsession domains, and a workflow names none", () => {
    const domains = new Set(OBSESSIONS.domains.map((one) => one.letter));
    for (const skill of aiSkills)
      for (const lens of skill.lenses) expect(domains.has(lens)).toBe(true);
    expect(() =>
      readSkill(
        "skills/1-lensed-map.md",
        "---\nworkflow: map\nscopes: part\nlenses: B\n---\nMap it.",
      ),
    ).toThrow("a workflow serves no lens");
    expect(() =>
      readSkill("skills/1-bad-lens.md", "---\nlenses: Z\n---\nAsk it."),
    ).toThrow("not an obsession domain letter");
  });
});
