// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { citationSegments } from "./citations";
import type { ChatTurn } from "./types";
import { webCitations } from "./webCitations";

// Pins that the identity skip reads no text. The dock runs the walk
// on every streamed token, and a linear walk scans every answer's text each
// time. The skip's point is that an unchanged chain is not read at all, and
// only a count of scans can show it: an entry kept by value and one kept by
// identity look the same from outside.
//
// A separate file because the count needs `citationSegments` wrapped, and a
// module mock is file-wide: every other walk row reads the real function.

vi.mock("./citations", async (importOriginal) => {
  const real = await importOriginal<typeof import("./citations")>();
  return { ...real, citationSegments: vi.fn(real.citationSegments) };
});

const scans = vi.mocked(citationSegments);

const AT = "2026-09-27T00:00:00.000Z";

function ask(id: string): ChatTurn {
  return {
    id,
    role: "user",
    text: "A question",
    createdAt: AT,
    outcome: "complete",
  };
}

/** An answer citing its own result and the one the answer before it cited. */
function answer(n: number): ChatTurn {
  const own = 2 * n - 1;
  return {
    id: `a${n}`,
    role: "assistant",
    text:
      n === 1 ? `First web:${own}.` : `Own web:${own}, earlier web:${own - 2}.`,
    createdAt: AT,
    outcome: "complete",
    web: [
      {
        callId: `c${n}`,
        engine: { kind: "wikipedia" },
        status: "searched",
        query: "a query",
        results: [own, own + 1].map((k) => ({
          id: `web:${k}`,
          url: `https://en.wikipedia.org/wiki/Page_${k}`,
          title: `Page ${k}`,
        })),
      },
    ],
  };
}

function chat(pairs: number): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (let n = 1; n <= pairs; n += 1) turns.push(ask(`q${n}`), answer(n));
  return turns;
}

describe("an unchanged chain runs no scan", () => {
  beforeEach(() => {
    scans.mockClear();
  });

  it("scans every answer once on a cold walk, and none on an unchanged one", () => {
    const turns = chat(50);
    const first = webCitations(turns);
    expect(scans).toHaveBeenCalledTimes(50);
    scans.mockClear();
    const again = webCitations(turns, undefined, first);
    expect(scans).not.toHaveBeenCalled();
    expect(again.get("a50")).toBe(first.get("a50"));
  });

  // The dock's own case: a token lands on the live answer, which is a new
  // object each time; every settled answer before it is the object it was.
  // A skip that never fires scans every answer again and fails this row.
  it("scans the live answer at most, once a token lands on it", () => {
    const turns = chat(50);
    const live = "a50";
    const first = webCitations(turns, live);
    const last = turns[turns.length - 1];
    if (!last) throw new Error("expected a live answer");
    const streamed = [
      ...turns.slice(0, -1),
      { ...last, text: `${last.text} And` },
    ];
    scans.mockClear();
    const next = webCitations(streamed, live, first);
    expect(scans.mock.calls.length).toBeLessThanOrEqual(1);
    expect(scans.mock.calls.map(([text]) => text)).toEqual([
      `${last.text} And`,
    ]);
    expect(next.get("a49")).toBe(first.get("a49"));
  });
});
