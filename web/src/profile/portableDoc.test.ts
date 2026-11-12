// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  applyAdd,
  applyPref,
  applyRemove,
  asPortableDoc,
  emptyDoc,
  holdsLater,
  libraryOf,
  mergeDocs,
  PORTABLE_PREFS,
  sameContent,
  validPref,
  type PortableDoc,
  type PortableRow,
} from "./portableDoc";
import type { CardContent } from "./profileStore";
import { FOCUS_MODES } from "../project/properties";
import {
  AUTOSAVE_DELAY_PRESETS,
  HENOSIS_AFTER_PRESETS,
  HENOSIS_FADE_PRESETS,
  HENOSIS_PAUSE_PRESETS,
  PROSE_SIZES,
} from "../project/types";
import { APP_LANGUAGES } from "../locales/languages";
import "../theme";

// Pins the merge rules of the portable profile: every device
// computes the same answer from the same copies, a concurrent change on two
// devices never erases an unrelated one, and a copy read from Drive or a file
// passes the same checks a local write does.

const A = "0a1b2c3d-0000-4000-8000-00000000000a";
const B = "0a1b2c3d-0000-4000-8000-00000000000b";
const T0 = "2026-10-01T10:00:00.000Z";
const T1 = "2026-10-01T10:00:01.000Z";
const T2 = "2026-10-01T10:00:02.000Z";

function card(id: string, title: string, cachedAt: string): CardContent {
  return {
    id,
    title,
    type: "novel",
    words: 100,
    parts: 1,
    sections: 2,
    goal: null,
    perNode: [],
    structure: { version: 1, children: [] },
    updatedAt: T0,
    cachedAt,
  };
}

function row(id: string, over: Partial<PortableRow> = {}): PortableRow {
  return {
    id,
    provider: "local",
    key: "folder",
    name: "Book",
    openedAt: T0,
    at: T0,
    removedAt: null,
    card: null,
    ...over,
  };
}

function doc(
  installation: string,
  over: Partial<PortableDoc> = {},
): PortableDoc {
  return { ...emptyDoc(installation), ...over };
}

describe("the preference domain", () => {
  it("accepts each portable key's own values only", () => {
    expect(validPref("theme", "vision-dark")).toBe(true);
    expect(validPref("theme", "dark")).toBe(false);
    expect(validPref("language", "it")).toBe(true);
    expect(validPref("language", "fr")).toBe(false);
    expect(validPref("proseSize", 19)).toBe(true);
    expect(validPref("proseSize", 18)).toBe(false);
    expect(validPref("henosisAfter", 10)).toBe(true);
    expect(validPref("henosisAfter", 7.5)).toBe(false);
    expect(validPref("typewriter", "true")).toBe(false);
  });

  it("accepts every value the app offers, so a new preset syncs", () => {
    const offered: [string, readonly unknown[]][] = [
      ["focus", FOCUS_MODES],
      ["proseSize", PROSE_SIZES],
      ["autosaveDelay", AUTOSAVE_DELAY_PRESETS],
      ["henosisAfter", HENOSIS_AFTER_PRESETS],
      ["henosisFade", HENOSIS_FADE_PRESETS],
      ["henosisPause", HENOSIS_PAUSE_PRESETS],
      ["language", APP_LANGUAGES.map((language) => language.value)],
    ];
    for (const [key, values] of offered)
      for (const value of values) expect(validPref(key, value)).toBe(true);
  });

  it("knows no key that is not a preference", () => {
    // Endpoints, folders and credentials have no entry, so another device
    // cannot plant one.
    for (const key of [
      "ai.connection",
      "endpoint",
      "openrouter.key",
      "__proto__",
      "toString",
    ])
      expect(validPref(key, "x")).toBe(false);
    expect(PORTABLE_PREFS).not.toContain("endpoint");
  });

  it("bounds the chosen models list", () => {
    const model = { providerId: "openrouter", modelId: "a/b" };
    expect(validPref("aiModels", [model])).toBe(true);
    expect(
      validPref(
        "aiModels",
        Array.from({ length: 25 }, () => model),
      ),
    ).toBe(false);
    expect(validPref("aiModels", [{ ...model, endpoint: "http://x" }])).toBe(
      false,
    );
    expect(validPref("aiModels", [{ providerId: "p", modelId: "a\nb" }])).toBe(
      false,
    );
  });
});

