// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  HENOSIS_OFF,
  PAUSE_FLOOR_MS,
  deadlineOf,
  step,
  type HenosisEvent,
  type HenosisFlow,
} from "./flow";

// One rule a case: Y of steady writing starts the dim, it reaches
// full over X, a pause longer than P ends it, and a hand or a stand-down ends
// it at once.

const T = { afterMs: 5000, fadeMs: 10000, pauseMs: 5000 };

/**
 * Run events at the given times from off, answering deadlines as the hook
 * does.
 */
function run(events: [number, HenosisEvent][]): HenosisFlow {
  return events.reduce(
    (flow, [at, event]) => step(flow, event, at, T),
    HENOSIS_OFF,
  );
}

/** Keystrokes every `gap` ms from `from` to `to`, inclusive. */
function typing(from: number, to: number, gap = 200): [number, "type"][] {
  const out: [number, "type"][] = [];
  for (let at = from; at <= to; at += gap) out.push([at, "type"]);
  return out;
}

describe("the Henosis flow", () => {
  it("starts warming on the first keystroke", () => {
    expect(run([[0, "type"]]).state).toBe("warming");
  });

  it("fades once the writer has written steadily for Y", () => {
    const warm = run(typing(0, 4800));
    expect(warm.state).toBe("warming");
    expect(deadlineOf(warm, T)).toBe(5000);
    const fading = step(warm, "deadline", 5000, T);
    expect(fading.state).toBe("fading");
    expect(fading.fadeStart).toBe(5000);
  });

  it("restarts the burst after a gap longer than Y, even with no deadline seen", () => {
    const flow = run([...typing(0, 3000), [8100, "type"]]);
    expect(flow.state).toBe("warming");
    expect(flow.burstStart).toBe(8100);
  });

  it("reaches full X after the fade began, while the writer keeps writing", () => {
    let flow = step(run(typing(0, 4800)), "deadline", 5000, T);
    for (const [at] of typing(5200, 14800)) flow = step(flow, "type", at, T);
    expect(deadlineOf(flow, T)).toBe(15000);
    flow = step(flow, "deadline", 15000, T);
    expect(flow.state).toBe("full");
  });

  it("returns to off after a pause longer than Y, from every state", () => {
    const warming = run([...typing(0, 1000)]);
    expect(step(warming, "deadline", 6000, T).state).toBe("off");

    const fading = step(run(typing(0, 4800)), "deadline", 5000, T);
    expect(deadlineOf(fading, T)).toBe(4800 + 5000);
    expect(step(fading, "deadline", 9800, T).state).toBe("off");

    let full = step(run(typing(0, 4800)), "deadline", 5000, T);
    for (const [at] of typing(5200, 14800)) full = step(full, "type", at, T);
    full = step(full, "deadline", 15000, T);
    expect(deadlineOf(full, T)).toBe(19800);
    expect(step(full, "deadline", 19800, T).state).toBe("off");
  });

  it("ends a lone keystroke followed by silence rather than fading", () => {
    const one = run([[0, "type"]]);
    expect(deadlineOf(one, T)).toBe(5000);
    expect(step(one, "deadline", 5000, T).state).toBe("off");
  });

  it("goes off at once on a wake or a stand-down, from every state", () => {
    const fading = step(run(typing(0, 4800)), "deadline", 5000, T);
    for (const event of ["wake", "standDown"] as const) {
      expect(step(run([[0, "type"]]), event, 10, T)).toEqual(HENOSIS_OFF);
      expect(step(fading, event, 5100, T)).toEqual(HENOSIS_OFF);
    }
  });

  it("ignores a timer that fires before anything is due", () => {
    const warm = run(typing(0, 2000));
    expect(step(warm, "deadline", 2500, T)).toBe(warm);
    expect(step(HENOSIS_OFF, "deadline", 2500, T)).toBe(HENOSIS_OFF);
    expect(deadlineOf(HENOSIS_OFF, T)).toBeNull();
  });

  it("takes Y and X from the timing it is given", () => {
    const quick = { afterMs: 3000, fadeMs: 5000, pauseMs: 3000 };
    let flow = HENOSIS_OFF;
    for (const [at] of typing(0, 2800)) flow = step(flow, "type", at, quick);
    flow = step(flow, "deadline", 3000, quick);
    expect(flow.state).toBe("fading");
    for (const [at] of typing(3200, 7800)) flow = step(flow, "type", at, quick);
    expect(deadlineOf(flow, quick)).toBe(8000);
    expect(step(flow, "deadline", 8000, quick).state).toBe("full");
  });
});

describe("the pause, apart from Y", () => {
  it("ends the mode after P, whatever Y is", () => {
    const long = { afterMs: 10000, fadeMs: 5000, pauseMs: 2000 };
    let flow = step(HENOSIS_OFF, "type", 0, long);
    for (let at = 500; at <= 9500; at += 500)
      flow = step(flow, "type", at, long);
    expect(flow.state).toBe("warming");
    // Y comes round at 10 s, mid-sentence, and the fade begins…
    expect(deadlineOf(flow, long)).toBe(10000);
    flow = step(flow, "deadline", 10000, long);
    expect(flow.state).toBe("fading");
    // …and a pause just over P ends it, though far shorter than Y.
    expect(deadlineOf(flow, long)).toBe(11500);
    expect(step(flow, "deadline", 11500, long).state).toBe("off");
  });

  it("keeps a long P through gaps longer than Y", () => {
    const patient = { afterMs: 2000, fadeMs: 0, pauseMs: 8000 };
    let flow = step(HENOSIS_OFF, "type", 0, patient);
    flow = step(flow, "type", 4000, patient);
    expect(flow.burstStart).toBe(0);
    expect(deadlineOf(flow, patient)).toBe(2000);
  });
});

describe("Y, X and P at zero", () => {
  const ZERO = { afterMs: 0, fadeMs: 0, pauseMs: 0 };

  it("fades from the first keystroke and is gone at once", () => {
    let flow = step(HENOSIS_OFF, "type", 0, ZERO);
    expect(deadlineOf(flow, ZERO)).toBe(0);
    flow = step(flow, "deadline", 0, ZERO);
    expect(flow.state).toBe("fading");
    expect(deadlineOf(flow, ZERO)).toBe(0);
    expect(step(flow, "deadline", 0, ZERO).state).toBe("full");
  });

  it("keeps a second as the pause, so the mode survives the gap between keys", () => {
    let flow = step(HENOSIS_OFF, "type", 0, ZERO);
    flow = step(step(flow, "deadline", 0, ZERO), "deadline", 0, ZERO);
    for (const at of [300, 900, 1700, 2500])
      flow = step(flow, "type", at, ZERO);
    expect(flow.state).toBe("full");
    expect(deadlineOf(flow, ZERO)).toBe(2500 + PAUSE_FLOOR_MS);
    expect(step(flow, "deadline", 3500, ZERO).state).toBe("off");
  });
});
