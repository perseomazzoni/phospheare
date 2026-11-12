// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { stripUnansweredQuestions } from "./referenceAnswers";
import { stripAsides } from "./asides";

// Every reference document starts as a template: a run of questions, each a
// bold label, a hint, and an empty bullet. What the writer has not filled in
// must not reach a model, because a question over nothing reads as a missing
// answer rather than one never started.

/** A question block as the templates ship it, answered or not. */
function question(label: string, answer = ""): string {
  return [
    `- **${label}:**`,
    `  <!-- Hint: think about ${label}. -->`,
    `  - ${answer}`,
  ].join("\n");
}

/** What the port does: notes first, then the unanswered questions. */
function forModel(text: string): string {
  return stripUnansweredQuestions(stripAsides(text));
}

describe("the unanswered half of a reference document", () => {
  it("keeps what the writer answered and removes the rest, whole", () => {
    const out = forModel(
      [
        "# Vera",
        "",
        "## Identità",
        "",
        question("Pronomi", "lei/lei"),
        "",
        question("Età"),
        "",
        question("Aspetto"),
        "",
      ].join("\n"),
    );
    expect(out).toContain("- **Pronomi:**");
    expect(out).toContain("lei/lei");
    // The label goes with its empty bullet, not only the bullet: a question
    // left over nothing is the noise, and half of it is the same noise.
    expect(out).not.toContain("Età");
    expect(out).not.toContain("Aspetto");
    // The heading survives, because something under it did.
    expect(out).toContain("## Identità");
    // And no blank is left where the hint stood between the two.
    expect(out).toContain("- **Pronomi:**\n  - lei/lei");
  });

  it("takes a section's heading when nothing under it was answered", () => {
    const out = forModel(
      [
        "# Vera",
        "",
        "## Identità",
        "",
        question("Pronomi", "lei/lei"),
        "",
        "## Storia personale",
        "",
        question("Esperienze formative"),
        "",
        "Vita interiore",
        "--------------",
        "",
        question("Paure"),
        "",
      ].join("\n"),
    );
    expect(out).toContain("## Identità");
    // A heading over nothing reads as a section the writer chose to leave
    // blank.
    expect(out).not.toContain("Storia personale");
    // Including a setext heading, which is two source lines: removing only the
    // first would leave its underline behind as a horizontal rule.
    expect(out).not.toContain("Vita interiore");
    expect(out).not.toContain("----");
  });

  it("keeps a heading whose only content is a subsection that survived", () => {
    // A container whose children have content has content. The emptying runs
    // to a fixed point, so the reverse also holds: a `##` left hollow by the
    // removal of the `###` inside it goes on the next pass.
    const kept = forModel(
      [
        "# Vera",
        "",
        "## Outer",
        "",
        "### Inner",
        "",
        question("Paure", "il buio"),
      ].join("\n"),
    );
    expect(kept).toContain("## Outer");
    expect(kept).toContain("### Inner");

    const gone = forModel(
      [
        "# Vera",
        "",
        "## Outer",
        "",
        "### Inner",
        "",
        question("Paure"),
        "",
        "## Next",
        "",
        question("X", "y"),
      ].join("\n"),
    );
    expect(gone).not.toContain("Outer");
    expect(gone).not.toContain("Inner");
    expect(gone).toContain("## Next");
  });

  it("never removes the title, even from a document with nothing in it", () => {
    // The reference still exists, and the assistant can say which one it
    // looked at. An untouched template collapses to this.
    const out = forModel(
      ["# Vera", "", "## Identità", "", question("Pronomi"), ""].join("\n"),
    );
    expect(out).toBe("# Vera");
  });

  it("treats anything that is not a bare question as content", () => {
    // Only a bold label alone on its line is a question, so only that shape is
    // removed. A bullet with text after its bold run is a line someone wrote,
    // including the logline formula once filled in, so the pass keeps
    // filled-in answers. The formula as shipped, slots unfilled, belongs to
    // the template, as the next row pins.
    const out = forModel(
      [
        "# Notes",
        "",
        "- a plain bullet",
        "",
        "- **Name:** Vera",
        "",
        "- **Mara**, a lighthouse keeper, wants the light back.",
        "",
        "> A principle worth keeping.",
        "",
        "Loose prose under no bullet at all.",
        "",
        question("Paure"),
      ].join("\n"),
    );
    expect(out).toContain("- a plain bullet");
    expect(out).toContain("- **Name:** Vera");
    expect(out).toContain("- **Mara**, a lighthouse keeper");
    expect(out).toContain("> A principle worth keeping.");
    expect(out).toContain("Loose prose under no bullet at all.");
    expect(out).not.toContain("Paure");
  });

  it("drops a fill-in formula nobody filled in, and keeps the writer's line under it", () => {
    const formula =
      "  - **[PROTAGONIST]**, a [BRIEF DESCRIPTION], wants [DESIRE], but when [INCITING EVENT] happens…";
    // Untouched: the question holds only the formula, so it goes whole.
    expect(
      forModel(
        ["# Logline", "", "- **The story in a sentence:**", formula].join("\n"),
      ),
    ).toBe("# Logline");
    // The writer wrote their own under it: theirs stays, the template's goes.
    const own = forModel(
      [
        "# Logline",
        "",
        "- **The story in a sentence:**",
        formula,
        "  - Mara must relight the lamp before the fleet returns.",
      ].join("\n"),
    );
    expect(own).toContain("Mara must relight the lamp");
    expect(own).not.toContain("[PROTAGONIST]");
    // In Italian too; and a single title-case placeholder, or a writer's own
    // `[sic]`, is never a formula.
    expect(
      forModel(
        "- **Frase:**\n  - **[PROTAGONISTA]**, [BREVE DESCRIZIONE], vuole [DESIDERIO].",
      ),
    ).toBe("");
    const kept = forModel(
      "## [Location]\n\n- **Description:**\n  - The quay [sic] floods.",
    );
    expect(kept).toContain("## [Location]");
    expect(kept).toContain("The quay [sic] floods.");
  });

  it("counts an answer written in any shape the writer chose", () => {
    // The template offers one empty bullet; a writer may answer in it, replace
    // it with a list of their own, write prose, a table or a quotation. All of
    // them are answers, and reading only the first shape would delete the rest.
    const shapes = [
      "  - il buio",
      "  - il buio\n  - la solitudine",
      "  Ha paura del buio.",
      "  > Ha paura del buio.",
      "  | a | b |\n  |---|---|\n  | 1 | 2 |",
      "  - first\n    - deeper still",
    ];
    for (const answer of shapes)
      expect(forModel(`# Vera\n\n- **Paure:**\n${answer}\n`)).toContain(
        "Paure",
      );
  });

  it("is not fooled by a hint that is the only thing in the block", () => {
    // Correct in either order, because a block is judged on text with its
    // notes removed — a hint is not an answer, and a question must not survive
    // on the weight of the guidance attached to it.
    const block = [
      "- **Paure:**",
      "  <!-- Hint: a long, detailed hint. -->",
      "  - ",
    ].join("\n");
    expect(stripUnansweredQuestions(`# Vera\n\n${block}`)).toBe("# Vera");
    expect(forModel(`# Vera\n\n${block}`)).toBe("# Vera");
  });

  // The writer owns these files: a writer can open a reference document in any
  // editor and leave it in any shape markdown allows. The pass parses rather
  // than pattern-matches so the shapes below keep working; a line-by-line pass
  // breaks on each of them.

  it("reads every list and emphasis syntax the writer might use", () => {
    const shapes: [string, string][] = [
      // `*` and `+` do not underline, so an empty one is lazy continuation of
      // the label's paragraph rather than a nested list, which is why the
      // emptiness test asks for a letter or a digit, not for "not blank".
      ["* **A:**\n  * \n\n* **B:**\n  * yes", "*"],
      ["+ **A:**\n  + \n\n+ **B:**\n  + yes", "+"],
      ["1. **A:**\n   - \n\n2. **B:**\n   - yes", "ordered"],
      ["- **A:**\n\t- \n\n- **B:**\n\t- yes", "tab indent"],
      ["- **A:**\n    - \n\n- **B:**\n    - yes", "four-space indent"],
      ["- __A:__\n  - \n\n- __B:__\n  - yes", "underscore emphasis"],
      ["- **A**:\n  - \n\n- **B**:\n  - yes", "colon outside the bold"],
      ["- **A**\n  - \n\n- **B**\n  - yes", "no colon at all"],
    ];
    for (const [body, name] of shapes) {
      const out = forModel(`# T\n\n${body}\n`);
      expect(out, name).not.toContain("**A");
      expect(out, name).not.toContain("__A");
      expect(out, name).toContain("yes");
    }
  });

  it("does not go looking for questions inside a code fence", () => {
    // A fenced block is not a list however much it looks like one. A textual
    // scan cannot avoid this, as `asides.ts` accepts; the parse here does.
    const out = forModel(
      ["# T", "", "```md", "- **A:**", "  - ", "```", "", question("B")].join(
        "\n",
      ),
    );
    expect(out).toContain("```md");
    expect(out).toContain("- **A:**");
    expect(out).not.toContain("**B:**");
  });

  it("keeps a question whose answer lost its indent", () => {
    // Typed flush left, the answer becomes the label's sibling rather than
    // its child, so the label reads as empty, and removing it would leave the
    // answer under no question. A next sibling that is content rather than
    // another question is the signal.
    const out = forModel(
      [
        "# T",
        "",
        "- **Paure:**",
        "- ha paura del buio",
        "",
        question("Altro"),
      ].join("\n"),
    );
    expect(out).toContain("- **Paure:**");
    expect(out).toContain("ha paura del buio");
    expect(out).not.toContain("Altro");
  });

  it("reads CRLF line endings without losing its place", () => {
    // markdown-it normalizes newlines before it counts lines, so the same
    // normalization happens here, or every source range would be off by the
    // number of CRLFs above it and the wrong lines would be removed.
    const out = forModel(
      "# T\r\n\r\n- **A:**\r\n  <!-- h -->\r\n  - \r\n\r\n- **B:**\r\n  - yes\r\n",
    );
    expect(out).toBe("# T\n\n- **B:**\n  - yes");
  });

  it("leaves a document it cannot recognise exactly as it is", () => {
    // Nothing here is a template, and an unrecognised document is handed over
    // whole. Leaving scaffolding in costs tokens; deleting a writer's answers
    // because their file surprised the parser loses work.
    for (const odd of [
      "",
      "just some prose the writer typed",
      "# T",
      "---\ntitle: front matter\n---\n\nProse.",
    ])
      expect(forModel(odd)).toBe(stripAsides(odd).trim());
  });
});
