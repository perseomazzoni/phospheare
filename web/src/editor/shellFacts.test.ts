// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { EditorEngine } from "./views/engine";
import { shellFacts } from "./shellFacts";

// The shell redraws only when this answer changes. Pinned both ways:
// typing inside a word and moving the caret leave it alone, and every fact the
// shell does draw moves it.

function engineWith(text: string): EditorEngine {
  const engine = new EditorEngine();
  engine.open(text);
  const end = { para: 0, offset: text.length };
  engine.updateSelection({ anchor: end, focus: end });
  return engine;
}

describe("shellFacts", () => {
  it("stays the same while the writer types on and moves the caret", () => {
    const engine = engineWith("One line.");
    engine.type("x");
    const typing = shellFacts(engine);
    engine.type("yz");
    expect(shellFacts(engine)).toBe(typing);
    const there = { para: 0, offset: 2 };
    engine.updateSelection({ anchor: there, focus: there });
    expect(shellFacts(engine)).toBe(typing);
  });

  it("changes on the first edit, which makes the buffer dirty", () => {
    const engine = engineWith("One line.");
    const clean = shellFacts(engine);
    engine.type("x");
    expect(shellFacts(engine)).not.toBe(clean);
  });

  it("changes when a selection opens or closes", () => {
    const engine = engineWith("One line.");
    const caret = shellFacts(engine);
    engine.updateSelection({
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 3 },
    });
    const range = shellFacts(engine);
    expect(range).not.toBe(caret);
    engine.updateSelection({
      anchor: { para: 0, offset: 3 },
      focus: { para: 0, offset: 3 },
    });
    expect(shellFacts(engine)).toBe(caret);
  });

  it("changes when a comparison opens", () => {
    const engine = engineWith("One line.");
    const plain = shellFacts(engine);
    engine.enterDiff("Another line.");
    expect(shellFacts(engine)).not.toBe(plain);
  });
});
