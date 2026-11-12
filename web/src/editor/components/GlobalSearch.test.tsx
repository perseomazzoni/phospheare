// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import GlobalSearch from "./GlobalSearch";
import type { ProjectSearch } from "../../project/search";

afterEach(() => cleanup());

// The face's shape is CSS and CSS is not what a test can hold. What these pin
// is the contract the stylesheet and a screen reader are written against: one
// landmark, real headings, and which callback a row reaches.

const results: ProjectSearch = {
  total: 6,
  groups: [
    {
      head: "structure",
      results: [
        {
          kind: "node",
          id: "EL2",
          title: "The Storm",
          nodeKind: "section",
          within: "Act One",
        },
        { kind: "node", id: "EL1", title: "Act One", nodeKind: "part" },
      ],
    },
    {
      head: "body",
      results: [
        {
          kind: "body",
          id: "EL3",
          title: "Opening",
          nodeKind: "section",
          within: "Act One",
          excerpts: [
            { text: "The storm broke over the road.", at: 4, length: 5 },
            { text: "The storm passed.", at: 4, length: 5 },
          ],
        },
      ],
    },
    {
      head: "bin",
      results: [
        { kind: "removed", id: "EL9", title: "Act Zero", nodeKind: "part" },
      ],
    },
    {
      head: "characters",
      results: [
        {
          kind: "reference",
          fileName: "character--vera.md",
          title: "vera",
          group: "characters",
        },
      ],
    },
  ],
};

const noop = () => {};

