// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { OBSESSIONS, obsessionById } from "./obsessions";
import {
  PERSONAS,
  checkVoices,
  presetFor,
  presetsFor,
  personasFor,
} from "./personas";
import type { ChatKind, PersonaDefinition } from "./types";
import { composeVoice } from "./voice";

const voice = (
  over: Partial<PersonaDefinition> & { id: string },
): PersonaDefinition => ({
  name: `Voice ${over.id}`,
  description: "d",
  compatibleWith: ["general", "editorial"],
  instructions: "Plain and kind.",
  presets: [
    {
      id: `p${over.id}`,
      chats: ["general", "editorial"],
      obsessions: ["B.causality"],
      reads: [],
    },
  ],
  ignores: [],
  avatar: "/a.png",
  color: "#336699",
  ...over,
});

describe("a persona's presets", () => {
  const nova = voice({
    id: "1",
    presets: [
      { id: "line", chats: ["editorial"], obsessions: ["F.echo"], reads: [] },
      {
        id: "dialogue",
        chats: ["general", "editorial"],
        obsessions: ["G.tags"],
        reads: [],
      },
    ],
  });

  it("opens each room on its first preset, and keeps a stored one it offers", () => {
    expect(presetFor(nova, "editorial").id).toBe("line");
    expect(presetFor(nova, "general").id).toBe("dialogue");
    expect(presetFor(nova, "editorial", "dialogue").id).toBe("dialogue");
    // One the persona does not offer in this room falls back, never refuses.
    expect(presetFor(nova, "general", "line").id).toBe("dialogue");
    expect(presetFor(nova, "general", "gone").id).toBe("dialogue");
    expect(presetsFor(nova, "editorial").map((one) => one.id)).toEqual([
      "line",
      "dialogue",
    ]);
  });

  it("gives every shipped persona a preset in every room it works in", () => {
    for (const persona of PERSONAS)
      for (const kind of persona.compatibleWith)
        expect(presetsFor(persona, kind).length).toBeGreaterThan(0);
  });

  it("keeps Lumi to the reader rooms, and the editors out of them", () => {
    for (const kind of ["alpha-reader", "beta-reader"] as ChatKind[])
      expect(
        personasFor(kind).every((one) => one.compatibleWith.length === 2),
      ).toBe(true);
    expect(
      personasFor("general").some((one) =>
        one.compatibleWith.includes("beta-reader"),
      ),
    ).toBe(false);
  });

  it("refuses a folder that names what does not exist", () => {
    const check = (personas: PersonaDefinition[]) => () =>
      checkVoices(personas, OBSESSIONS);
    expect(check([voice({ id: "1" }), voice({ id: "2" })])).not.toThrow();
    expect(
      check([
        voice({ id: "1" }),
        voice({ id: "1", presets: voice({ id: "1" }).presets }),
      ]),
    ).toThrow(/declared twice/);
    expect(
      check([
        voice({
          id: "1",
          presets: [
            { id: "x", chats: ["general"], obsessions: ["Z.none"], reads: [] },
          ],
        }),
      ]),
    ).toThrow(/no obsession Z.none/);
    expect(
      check([voice({ id: "1", ignores: [{ domain: "Q", personaId: "2" }] })]),
    ).toThrow(/no domain Q/);
    expect(
      check([voice({ id: "1", ignores: [{ domain: "B", personaId: "1" }] })]),
    ).toThrow(/no colleague 1/);
    expect(
      check([voice({ id: "1", ignores: [{ domain: "B", personaId: "9" }] })]),
    ).toThrow(/no colleague 9/);
    // A referral whose colleague sends the same domain on is a loop, not a
    // referral.
    expect(
      check([
        voice({ id: "1", ignores: [{ domain: "B", personaId: "2" }] }),
        voice({ id: "2", ignores: [{ domain: "B", personaId: "1" }] }),
      ]),
    ).toThrow(/refers B to Voice 2, who refers it on/);
  });

  it("sends every shipped referral to a colleague who keeps the domain", () => {
    expect(() => checkVoices(PERSONAS, OBSESSIONS)).not.toThrow();
    const phos = PERSONAS.find((one) => one.name === "Phos");
    const owner = (domain: string) =>
      PERSONAS.find(
        (one) =>
          one.id === phos?.ignores.find((r) => r.domain === domain)?.personaId,
      )?.name;
    expect(["B", "C"].map(owner)).toEqual(["Spark", "Spark"]);
    expect(["E", "F", "G"].map(owner)).toEqual(["Nova", "Nova", "Nova"]);
  });
});