describe("preferences", () => {
  it("keeps the newest entry per key", () => {
    const d = emptyDoc("i1");
    applyPref(d, "density", { value: "list", updatedAt: T1 });
    applyPref(d, "density", { value: "grid", updatedAt: T0 });
    expect(d.prefs.density.value).toBe("list");
    applyPref(d, "density", { value: "grid", updatedAt: T2 });
    expect(d.prefs.density.value).toBe("grid");
  });

  it("ignores an out-of-domain value or a malformed clock", () => {
    const d = emptyDoc("i1");
    applyPref(d, "density", { value: "huge", updatedAt: T1 });
    applyPref(d, "density", { value: "list", updatedAt: "yesterday" });
    expect(d.prefs).toEqual({});
  });

  it("merges per key, so two devices' unrelated edits both survive", () => {
    const one = doc("i1", {
      prefs: { density: { value: "list", updatedAt: T1 } },
    });
    const two = doc("i2", {
      prefs: {
        density: { value: "grid", updatedAt: T0 },
        language: { value: "it", updatedAt: T0 },
      },
    });
    const merged = mergeDocs(one, [two]);
    expect(merged.prefs.density.value).toBe("list");
    expect(merged.prefs.language.value).toBe("it");
    expect(merged.installation).toBe("i1");
  });

  it("breaks an equal clock by the larger installation id, the same on every device", () => {
    const low = doc("aaaa1111", {
      prefs: { density: { value: "list", updatedAt: T1 } },
    });
    const high = doc("zzzz9999", {
      prefs: { density: { value: "grid", updatedAt: T1 } },
    });
    expect(mergeDocs(low, [high]).prefs.density.value).toBe("grid");
    expect(mergeDocs(high, [low]).prefs.density.value).toBe("grid");
  });
});

