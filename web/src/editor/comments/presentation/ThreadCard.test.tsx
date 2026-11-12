// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { Author, Thread } from "../domain/model";
import type { PersonaFace } from "./faces";
import ThreadCard, { type ReplyState, type ThreadActions } from "./ThreadCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && "name" in options
        ? `${key}:${String(options.name)}`
        : options && "query" in options
          ? `${key} ${String(options.query)}`
          : key,
    i18n: { language: "en" },
  }),
}));

afterEach(cleanup);

const PERSONAS: PersonaFace[] = [
  { id: "wren", name: "Wren", color: "#155393" },
];
const ANCHOR = { quote: "storm", prefix: "The ", suffix: " came" };

function thread(
  state: Thread["state"],
  author: Author,
  replies: string[] = [],
): Thread {
  return {
    id: "t1",
    state,
    anchor: ANCHOR,
    entries: [
      { id: "e0", author, at: "2026-10-05T10:00:00.000Z", body: "Opening." },
      ...replies.map((body, i) => ({
        id: `e${i + 1}`,
        author: { kind: "writer" } as Author,
        at: "2026-10-05T11:00:00.000Z",
        body,
      })),
    ],
  };
}

function actions(): ThreadActions & Record<string, ReturnType<typeof vi.fn>> {
  return {
    keep: vi.fn(),
    remove: vi.fn(),
    resolve: vi.fn(),
    reopen: vi.fn(),
    reply: vi.fn(() => Promise.resolve()),
  };
}

function draw(
  of: Thread,
  extra: {
    active?: boolean;
    orphan?: boolean;
    acts?: ThreadActions;
    reply?: ReplyState;
    writer?: { name: string | null; avatarUrl: string | null };
  } = {},
) {
  const acts = extra.acts ?? actions();
  const onActivate = vi.fn();
  render(
    <ThreadCard
      thread={of}
      personas={PERSONAS}
      writer={extra.writer}
      orphan={extra.orphan ?? false}
      active={extra.active ?? true}
      onActivate={onActivate}
      actions={acts}
      reply={extra.reply}
    />,
  );
  return { acts, onActivate };
}

const button = (name: string) => screen.queryByRole("button", { name });