describe("GlobalSearch", () => {
  it("adds no landmark of its own, and navigates by real headings", () => {
    // No region at all. The panel's `aside` is the landmark and the tree face
    // declares none, so a region here would make the sidebar's landmark map
    // appear and vanish as the writer types: a keystroke reshaping the
    // document's skeleton. Heading navigation is the navigation model for a
    // grouped result list, and it needs no region.
    render(
      <GlobalSearch
        results={results}
        activeId={null}
        activeOccurrence={null}
        pending={false}
        query="storm"
        onOpenChat={noop}
        onOpenBody={noop}
        onOpenNode={noop}
        onOpenReference={noop}
        onRestore={noop}
      />,
    );
    expect(screen.queryAllByRole("region")).toHaveLength(0);
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ).toEqual([
      "tree.structure",
      "tree.findInText",
      "bin.label",
      "reference.group.characters",
    ]);
  });

  it("heads the structure with the same key the tree face uses", () => {
    // A second word for one object, three lines under where the product says
    // "Structure", would be the panel asking whether it now means something
    // else. Pinned as the key, so the two cannot drift apart.
    render(
      <GlobalSearch
        results={results}
        activeId={null}
        activeOccurrence={null}
        pending={false}
        query="storm"
        onOpenChat={noop}
        onOpenBody={noop}
        onOpenNode={noop}
        onOpenReference={noop}
        onRestore={noop}
      />,
    );
    expect(screen.getByText("tree.structure").tagName).toBe("H3");
  });

  it("says where a Section is, and nothing where the heading already said it", () => {
    render(
      <GlobalSearch
        results={results}
        activeId={null}
        activeOccurrence={null}
        pending={false}
        query="storm"
        onOpenChat={noop}
        onOpenBody={noop}
        onOpenNode={noop}
        onOpenReference={noop}
        onRestore={noop}
      />,
    );
    const wheres = [...document.querySelectorAll(".dt-search-where")].map(
      (n) => n.textContent,
    );
    // The Section and the body source inside a Section — both need their
    // Part, because that is what varies row to row under those headings. A
    // Part, a bin item and a reference each sit under a heading that has
    // already answered "where", so they say nothing.
    expect(wheres).toEqual(["Act One", "Act One"]);
  });

  it("says how many times a source holds the words, beside its name", () => {
    // The panel lists the occurrences itself, so the number over them is its
    // own reading of the markdown it searched.
    render(
      <GlobalSearch
        results={results}
        activeId={null}
        activeOccurrence={null}
        pending={false}
        query="storm"
        onOpenChat={noop}
        onOpenBody={noop}
        onOpenNode={noop}
        onOpenReference={noop}
        onRestore={noop}
      />,
    );
    expect(document.querySelector(".dt-search-tally")?.textContent).toBe("2");
  });

  it("lists every occurrence a source holds, one line each", () => {
    // A Part or Section with several occurrences draws a line for each, so
    // the writer needs no control over their prose to walk the rest.
    render(
      <GlobalSearch
        results={results}
        activeId={null}
        activeOccurrence={null}
        pending={false}
        query="storm"
        onOpenChat={noop}
        onOpenBody={noop}
        onOpenNode={noop}
        onOpenReference={noop}
        onRestore={noop}
      />,
    );
    expect(
      [...document.querySelectorAll(".dt-search-occurrence")].map(
        (n) => n.textContent,
      ),
    ).toEqual(["The storm broke over the road.", "The storm passed."]);
    // The name of the source is a heading line above them, not a target: every
    // occurrence under it already opens the file.
    const head = document.querySelector(".dt-search-head");
    expect(head?.tagName).toBe("DIV");
    expect(head?.textContent).toContain("Opening");
  });

  it("draws a row for every occurrence, however many there are", () => {
    // There is no cap: the search is a safe way to find all the occurrences,
    // and a list that stops at fifty looks identical to a book that says the
    // word fifty times.
    const many: ProjectSearch = {
      total: 90,
      groups: [
        {
          head: "body",
          results: [
            {
              kind: "body",
              id: "EL3",
              title: "Opening",
              nodeKind: "section",
              excerpts: Array.from({ length: 90 }, () => ({
                text: "the storm",
                at: 4,
                length: 5,
              })),
            },
          ],
        },
      ],
    };
    render(
      <GlobalSearch
        results={many}
        activeId={null}
        activeOccurrence={null}
        pending={false}
        query="storm"
        onOpenChat={noop}
        onOpenBody={noop}
        onOpenNode={noop}
        onOpenReference={noop}
        onRestore={noop}
      />,
    );
    expect(document.querySelector(".dt-search-tally")?.textContent).toBe("90");
    expect(document.querySelectorAll(".dt-search-occurrence")).toHaveLength(90);
  });

  it("sends each kind of row to its own destination", () => {
    const onOpenNode = vi.fn();
    const onOpenReference = vi.fn();
    const onRestore = vi.fn();
    render(
      <GlobalSearch
        results={results}
        activeId={null}
        activeOccurrence={null}
        pending={false}
        query="storm"
        onOpenChat={noop}
        onOpenBody={noop}
        onOpenNode={onOpenNode}
        onOpenReference={onOpenReference}
        onRestore={onRestore}
      />,
    );
    fireEvent.click(screen.getByText("The Storm"));
    expect(onOpenNode).toHaveBeenCalledWith("EL2");
    // A bin hit begins putting it back — the same act the bin's own row starts.
    fireEvent.click(screen.getByText("Act Zero"));
    expect(onRestore).toHaveBeenCalledWith("EL9");
    fireEvent.click(screen.getByText("vera"));
    expect(onOpenReference).toHaveBeenCalledWith("character--vera.md");
  });

  it("shows a body hit's own words, with the match marked inside them", () => {
    // The reason a body row is the one two-line row in this panel: a hit in
    // the prose that does not show the prose says only "it is in here
    // somewhere", which is the tree the writer already had.
    render(
      <GlobalSearch
        results={results}
        activeId={null}
        activeOccurrence={null}
        pending={false}
        query="storm"
        onOpenChat={noop}
        onOpenBody={noop}
        onOpenNode={noop}
        onOpenReference={noop}
        onRestore={noop}
      />,
    );
    const mark = document.querySelector("mark");
    expect(mark?.textContent).toBe("storm");
    // The whole excerpt is there around it, not just the marked half.
    expect(document.querySelector(".dt-search-excerpt")?.textContent).toBe(
      "The storm broke over the road.",
    );
  });

  it("marks at the offsets the search returned, never by searching again", () => {
    // A second search inside the excerpt would find the first occurrence in
    // the window, which is not necessarily the one the row is about — this
    // line says "storm" twice and the row is about the second.
    const twice: ProjectSearch = {
      total: 1,
      groups: [
        {
          head: "body",
          results: [
            {
              kind: "body",
              id: "EL3",
              title: "Opening",
              nodeKind: "section",
              excerpts: [
                { text: "the storm before the storm", at: 21, length: 5 },
              ],
            },
          ],
        },
      ],
    };
    render(
      <GlobalSearch
        results={twice}
        activeId={null}
        activeOccurrence={null}
        pending={false}
        query="storm"
        onOpenChat={noop}
        onOpenBody={noop}
        onOpenNode={noop}
        onOpenReference={noop}
        onRestore={noop}
      />,
    );
    const excerpt = document.querySelector(".dt-search-excerpt");
    expect(excerpt?.textContent).toBe("the storm before the storm");
    // The marked half is the tail, and what precedes it is the rest of the
    // line rather than a truncation.
    expect(excerpt?.firstChild?.textContent).toBe("the storm before the ");
  });

  it("hands a body hit the query and the ordinal, never an offset", () => {
    // The index counts characters in raw markdown, the engine counts
    // them in a parsed `Doc`, and no mapping between the two survives markup.
    // So the query travels and the editor finds the words again — and with it
    // which occurrence was clicked, the one thing the two coordinate
    // systems can usually agree on.
    const onOpenBody = vi.fn();
    render(
      <GlobalSearch
        results={results}
        activeId={null}
        activeOccurrence={null}
        pending={false}
        query="storm"
        onOpenChat={noop}
        onOpenBody={onOpenBody}
        onOpenNode={noop}
        onOpenReference={noop}
        onRestore={noop}
      />,
    );
    // By position, not by text: a quotation is split across text nodes by the
    // `<mark>` inside it, and the ordinal is exactly its position in the list.
    const rows = document.querySelectorAll(".dt-search-occurrence");
    fireEvent.click(rows[1]);
    expect(onOpenBody).toHaveBeenCalledWith("EL3", "storm", 1);
    fireEvent.click(rows[0]);
    expect(onOpenBody).toHaveBeenCalledWith("EL3", "storm", 0);
  });

  it("marks a hit on the open node, and arrives already marked", () => {
    // The row is created active when the query appears, so the tree's growing
    // left rule cannot animate — it never existed in the unmarked state.
    render(
      <GlobalSearch
        results={results}
        activeId="EL2"
        activeOccurrence={null}
        pending={false}
        query="storm"
        onOpenChat={noop}
        onOpenBody={noop}
        onOpenNode={noop}
        onOpenReference={noop}
        onRestore={noop}
      />,
    );
    const rows = [...document.querySelectorAll(".dt-search-row")];
    expect(rows.filter((r) => r.classList.contains("active"))).toHaveLength(1);
    expect(rows[0]?.textContent).toContain("The Storm");
  });

  it("marks the quotation the writer opened, not the group over it", () => {
    // A click marks the line clicked, not the heading over it: a body group
    // is many rows, and marking the group says "somewhere in this Section" to
    // a writer who has already said which line.
    render(
      <GlobalSearch
        results={results}
        activeId="EL3"
        activeOccurrence={{ id: "EL3", ordinal: 1 }}
        pending={false}
        query="storm"
        onOpenChat={noop}
        onOpenBody={noop}
        onOpenNode={noop}
        onOpenReference={noop}
        onRestore={noop}
      />,
    );
    const quotes = [...document.querySelectorAll(".dt-search-occurrence")];
    expect(quotes[1]?.classList.contains("active")).toBe(true);
    expect(quotes[0]?.classList.contains("active")).toBe(false);
    expect(
      document.querySelector(".dt-search-head")?.classList.contains("active"),
    ).toBe(false);
  });

  it("marks no reference row when nothing is open at all", () => {
    // A reference document is about no node, so its owner is null — and
    // `activeId` is null too until the writer opens something. Two absences
    // must not compare equal, or every reference row lights on the first
    // search of a freshly opened project.
    render(
      <GlobalSearch
        results={results}
        activeId={null}
        activeOccurrence={null}
        pending={false}
        query="storm"
        onOpenChat={noop}
        onOpenBody={noop}
        onOpenNode={noop}
        onOpenReference={noop}
        onRestore={noop}
      />,
    );
    expect(document.querySelectorAll(".dt-search-row.active")).toHaveLength(0);
  });

  it("opens on an invitation rather than on nothing", () => {
    // The face is raised by the find being open, not by there being a
    // query, so its first state is an empty column under an empty field. One
    // line says what the column is for; without it the writer has to spend a
    // keystroke finding out.
    render(
      <GlobalSearch
        results={{ groups: [], total: 0 }}
        activeId={null}
        activeOccurrence={null}
        pending={false}
        query=""
        onOpenChat={noop}
        onOpenBody={noop}
        onOpenNode={noop}
        onOpenReference={noop}
        onRestore={noop}
      />,
    );
    expect(document.querySelector(".dt-search-invite")?.textContent).toBe(
      "tree.findInvite",
    );
    // Not the panel's "there is nothing here" voice. A mode nobody has asked a
    // question of has nothing to report, and saying it found nothing before it
    // was asked is the same false statement `pending` exists to prevent.
    expect(document.querySelector(".dt-moving-none")).toBeNull();
  });

  it("does not say nothing matches about a list that is not the answer yet", () => {
    // Two things make a list not the answer, and the caller folds both into
    // this one flag: the sweep is still running (the project is re-read on
    // every search), or the results still belong to the previous query
    // because they are computed from a deferred value. Either way an empty
    // result set here is not a true one, and "Nothing matches." is a finished
    // sentence in the voice the panel keeps for "there is nothing here" — a
    // writer reads it, believes it, and retypes a word that was in their book
    // all along. An empty body under the field’s own loader claims nothing.
    render(
      <GlobalSearch
        results={{ groups: [], total: 0 }}
        activeId={null}
        activeOccurrence={null}
        pending
        query="storm"
        onOpenChat={noop}
        onOpenBody={noop}
        onOpenNode={noop}
        onOpenReference={noop}
        onRestore={noop}
      />,
    );
    expect(document.querySelector(".dt-moving-none")).toBeNull();
  });

  it("states the mode's own emptiness rather than a node's", () => {
    render(
      <GlobalSearch
        results={{ groups: [], total: 0 }}
        activeId={null}
        activeOccurrence={null}
        pending={false}
        query="storm"
        onOpenChat={noop}
        onOpenBody={noop}
        onOpenNode={noop}
        onOpenReference={noop}
        onRestore={noop}
      />,
    );
    // `.dt-moving-none` is the panel's voice for "this mode has nothing for
    // you"; `.dt-empty` is a fact about a container and would be the wrong
    // speech act here. The sentence is the same key the count speaks, so what
    // a reader hears and what the screen says cannot drift apart.
    expect(document.querySelector(".dt-moving-none")?.textContent).toBe(
      "tree.findCount",
    );
    expect(document.querySelector(".dt-empty")).toBeNull();
  });

  it("holds the glyph slot for a reference row, which has no glyph anywhere", () => {
    render(
      <GlobalSearch
        results={results}
        activeId={null}
        activeOccurrence={null}
        pending={false}
        query="storm"
        onOpenChat={noop}
        onOpenBody={noop}
        onOpenNode={noop}
        onOpenReference={noop}
        onRestore={noop}
      />,
    );
    // Every row keeps the slot so the labels line up across headings, and the
    // reference row's is empty because this app draws none for a reference
    // document. Two name rows, one body source heading, a bin row and a
    // reference row.
    // An occurrence carries no slot: it is a quotation, indented to the title
    // it belongs to rather than a row of its own.
    const slots = [...document.querySelectorAll(".dt-search-glyph")];
    expect(slots).toHaveLength(5);
    expect(slots[4]?.querySelector("svg")).toBeNull();
    expect(slots[0]?.querySelector("svg")).toBeTruthy();
  });
});

describe("GlobalSearch — namesakes", () => {
  it("says which of two same-titled Sections a row opens", () => {
    const anna = (id: string, nth: number) => ({
      kind: "node" as const,
      id,
      title: "Anna",
      nodeKind: "section" as const,
      within: "Part One",
      nth,
    });
    render(
      <GlobalSearch
        results={{
          total: 3,
          groups: [
            {
              head: "structure",
              results: [
                anna("EL2", 1),
                anna("EL4", 2),
                // No Part above it: the number alone tells it apart.
                { ...anna("EL6", 2), within: undefined },
              ],
            },
          ],
        }}
        activeId={null}
        activeOccurrence={null}
        pending={false}
        query="anna"
        onOpenChat={noop}
        onOpenBody={noop}
        onOpenNode={noop}
        onOpenReference={noop}
        onRestore={noop}
      />,
    );
    expect(
      [...document.querySelectorAll(".dt-search-where")].map(
        (n) => n.textContent,
      ),
    ).toEqual(["Part One #1", "Part One #2", "#2"]);
  });
});