describe("library membership", () => {
  it("adds a row and reads it back as a live mirror row", () => {
    const d = emptyDoc("i1");
    applyAdd(d, {
      id: A,
      provider: "local",
      key: "folder",
      name: "Book",
      at: T0,
    });
    expect(libraryOf(d)).toEqual([
      {
        id: A,
        provider: "local",
        key: "folder",
        name: "Book",
        openedAt: T0,
        lastSeenAt: T0,
        removedAt: null,
        card: null,
      },
    ]);
  });

  it("refuses a row whose id is not a project uuid", () => {
    const d = emptyDoc("i1");
    applyAdd(d, {
      id: "book-a",
      provider: "local",
      key: "a",
      name: "A",
      at: T0,
    });
    expect(d.library).toEqual({});
  });

  it("lets a removal win only when strictly newer than the add", () => {
    const d = emptyDoc("i1");
    applyAdd(d, {
      id: A,
      provider: "local",
      key: "folder",
      name: "Book",
      at: T1,
    });
    applyRemove(d, A, T1);
    expect(d.library[A].removedAt).toBeNull();
    applyRemove(d, A, T2);
    expect(d.library[A].removedAt).toBe(T2);
    expect(libraryOf(d)).toEqual([]);
  });

  it("revives a forgotten row on a re-add at the removal's own instant", () => {
    const d = emptyDoc("i1");
    applyAdd(d, {
      id: A,
      provider: "local",
      key: "folder",
      name: "Book",
      at: T0,
    });
    applyRemove(d, A, T1);
    applyAdd(d, {
      id: A,
      provider: "local",
      key: "folder",
      name: "Book",
      at: T1,
    });
    expect(d.library[A].removedAt).toBeNull();
  });

  it("refuses a stale add after a newer removal", () => {
    const d = emptyDoc("i1");
    applyAdd(d, {
      id: A,
      provider: "local",
      key: "folder",
      name: "Book",
      at: T0,
    });
    applyRemove(d, A, T2);
    applyAdd(d, {
      id: A,
      provider: "local",
      key: "folder",
      name: "Book",
      at: T1,
    });
    expect(d.library[A].removedAt).toBe(T2);
  });

  it("keeps a tombstone for a row this copy never saw", () => {
    // A device that holds the add cannot bring the row back after this one
    // forgot it.
    const here = emptyDoc("i1");
    applyRemove(here, A, T2);
    expect(here.library[A]).toMatchObject({ removedAt: T2, card: null });

    const there = doc("i2", { library: { [A]: row(A, { at: T1 }) } });
    expect(libraryOf(mergeDocs(there, [here]))).toEqual([]);
  });

  it("never lets a content push create or revive a row", () => {
    const d = emptyDoc("i1");
    applyAdd(d, {
      id: A,
      provider: "local",
      key: "folder",
      name: "Book",
      at: T2,
      seenAt: T0,
      card: card(A, "Book", T2),
    });
    expect(d.library).toEqual({});

    applyAdd(d, {
      id: A,
      provider: "local",
      key: "folder",
      name: "Book",
      at: T0,
    });
    applyRemove(d, A, T1);
    applyAdd(d, {
      id: A,
      provider: "local",
      key: "folder",
      name: "Book",
      at: T2,
      seenAt: T0,
    });
    expect(d.library[A].removedAt).toBe(T1);
  });

  it("moves a row on a content push only under its newest membership stamp", () => {
    const d = emptyDoc("i1");
    applyAdd(d, { id: A, provider: "local", key: "old", name: "Old", at: T1 });
    applyAdd(d, {
      id: A,
      provider: "drive",
      key: "stale",
      name: "Stale",
      at: T2,
      seenAt: T0,
    });
    expect(d.library[A]).toMatchObject({
      provider: "local",
      key: "old",
      name: "Old",
    });
    applyAdd(d, {
      id: A,
      provider: "drive",
      key: "fresh",
      name: "Fresh",
      at: T2,
      seenAt: T1,
    });
    expect(d.library[A]).toMatchObject({
      provider: "drive",
      key: "fresh",
      name: "Fresh",
      at: T2,
    });
  });

  it("keeps the membership stamp on a content push that moves nothing", () => {
    const d = emptyDoc("i1");
    applyAdd(d, { id: A, provider: "local", key: "k", name: "Book", at: T0 });
    applyAdd(d, {
      id: A,
      provider: "local",
      key: "k",
      name: "Book",
      at: T2,
      seenAt: T0,
      card: card(A, "Book", T2),
    });
    expect(d.library[A].at).toBe(T0);
    expect(d.library[A].card?.cachedAt).toBe(T2);
  });

  it("keeps a rename from the lower installation over a copy that never saw it", () => {
    const untouched = row(A, { provider: "drive", key: "f", name: "Old" });
    const low = doc("aaaa1111", { library: { [A]: { ...untouched } } });
    const high = doc("zzzz9999", { library: { [A]: { ...untouched } } });
    applyAdd(low, {
      id: A,
      provider: "drive",
      key: "f",
      name: "New",
      at: T1,
      seenAt: T0,
    });

    expect(mergeDocs(low, [high]).library[A].name).toBe("New");
    expect(mergeDocs(high, [low]).library[A].name).toBe("New");
  });

  it("merges membership by the newest event across copies", () => {
    const one = doc("i1", {
      library: { [A]: row(A, { at: T0 }), [B]: row(B, { at: T2 }) },
    });
    const two = doc("i2", {
      library: {
        [A]: row(A, { at: T0, removedAt: T1 }),
        [B]: row(B, { at: T1, removedAt: T1 }),
      },
    });
    const merged = mergeDocs(one, [two]);
    expect(merged.library[A].removedAt).toBe(T1);
    expect(merged.library[B].removedAt).toBeNull();
    // The same answer from the other side.
    const back = mergeDocs(two, [one]);
    expect(back.library[A].removedAt).toBe(T1);
    expect(back.library[B].removedAt).toBeNull();
  });

  it("keeps the earliest openedAt across copies", () => {
    const one = doc("i1", {
      library: { [A]: row(A, { openedAt: T1, at: T2 }) },
    });
    const two = doc("i2", {
      library: { [A]: row(A, { openedAt: T0, at: T0 }) },
    });
    expect(mergeDocs(one, [two]).library[A].openedAt).toBe(T0);
  });
});

describe("stamp order", () => {
  // Text order puts "…00Z" after "…00.500Z"; time order puts it before.
  const WHOLE = "2026-10-01T10:00:00Z";
  const HALF = "2026-10-01T10:00:00.500Z";

  it("orders preferences by time, whatever the fraction digits", () => {
    const d = emptyDoc("i1");
    applyPref(d, "density", { value: "list", updatedAt: WHOLE });
    applyPref(d, "density", { value: "grid", updatedAt: HALF });
    expect(d.prefs.density.value).toBe("grid");

    const one = doc("zzzz9999", {
      prefs: { density: { value: "list", updatedAt: WHOLE } },
    });
    const two = doc("aaaa1111", {
      prefs: { density: { value: "grid", updatedAt: HALF } },
    });
    expect(mergeDocs(one, [two]).prefs.density.value).toBe("grid");
  });

  it("orders membership and removals by time", () => {
    const d = emptyDoc("i1");
    applyAdd(d, {
      id: A,
      provider: "local",
      key: "k",
      name: "Book",
      at: WHOLE,
    });
    applyRemove(d, A, HALF);
    expect(d.library[A].removedAt).toBe(HALF);

    const added = doc("zzzz9999", { library: { [A]: row(A, { at: WHOLE }) } });
    const removed = doc("aaaa1111", {
      library: { [A]: row(A, { at: WHOLE, removedAt: HALF }) },
    });
    expect(mergeDocs(added, [removed]).library[A].removedAt).toBe(HALF);
  });

  it("refuses a stamp that has the shape of one but is not a date", () => {
    const d = emptyDoc("i1");
    applyPref(d, "density", {
      value: "list",
      updatedAt: "2026-13-45T10:00:00Z",
    });
    expect(d.prefs).toEqual({});
  });
});