describe("ThreadCard", () => {
  // A tag is drawn in the link's colour, so who was called in shows at a
  // glance, though nothing is there to press.
  it("marks each persona tag, and nothing else", () => {
    draw(
      thread("open", { kind: "writer" }, ["@wren, and again @Wren; a@Wren.it"]),
    );
    const tags = [...document.querySelectorAll(".cm-body .ui-mention")];
    expect(tags.map((tag) => tag.textContent)).toEqual(["@wren", "@Wren"]);
    expect(tags.every((tag) => tag.tagName === "SPAN")).toBe(true);
    expect(document.body.textContent).toContain(
      "@wren, and again @Wren; a@Wren.it",
    );
  });

  // One face for one person: the writer's entries wear the kit's Avatar, the
  // titlebar's own, and a persona's keeps its picture.
  it("draws the writer's entries with the face the titlebar wears", () => {
    draw(thread("open", { kind: "writer" }, ["Again."]), {
      writer: { name: "Ada Lovelace", avatarUrl: "https://example.test/a.png" },
    });
    const faces = document.querySelectorAll("img.app-avatar");
    expect(faces).toHaveLength(2);
    expect(faces[0].getAttribute("src")).toBe("https://example.test/a.png");
    expect(document.querySelector(".cm-face-letter")).toBeNull();
  });

  it("gives a writer with no picture their initial, as the titlebar does", () => {
    draw(thread("open", { kind: "writer" }), {
      writer: { name: "Ada Lovelace", avatarUrl: null },
    });
    expect(document.querySelector(".app-avatar-initial")?.textContent).toBe(
      "A",
    );
  });

  it("keeps the margin's own letter for the writer with no account", () => {
    draw(thread("open", { kind: "writer" }));
    expect(document.querySelector(".app-avatar")).toBeNull();
    expect(document.querySelector(".cm-face-letter")?.textContent).toBe("C");
  });

  it("offers a ghost keep, reply and dismiss — and dismisses without asking", () => {
    const acts = actions();
    draw(thread("proposed", { kind: "persona", id: "wren" }), { acts });
    expect(screen.getByText("comments.suggested")).toBeTruthy();
    expect(button("comments.keep")).toBeTruthy();
    expect(button("comments.resolve")).toBeNull();
    fireEvent.click(button("comments.keep") as HTMLElement);
    expect(acts.keep).toHaveBeenCalledOnce();
    fireEvent.click(button("comments.dismiss") as HTMLElement);
    expect(acts.remove).toHaveBeenCalledOnce();
  });

  it("asks once more before removing a thread a person wrote", () => {
    const acts = actions();
    draw(thread("open", { kind: "writer" }), { acts });
    fireEvent.click(button("comments.remove") as HTMLElement);
    expect(acts.remove).not.toHaveBeenCalled();
    expect(screen.getByText("comments.removeConfirm")).toBeTruthy();
    // The confirm row carries its own Remove; it is the one that acts.
    const confirm = screen.getByRole("group");
    fireEvent.click(
      Array.from(confirm.querySelectorAll("button")).find(
        (b) => b.textContent === "comments.remove",
      ) as HTMLElement,
    );
    expect(acts.remove).toHaveBeenCalledOnce();
  });

  it("removes a persona's kept thread without asking: it is remembered as a dismissal", () => {
    const acts = actions();
    draw(thread("open", { kind: "persona", id: "wren" }), { acts });
    fireEvent.click(button("comments.remove") as HTMLElement);
    expect(acts.remove).toHaveBeenCalledOnce();
  });

  it("offers a resolved thread only reopen and remove", () => {
    const acts = actions();
    draw(thread("resolved", { kind: "writer" }), { acts });
    expect(button("comments.reply")).toBeNull();
    expect(button("comments.resolve")).toBeNull();
    fireEvent.click(button("comments.reopen") as HTMLElement);
    expect(acts.reopen).toHaveBeenCalledOnce();
  });

  it("sends a reply written in the card", () => {
    const acts = actions();
    draw(thread("open", { kind: "writer" }), { acts });
    fireEvent.click(button("comments.reply") as HTMLElement);
    const area = screen.getByRole("combobox");
    fireEvent.change(area, { target: { value: "On reflection, yes." } });
    fireEvent.keyDown(area, { key: "Enter", ctrlKey: true });
    expect(acts.reply).toHaveBeenCalledWith("On reflection, yes.");
  });

  it("keeps a reply open and as typed until the file has taken it", async () => {
    const writes: { done: () => void; refuse: (why: Error) => void }[] = [];
    const reply = vi.fn(
      () => new Promise<void>((done, refuse) => writes.push({ done, refuse })),
    );
    const acts = { ...actions(), reply };
    draw(thread("open", { kind: "writer" }), { acts });
    fireEvent.click(button("comments.reply") as HTMLElement);
    const area = () => screen.queryByRole("combobox") as HTMLTextAreaElement;
    fireEvent.change(area(), { target: { value: "On reflection, yes." } });
    fireEvent.keyDown(area(), { key: "Enter", ctrlKey: true });
    // Writing: the words stay, and Send waits.
    expect(area().value).toBe("On reflection, yes.");
    expect((button("comments.send") as HTMLButtonElement).disabled).toBe(true);
    // Refused: still there, ready to send again.
    await act(async () => writes[0].refuse(new Error("offline")));
    expect(area().value).toBe("On reflection, yes.");
    fireEvent.keyDown(area(), { key: "Enter", ctrlKey: true });
    // Taken: the composer closes.
    await act(async () => writes[1].done());
    expect(area()).toBeNull();
    expect(reply).toHaveBeenCalledTimes(2);
  });

  it("folds the answers into a count until the card is opened", () => {
    const { onActivate } = draw(
      thread("open", { kind: "writer" }, ["One.", "Two."]),
      { active: false },
    );
    expect(screen.queryByText("One.")).toBeNull();
    expect(screen.getByText("comments.answers")).toBeTruthy();
    expect(button("comments.reply")).toBeNull();
    fireEvent.click(screen.getByRole("article"));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("shows an orphan's original words, and re-attaches only when it can", () => {
    const acts = { ...actions(), reattach: vi.fn() };
    draw(thread("open", { kind: "writer" }), { orphan: true, acts });
    expect(screen.getByText("comments.orphan")).toBeTruthy();
    expect(screen.getByText("storm")).toBeTruthy();
    fireEvent.click(button("comments.reattach") as HTMLElement);
    expect(acts.reattach).toHaveBeenCalledOnce();
    cleanup();
    draw(thread("open", { kind: "writer" }), { orphan: true });
    expect(button("comments.reattach")).toBeNull();
  });

  it("says who is writing, and offers a retry when an answer did not come", () => {
    const retry = vi.fn();
    draw(thread("open", { kind: "writer" }), {
      reply: { writing: "Wren", failed: { name: "Wren", retry } },
    });
    expect(screen.getByRole("status").textContent).toBe(
      "comments.writing:Wren",
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "comments.replyFailed:Wren",
    );
    fireEvent.click(button("comments.retry") as HTMLElement);
    expect(retry).toHaveBeenCalledOnce();
  });

  it("shows a search waiting on the writer, and the pages a reply searched", () => {
    const searched: Thread = {
      ...thread("open", { kind: "writer" }),
      entries: [
        ...thread("open", { kind: "writer" }).entries,
        {
          id: "e9",
          author: { kind: "persona", id: "wren" },
          at: "2026-10-05T10:00:00.000Z",
          body: "It was.",
          searched: [
            {
              engine: "wikipedia",
              query: "storm",
              links: [
                { url: "https://e.org/storm", title: "Storm" },
                { url: "https://e.org/untitled", title: "" },
              ],
            },
          ],
        },
      ],
    };
    draw(searched, {
      active: true,
      reply: { writing: "Wren", asking: <button type="button">ASK</button> },
    });
    expect(screen.getByText("ASK")).toBeTruthy();
    expect(screen.getByText("storm").closest("q")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Storm" });
    expect(link.getAttribute("href")).toBe("https://e.org/storm");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
    // A page with no title is named by its host.
    expect(screen.getByRole("link", { name: "e.org" })).toBeTruthy();
  });

  it("says what the answer is doing while it reads the book", () => {
    draw(thread("open", { kind: "writer" }), {
      reply: { writing: "Wren", doing: "Reading “Two”" },
    });
    expect(screen.getByRole("status").textContent).toBe("comments.doing:Wren");
  });
});