describe("composing a voice for a room", () => {
  const editor = voice({
    id: "1",
    presets: [
      {
        id: "craft",
        chats: ["general", "editorial", "drafting"],
        obsessions: ["E.filter", "B.scene-turn"],
        reads: [],
      },
    ],
    compatibleWith: ["general", "editorial", "drafting"],
    ignores: [
      { domain: "A", personaId: "2" },
      { domain: "D", personaId: "2" },
    ],
  });
  const colleague = voice({ id: "2", name: "Rhea" });
  const all = [editor, colleague];

  it("carries the voice, the obsessions as notices, the referrals and the lenses", () => {
    const composed = composeVoice(editor, "editorial", undefined, all);
    expect(composed.preset.id).toBe("craft");
    expect(composed.obsessions.map((one) => one.id)).toEqual([
      "E.filter",
      "B.scene-turn",
    ]);
    const text = composed.instructions;
    // The block opens on the frame that says what a voice is, the sound and
    // never the job or the form, and the voice follows it directly.
    expect(text.startsWith("Your persona. It decides how you sound")).toBe(
      true,
    );
    expect(text).toContain("the room's rules above decide the job");
    expect(text.indexOf("Plain and kind.")).toBeGreaterThan(0);
    expect(text).toContain(
      `- ${obsessionById(OBSESSIONS, "E.filter").notices}`,
    );
    expect(text).toContain(
      "Not your department: market and positioning, theme and meaning (Rhea).",
    );
    // Both lenses the obsessions name, in their order.
    expect(text.indexOf("### Point of view and distance")).toBeLessThan(
      text.indexOf("### The scene"),
    );
  });

  it("asks in the asking rooms, and reads in the reader rooms", () => {
    const drafting = composeVoice(
      editor,
      "drafting",
      undefined,
      all,
    ).instructions;
    expect(drafting).toContain(
      `- ${obsessionById(OBSESSIONS, "E.filter").asks}`,
    );
    expect(drafting).toContain("The questions you keep asking");

    const [lumi] = personasFor("beta-reader");
    const beta = composeVoice(lumi, "beta-reader", "skeptic", PERSONAS);
    expect(beta.preset.id).toBe("skeptic");
    expect(beta.instructions).toContain("As you read");
    expect(beta.instructions).toContain("never use their vocabulary");
    expect(beta.instructions).not.toContain("Not your department");
    // Answering through the focus first is a reporting room's rule: a
    // reader notices, and a drafting partner asks.
    expect(beta.instructions).not.toContain("lead with what these show");
    expect(drafting).not.toContain("lead with what these show");
    const general = composeVoice(
      editor,
      "general",
      undefined,
      all,
    ).instructions;
    expect(general).toContain("lead with what these show in this book");
    // One authority order, stated: the obsessions narrow what comes first,
    // never what is answered, and a referral rides beside the answer.
    expect(general).toContain("a referral is an addition, never a refusal");
    expect(general).toContain(
      "the order is: the room's rules, then the request, then your obsessions, then your voice",
    );
    const alpha = composeVoice(lumi, "alpha-reader", undefined, PERSONAS);
    expect(alpha.preset.id).toBe("friend");
    expect(alpha.instructions).toContain(
      obsessionById(OBSESSIONS, "M.intent").asks,
    );
  });

  it("names nobody for a referral whose colleague is gone", () => {
    const lonely = voice({
      id: "1",
      ignores: [{ domain: "A", personaId: "9" }],
    });
    expect(
      composeVoice(lonely, "general", undefined, [lonely]).instructions,
    ).not.toContain("Not your department");
  });
});

describe("the skills a voice's obsessions lead to", () => {
  it("names the room's methods closest to the preset, most served first", () => {
    const prose = voice({
      id: "9",
      presets: [
        {
          id: "line",
          chats: ["editorial"],
          obsessions: ["F.rhythm", "F.echo", "I.timeline"],
          reads: [],
        },
      ],
    });
    const said = composeVoice(prose, "editorial", "line", [prose]).instructions;
    const line = said
      .split("\n\n")
      .find((one) => one.startsWith("Your skills in this chat"));
    // Prose (F) serves two of the three obsessions, continuity (I) one.
    expect(line).toBeDefined();
    const named: string[] = line?.match(/\/[a-z-]+/g) ?? [];
    expect(named).toContain("/line-editing");
    expect(named).toContain("/continuity");
    expect(named.indexOf("/line-editing")).toBeLessThan(
      named.indexOf("/continuity"),
    );
    // A workflow is never a method a voice picks up.
    expect(named).not.toContain("/map");
  });

  it("says where a method closest to the preset runs when this room has none", () => {
    // Nova on the continuity preset in a drafting chat, offered only
    // `/how-to-say`, would reach for it.
    const continuity = voice({
      id: "7",
      presets: [
        {
          id: "continuity",
          chats: ["drafting", "alpha-reader"],
          obsessions: ["I.names", "I.timeline"],
          reads: [],
        },
      ],
    });
    const drafting = composeVoice(continuity, "drafting", "continuity", [
      continuity,
    ]).instructions;
    expect(drafting).toContain(
      "Closest to your obsessions but run in another kind of chat: /continuity (editorial)",
    );
    expect(drafting).toContain("never through a skill made for another task");
    // A reader is never pointed at the studio.
    expect(
      composeVoice(continuity, "alpha-reader", "continuity", [continuity])
        .instructions,
    ).not.toContain("another kind of chat");
  });

  it("stays silent where no skill of the room serves the preset", () => {
    // General offers `/how-to-say` alone, and a causality voice is not led
    // to it.
    const plain = voice({ id: "8" });
    expect(
      composeVoice(plain, "general", undefined, [plain]).instructions,
    ).not.toContain("Your skills in this chat");
  });
});