describe("another device's clock", () => {
  const NOW = Date.parse(T0);
  const SOON = "2026-10-01T10:04:59.000Z";
  const LATER = "2026-10-01T10:05:01.000Z";

  it("leaves out a preference stamped more than five minutes ahead", () => {
    const own = doc("i1", {
      prefs: { density: { value: "list", updatedAt: T0 } },
    });
    const ahead = doc("i2", {
      prefs: {
        density: { value: "grid", updatedAt: LATER },
        language: { value: "it", updatedAt: SOON },
      },
    });
    const merged = mergeDocs(own, [ahead], NOW);
    expect(merged.prefs.density.value).toBe("list");
    expect(merged.prefs.language.value).toBe("it");
  });

  it("tells which copies hold an entry the merge leaves out for now", () => {
    expect(
      holdsLater(
        doc("i2", { prefs: { language: { value: "it", updatedAt: SOON } } }),
        NOW,
      ),
    ).toBe(false);
    expect(
      holdsLater(
        doc("i2", { prefs: { density: { value: "grid", updatedAt: LATER } } }),
        NOW,
      ),
    ).toBe(true);
    const row: PortableRow = {
      id: A,
      provider: "local",
      key: "a",
      name: "A",
      openedAt: T0,
      at: T0,
      removedAt: null,
      card: card(A, "A", LATER),
    };
    expect(holdsLater(doc("i2", { library: { [A]: row } }), NOW)).toBe(true);
    expect(
      holdsLater(
        doc("i2", { library: { [A]: { ...row, card: null, at: LATER } } }),
        NOW,
      ),
    ).toBe(true);
    expect(
      holdsLater(doc("i2", { library: { [A]: { ...row, card: null } } }), NOW),
    ).toBe(false);
  });

  it("takes the same entry once this device's clock reaches it", () => {
    const own = doc("i1", {
      prefs: { density: { value: "list", updatedAt: T0 } },
    });
    const ahead = doc("i2", {
      prefs: { density: { value: "grid", updatedAt: LATER } },
    });
    const merged = mergeDocs(own, [ahead], Date.parse(LATER));
    expect(merged.prefs.density.value).toBe("grid");
  });

  it("leaves out a row or a removal stamped more than five minutes ahead", () => {
    const own = doc("i1", { library: { [A]: row(A, { name: "Mine" }) } });
    const ahead = doc("i2", {
      library: {
        [A]: row(A, { name: "Theirs", at: LATER }),
        [B]: row(B, { at: T0, removedAt: LATER }),
      },
    });
    const kept = doc("i1", { library: { [B]: row(B, { at: T0 }) } });

    expect(mergeDocs(own, [ahead], NOW).library[A].name).toBe("Mine");
    expect(mergeDocs(kept, [ahead], NOW).library[B].removedAt).toBeNull();
  });

  it("leaves out a card observed more than five minutes ahead", () => {
    const own = doc("i1", {
      library: { [A]: row(A, { card: card(A, "Mine", T0) }) },
    });
    const ahead = doc("i2", {
      library: { [A]: row(A, { card: card(A, "Theirs", LATER) }) },
    });
    expect(mergeDocs(own, [ahead], NOW).library[A].card?.title).toBe("Mine");
  });

  it("applies the limit to other installations only", () => {
    const own = doc("i1", {
      prefs: { density: { value: "list", updatedAt: T0 } },
    });
    const ownDrive = doc("i1", {
      prefs: { density: { value: "grid", updatedAt: LATER } },
    });
    expect(mergeDocs(own, [ownDrive], NOW).prefs.density.value).toBe("grid");
  });
});

