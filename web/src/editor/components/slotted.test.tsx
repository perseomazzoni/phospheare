// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { slotted } from "./slotted";

// A real interpolating translator, as i18next is: the panel and turn suites
// mock `t` with JSON, which escapes the mark, so only this file draws a slot.
const strings: Record<string, string> = {
  once: "No reference is called “{{name}}”. Type a name after {{command}}.",
  twice: "Send {{command}}, or {{command}} alone.",
  mixed: "{{count}} left for {{name}}.",
};
const translate = (key: string, values: Record<string, unknown>) =>
  (strings[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(values[name] ?? ""),
  );

afterEach(() => cleanup());

const draw = (...args: Parameters<typeof slotted>) =>
  render(<p>{slotted(...args)}</p>).container.firstElementChild as HTMLElement;

describe("slotted", () => {
  it("puts each slot where its name sits, in the copy's words", () => {
    const p = draw(translate, "once", {
      name: <bdi>Bruno</bdi>,
      command: <span className="ui-keyword">/canon</span>,
    });
    expect(p.textContent).toBe(
      "No reference is called “Bruno”. Type a name after /canon.",
    );
    expect(p.querySelector("bdi")?.textContent).toBe("Bruno");
    expect(p.querySelector(".ui-keyword")?.textContent).toBe("/canon");
  });

  it("draws a slot the sentence uses twice, twice", () => {
    const p = draw(translate, "twice", {
      command: <span className="ui-keyword">/canon</span>,
    });
    expect(p.querySelectorAll(".ui-keyword")).toHaveLength(2);
    expect(p.textContent).toBe("Send /canon, or /canon alone.");
  });

  it("leaves out a slot the sentence does not use, and fills values as text", () => {
    const p = draw(
      translate,
      "mixed",
      { name: <bdi>Marta</bdi>, unused: <em>never</em> },
      { count: 3 },
    );
    expect(p.textContent).toBe("3 left for Marta.");
    expect(p.querySelector("em")).toBeNull();
  });

  it("never reads a writer's text as a mark or a placeholder", () => {
    const typed = "\u0001command\u0001 {{name}} <b>x</b>";
    const p = draw(translate, "once", {
      name: <bdi>{typed}</bdi>,
      command: <span className="ui-keyword">/canon</span>,
    });
    expect(p.querySelector("bdi")?.textContent).toBe(typed);
    expect(p.querySelectorAll(".ui-keyword")).toHaveLength(1);
    expect(p.querySelector("b")).toBeNull();
  });
});
