// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  backdropCloses,
  escapeTarget,
  isTop,
  push,
  remove,
  setDismissible,
  top,
  trapsFocus,
  type Layer,
} from "./layerStack";

const dialog = (id: string): Layer => ({
  id,
  role: "dialog",
  dismissible: true,
});
const alert = (id: string): Layer => ({
  id,
  role: "alertdialog",
  dismissible: false,
});
const menu = (id: string): Layer => ({ id, role: "menu", dismissible: true });

describe("push", () => {
  it("stacks in the order layers open", () => {
    const s = push(push([], dialog("a")), dialog("b"));
    expect(s.map((l) => l.id)).toEqual(["a", "b"]);
  });

  // StrictMode mounts every effect twice. A stack that grew on the second
  // mount would need two Escapes to clear one dialog.
  it("is idempotent by id", () => {
    const once = push([], dialog("a"));
    const twice = push(once, dialog("a"));
    expect(twice.map((l) => l.id)).toEqual(["a"]);
  });

  it("moves a re-pushed layer to the top and takes its new state", () => {
    let s = push(push([], dialog("a")), dialog("b"));
    s = push(s, alert("a"));
    expect(s.map((l) => l.id)).toEqual(["b", "a"]);
    expect(top(s)?.dismissible).toBe(false);
  });

  it("does not mutate the stack it was given", () => {
    const before = push([], dialog("a"));
    push(before, dialog("b"));
    expect(before.map((l) => l.id)).toEqual(["a"]);
  });
});

describe("remove", () => {
  it("takes a layer out", () => {
    const s = remove(push(push([], dialog("a")), dialog("b")), "a");
    expect(s.map((l) => l.id)).toEqual(["b"]);
  });

  it("is silent about an id that was never there", () => {
    const s = push([], dialog("a"));
    expect(remove(s, "ghost").map((l) => l.id)).toEqual(["a"]);
  });

  it("survives being called twice for the same layer", () => {
    const s = push([], dialog("a"));
    expect(remove(remove(s, "a"), "a")).toEqual([]);
  });
});

describe("top and isTop", () => {
  it("is null for an empty stack", () => {
    expect(top([])).toBeNull();
    expect(isTop([], "a")).toBe(false);
  });

  it("names the most recently opened layer", () => {
    const s = push(push([], dialog("a")), dialog("b"));
    expect(isTop(s, "b")).toBe(true);
    expect(isTop(s, "a")).toBe(false);
  });

  it("hands the top back when the one above it closes", () => {
    const s = remove(push(push([], dialog("a")), dialog("b")), "b");
    expect(isTop(s, "a")).toBe(true);
  });
});

describe("escapeTarget", () => {
  it("does nothing when nothing is open", () => {
    expect(escapeTarget([])).toBeNull();
  });

  it("closes the innermost layer only", () => {
    const s = push(push([], dialog("a")), dialog("b"));
    expect(escapeTarget(s)).toBe("b");
  });

  // A menu over a dialog closes the menu, and the dialog stays.
  it("leaves the layer beneath standing", () => {
    let s = push(push([], dialog("sheet")), dialog("menu"));
    // Both layers here are dismissible, so a menu is always escapable; a null
    // would mean the stack contract changed, not that remove gets a null id.
    const target = escapeTarget(s);
    if (target === null) throw new Error("expected an escapable top layer");
    s = remove(s, target);
    expect(s.map((l) => l.id)).toEqual(["sheet"]);
    expect(escapeTarget(s)).toBe("sheet");
  });

  it("is refused by a layer that will not be dismissed", () => {
    const s = push(push([], dialog("a")), alert("confirm"));
    expect(escapeTarget(s)).toBeNull();
  });

  // A non-dismissible layer swallows the key rather than passing it to what
  // is underneath, because a modal exists to prevent reaching past it.
  it("does not fall through to a dismissible layer underneath", () => {
    const s = push(push([], dialog("sheet")), alert("progress"));
    expect(escapeTarget(s)).toBeNull();
    expect(s.map((l) => l.id)).toEqual(["sheet", "progress"]);
  });
});

describe("backdropCloses", () => {
  it("is true for the top dismissible layer", () => {
    const s = push([], dialog("a"));
    expect(backdropCloses(s, "a")).toBe(true);
  });

  it("is false for an alert, which wants an explicit answer", () => {
    const s = push([], alert("a"));
    expect(backdropCloses(s, "a")).toBe(false);
  });

  // A click arriving for a buried layer is stale: its backdrop is covered.
  it("is false for anything but the top", () => {
    const s = push(push([], dialog("a")), dialog("b"));
    expect(backdropCloses(s, "a")).toBe(false);
    expect(backdropCloses(s, "b")).toBe(true);
  });

  it("is false when nothing is open", () => {
    expect(backdropCloses([], "a")).toBe(false);
  });
});

describe("trapsFocus", () => {
  it("is true for the modals", () => {
    expect(trapsFocus(dialog("a"))).toBe(true);
    expect(trapsFocus(alert("a"))).toBe(true);
  });

  // A menu is on the stack only so Escape closes it rather than the dialog
  // behind it. It is not a modal, and Tab leaves it.
  it("is false for a menu", () => {
    expect(trapsFocus(menu("a"))).toBe(false);
  });

  it("is false when nothing is open", () => {
    expect(trapsFocus(null)).toBe(false);
  });
});

// A menu opened over a dialog is the case the stack exists for.
describe("a menu over a dialog", () => {
  it("takes Escape for itself and leaves the dialog standing", () => {
    const s = push(push([], dialog("sheet")), menu("actions"));
    expect(escapeTarget(s)).toBe("actions");
    expect(escapeTarget(remove(s, "actions"))).toBe("sheet");
  });
});

describe("setDismissible", () => {
  const stack = [
    { id: "a", role: "dialog" as const, dismissible: true },
    { id: "b", role: "dialog" as const, dismissible: true },
  ];

  it("changes the flag in place, without moving the layer", () => {
    const next = setDismissible(stack, "a", false);
    expect(next.map((layer) => [layer.id, layer.dismissible])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });

  it("hands back the same stack when nothing changes, so nobody is told", () => {
    expect(setDismissible(stack, "a", true)).toBe(stack);
    expect(setDismissible(stack, "missing", false)).toBe(stack);
  });
});