describe("cards", () => {
  it("keeps the newest observation by cachedAt, from any copy", () => {
    // The membership winner and the card's newest observer can differ.
    const one = doc("i1", {
      library: { [A]: row(A, { at: T2, card: card(A, "Older", T0) }) },
    });
    const two = doc("i2", {
      library: { [A]: row(A, { at: T0, card: card(A, "Newer", T1) }) },
    });
    expect(mergeDocs(one, [two]).library[A].card?.title).toBe("Newer");
  });

  it("drops the card with the row on a removal", () => {
    const one = doc("i1", {
      library: { [A]: row(A, { at: T0, card: card(A, "Book", T2) }) },
    });
    const two = doc("i2", {
      library: { [A]: row(A, { at: T0, removedAt: T1 }) },
    });
    expect(mergeDocs(one, [two]).library[A].card).toBeNull();
  });

  it("takes a pushed card only when newer than the one held", () => {
    const d = emptyDoc("i1");
    applyAdd(d, {
      id: A,
      provider: "local",
      key: "f",
      name: "Book",
      at: T0,
      card: card(A, "First", T1),
    });
    applyAdd(d, {
      id: A,
      provider: "local",
      key: "f",
      name: "Book",
      at: T2,
      seenAt: T0,
      card: card(A, "Stale", T0),
    });
    expect(d.library[A].card?.title).toBe("First");
    applyAdd(d, {
      id: A,
      provider: "local",
      key: "f",
      name: "Book",
      at: T2,
      seenAt: T0,
      card: card(A, "Fresh", T2),
    });
    expect(d.library[A].card?.title).toBe("Fresh");
  });

  it("refuses a card that names another book", () => {
    const d = emptyDoc("i1");
    applyAdd(d, {
      id: A,
      provider: "local",
      key: "f",
      name: "Book",
      at: T0,
      card: card(B, "Other", T1),
    });
    expect(d.library[A].card).toBeNull();
  });
});

describe("an untrusted copy", () => {
  it("is refused whole when it is not a version-1 profile", () => {
    expect(asPortableDoc(null)).toBeNull();
    expect(asPortableDoc("profile")).toBeNull();
    expect(asPortableDoc({ v: 2, installation: "i2" })).toBeNull();
    expect(asPortableDoc({ v: 1 })).toBeNull();
  });

  it("keeps only preferences inside the domain, with a well-formed clock", () => {
    const copy = asPortableDoc({
      v: 1,
      installation: "i2",
      prefs: {
        density: { value: "list", updatedAt: T0 },
        language: { value: "klingon", updatedAt: T0 },
        theme: { value: "matte-dark", updatedAt: "now" },
        endpoint: { value: "http://evil.example", updatedAt: T0 },
        focus: "line",
      },
    });
    expect(copy?.prefs).toEqual({ density: { value: "list", updatedAt: T0 } });
  });

  it("keeps only well-formed rows", () => {
    const copy = asPortableDoc({
      v: 1,
      installation: "i2",
      library: {
        [A]: row(A),
        "not-a-uuid": row(A),
        [B]: { ...row(B), provider: "ftp" },
        "0a1b2c3d-0000-4000-8000-00000000000c": {
          ...row(A),
          name: "Book‮evil",
        },
        "0a1b2c3d-0000-4000-8000-00000000000d": {
          ...row(A),
          provider: "drive",
          key: "../x",
        },
        "0a1b2c3d-0000-4000-8000-00000000000e": { ...row(A), at: "later" },
      },
    });
    expect(Object.keys(copy?.library ?? {})).toEqual([A]);
  });

  it("keeps at most 5000 rows", () => {
    const library: Record<string, PortableRow> = {};
    for (let i = 0; i < 5_001; i++) {
      const id = `0a1b2c3d-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
      library[id] = row(id);
    }
    const copy = asPortableDoc({ v: 1, installation: "i2", library });
    expect(Object.keys(copy?.library ?? {})).toHaveLength(5_000);
  });

  it("drops a card from a tombstone", () => {
    const copy = asPortableDoc({
      v: 1,
      installation: "i2",
      library: { [A]: row(A, { removedAt: T1, card: card(A, "Book", T1) }) },
    });
    expect(copy?.library[A].card).toBeNull();
  });
});

describe("sameContent", () => {
  it("compares content and ignores the installation and key order", () => {
    const one = doc("i1", {
      prefs: {
        density: { value: "list", updatedAt: T0 },
        language: { value: "it", updatedAt: T0 },
      },
    });
    const two = doc("i2", {
      prefs: {
        language: { value: "it", updatedAt: T0 },
        density: { value: "list", updatedAt: T0 },
      },
    });
    expect(sameContent(one, two)).toBe(true);
    applyPref(two, "density", { value: "grid", updatedAt: T1 });
    expect(sameContent(one, two)).toBe(false);
  });
});
