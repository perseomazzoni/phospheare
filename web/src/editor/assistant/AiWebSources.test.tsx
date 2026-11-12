// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import AiWebSources from "./AiWebSources";
import type { CitedSource } from "../../ai/domain/webCitations";
import { shownSite } from "../../ai/domain/webText";
import type { SourceQuote } from "./verifyAnswer";

// Pins the sources list under an answer that cited the web. Every
// value it shows is decided upstream, once (`webCitations`): the list adds
// nothing of its own, no ordinal, host or url, and its one link is the
// writer's own click to the stored url, disowned and unendorsed.

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

afterEach(() => {
  cleanup();
});

function source(over: Partial<CitedSource> = {}): CitedSource {
  return {
    id: "web:1",
    url: "https://en.wikipedia.org/wiki/Rome",
    title: "Rome",
    site: "en.wikipedia.org",
    n: 1,
    ...over,
  };
}

const list = () => document.querySelector("ol.ai-web-sources");
const links = () => screen.getAllByRole("link");

describe("AiWebSources", () => {
  it("renders the n it is given, never its position", () => {
    // `n` is set once, in `cited`; a list that counted `index + 1`
    // would number a row differently from the marker that points at it.
    render(
      <AiWebSources
        cited={[
          source({ id: "web:4", n: 2 }),
          source({ id: "web:7", url: "https://example.org/b", n: 5 }),
        ]}
      />,
    );
    expect(
      [...document.querySelectorAll(".ai-web-n")].map((one) => one.textContent),
    ).toEqual(["2", "5"]);
  });

  it("links the stored url exactly, in a new tab, disowned and unendorsed", () => {
    // The href is the url the engine returned and the codec checked,
    // never text the model wrote, and the rel is the whole of it.
    const url = "https://en.wikipedia.org/wiki/Caf%C3%A9?x=1&y=2#top";
    render(<AiWebSources cited={[source({ url })]} />);
    const [link] = links();
    expect(link?.getAttribute("href")).toBe(url);
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("names the list dock.web.sources", () => {
    render(<AiWebSources cited={[source()]} />);
    expect(list()?.getAttribute("aria-label")).toBe("dock.web.sources");
    expect(screen.getByRole("list", { name: "dock.web.sources" })).toBe(list());
  });

  it("reads the new-tab words after a space", () => {
    // `<host> dock.web.newTab`, never `<host>dock.web.newTab`: the hidden
    // words are spans, and spans are joined with no space of their own.
    render(<AiWebSources cited={[source()]} />);
    const [link] = links();
    expect(
      screen.getByRole("link", {
        name: "1 Rome en.wikipedia.org dock.web.newTab",
      }),
    ).toBe(link);
    expect(link?.textContent).not.toContain("orgdock");
  });

  it("shows a long host cut at whole labels, and names it whole", () => {
    // The eye gets the cut, the ear and the hover get the host.
    const site = "aaaaaaaaaaaaaaaaaaaa.bbbb.evil.example";
    const shown = shownSite(site);
    expect(shown).toBe("…bbbb.evil.example");
    render(
      <AiWebSources cited={[source({ url: `https://${site}/p`, site })]} />,
    );
    const block = document.querySelector<HTMLElement>(".ai-web-site");
    expect(block?.querySelector("bdi")?.textContent).toBe(shown);
    expect(block?.querySelector("bdi")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    const hidden = [...(block?.querySelectorAll(".ui-visually-hidden") ?? [])];
    expect(hidden[0]?.textContent).toBe(site);
    expect(block?.getAttribute("title")).toBe(site);
  });

  it("puts a short host's name once, with no hover title", () => {
    render(<AiWebSources cited={[source()]} />);
    expect(document.querySelector(".ai-web-site")?.hasAttribute("title")).toBe(
      false,
    );
  });

  it("names an untitled result by its host, in the title's place", () => {
    // A result the engine named without a title shows its host
    // where the title would be, never an empty gap before it.
    render(<AiWebSources cited={[source({ title: "" })]} />);
    const [link] = links();
    expect(link?.querySelector("span[title]")).toBeNull();
    const n = link?.querySelector(".ai-web-n");
    expect(n?.nextElementSibling?.className).toBe("ai-web-site");
    expect(link?.textContent?.startsWith("1 en.wikipedia.org")).toBe(true);
  });

  it("draws no list when the answer cited nothing", () => {
    render(<AiWebSources cited={[]} />);
    expect(list()).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("AiWebSources: quotes", () => {
  const quote = () => document.querySelector(".ai-web-quote");

  it("hangs the quote under the link, outside it, as q > bdi", () => {
    render(
      <AiWebSources
        cited={[source()]}
        quotes={new Map([["web:1", { text: "completed in 1889" }]])}
      />,
    );
    const [link] = links();
    const shown = quote() as HTMLElement;
    expect(shown.tagName).toBe("P");
    expect(shown.className).toBe("dock-hint ai-web-quote");
    expect(shown.previousElementSibling).toBe(link);
    expect(link?.contains(shown)).toBe(false);
    expect(shown.children).toHaveLength(1);
    const q = shown.firstElementChild as HTMLElement;
    expect(q.tagName).toBe("Q");
    expect(q.children).toHaveLength(1);
    expect(q.firstElementChild?.tagName).toBe("BDI");
    expect(q.textContent).toBe("completed in 1889");
    // Never a span: the evidence family ellipsizes spans.
    expect(shown.querySelector("span")).toBeNull();
  });

  it("marks the words' language on the bdi alone", () => {
    render(
      <AiWebSources
        cited={[source()]}
        quotes={
          new Map([["web:1", { text: "completata nel 1889", lang: "it" }]])
        }
      />,
    );
    expect(quote()?.querySelector("bdi")?.getAttribute("lang")).toBe("it");
    expect(quote()?.querySelector("q")?.hasAttribute("lang")).toBe(false);
    expect(quote()?.hasAttribute("lang")).toBe(false);
    cleanup();
    render(
      <AiWebSources
        cited={[source()]}
        quotes={new Map([["web:1", { text: "completed in 1889" }]])}
      />,
    );
    expect(quote()?.querySelector("bdi")?.hasAttribute("lang")).toBe(false);
  });

  it("draws a quote only under a row it was given for", () => {
    render(
      <AiWebSources
        cited={[source()]}
        quotes={
          new Map([
            ["web:9", { text: "a quote with no row" }],
            ["web:1", { text: "the row's own" }],
          ])
        }
      />,
    );
    expect(document.querySelectorAll(".ai-web-quote")).toHaveLength(1);
    expect(document.body.textContent).not.toContain("a quote with no row");
    cleanup();
    render(
      <AiWebSources
        cited={[]}
        quotes={new Map([["web:1", { text: "nothing to hang on" }]])}
      />,
    );
    expect(document.body.textContent).toBe("");
  });

  // A chat answer's list gains nothing, not even an empty node, from a prop
  // only `/verify` passes; a quote hangs under its own row and no other.
  it.each([
    ["no quotes", undefined, [null, null]],
    ["an empty map", new Map<string, SourceQuote>(), [null, null]],
    [
      "a quote for the second row",
      new Map([["web:2", { text: "completed in 1889" }]]),
      [null, "completed in 1889"],
    ],
  ] as const)(
    "numbers and links each row, and hangs only its own quote, given %s",
    (_, quotes, hung) => {
      const rows = [
        source(),
        source({
          id: "web:2",
          url: "https://example.org/b",
          site: "example.org",
          n: 2,
          title: "",
        }),
      ];
      render(<AiWebSources cited={rows} quotes={quotes} />);
      const items = within(
        screen.getByRole("list", { name: "dock.web.sources" }),
      ).getAllByRole("listitem");
      expect(items).toHaveLength(2);
      const expected = [
        {
          name: "1 Rome en.wikipedia.org dock.web.newTab",
          href: "https://en.wikipedia.org/wiki/Rome",
        },
        {
          name: "2 example.org dock.web.newTab",
          href: "https://example.org/b",
        },
      ];
      expected.forEach((row, index) => {
        const item = items[index] as HTMLElement;
        const link = within(item).getByRole("link", { name: row.name });
        expect(link.getAttribute("href")).toBe(row.href);
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
        // The row is its link, then its quote when it has one, then nothing.
        const [first, ...after] = [...item.childNodes];
        expect(first).toBe(link);
        expect(after.map((node) => node.textContent)).toEqual(
          hung[index] === null ? [] : [hung[index]],
        );
      });
    },
  );

  it("gives the quote no label, seen or heard", () => {
    render(
      <AiWebSources
        cited={[source()]}
        quotes={new Map([["web:1", { text: "completed in 1889" }]])}
      />,
    );
    const shown = quote() as HTMLElement;
    expect(shown.textContent).toBe("completed in 1889");
    expect(shown.querySelector(".ui-visually-hidden")).toBeNull();
    expect(
      [shown, ...shown.querySelectorAll("*")].some(
        (node) =>
          node.hasAttribute("aria-label") ||
          node.hasAttribute("aria-labelledby") ||
          node.hasAttribute("title"),
      ),
    ).toBe(false);
  });
});
