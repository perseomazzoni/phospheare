// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SummaryState } from "../../ai";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import ReferenceReader, { type ReferenceEditSession } from "./ReferenceReader";
import { referenceFolderChanged } from "./referenceShared";
import type { ProjectRef, StorageProvider } from "../../storage";
import { serializeSummary } from "../../ai/adapters/summaryCodec";
import { hashOf } from "../../text/hash";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

// A reference document is not a `Doc`. It never enters the main editor's undo
// history, dirty flag or autosave path — opening the bible to check a detail
// must not put the writer one Ctrl+Z away from changing the novel. Editing
// lives here, in the dock, against the raw Markdown the file actually is.

const REF: ProjectRef = {
  providerId: "memory",
  key: "demo",
  name: "Demo",
  openedAt: "",
};

function makeProvider(text: string | Error) {
  const writeFile = vi.fn(async () => undefined);
  const provider = {
    readFile: vi.fn(async () => {
      if (text instanceof Error) throw text;
      return text;
    }),
    writeFile,
  } as unknown as StorageProvider;
  return { provider, writeFile };
}

function noopCallbacks() {
  return {
    onStartEdit: vi.fn(),
    onDraft: vi.fn(),
    onCancelEdit: vi.fn(),
    onSaveEdit: vi.fn(async () => true),
  };
}

const FILE = "character--maren.md";

function renderReader({
  provider,
  fileName = FILE,
  emptyLabel,
  editing = null,
  callbacks = noopCallbacks(),
  judgeSummary,
}: {
  provider: StorageProvider;
  fileName?: string | null;
  emptyLabel?: string;
  editing?: ReferenceEditSession | null;
  callbacks?: ReturnType<typeof noopCallbacks>;
  judgeSummary?: (nodeId: string) => Promise<SummaryState>;
}) {
  render(
    <ReferenceReader
      provider={provider}
      projectRef={REF}
      fileName={fileName}
      emptyLabel={emptyLabel}
      editing={editing}
      onStartEdit={callbacks.onStartEdit}
      onDraft={callbacks.onDraft}
      onCancelEdit={callbacks.onCancelEdit}
      onSaveEdit={callbacks.onSaveEdit}
      judgeSummary={judgeSummary}
    />,
  );
  return callbacks;
}

const rendered = () => document.querySelector(".dock-read")?.innerHTML ?? "";

describe("ReferenceReader — read mode", () => {
  it("re-reads the open file when the folder changes, without going blank", async () => {
    // An updated summary is rewritten in place, under the name the reader
    // already has open, and the reader follows it without the dock being
    // reopened.
    let text = ["# Before", "", "The storm."].join("\n");
    const provider = {
      readFile: vi.fn(async () => text),
      writeFile: vi.fn(async () => undefined),
    } as unknown as StorageProvider;
    renderReader({ provider });
    await waitFor(() => expect(rendered()).toContain("Before"));
    text = ["# After", "", "The calm."].join("\n");
    let blanked = false;
    const watch = new MutationObserver(() => {
      if (!rendered().includes("Before") && !rendered().includes("After"))
        blanked = true;
    });
    const read = document.querySelector(".dock-read");
    if (read)
      watch.observe(read, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    act(() => referenceFolderChanged());
    await waitFor(() => expect(rendered()).toContain("After"));
    watch.disconnect();
    // The same file keeps its text until the new one lands.
    expect(blanked).toBe(false);
  });

  it("renders the document as prose", async () => {
    renderReader({
      provider: makeProvider(
        "# Maren\n\nReads weather the way other people read a room.",
      ).provider,
    });
    await waitFor(() => expect(rendered()).toContain("<h1>Maren</h1>"));
    expect(rendered()).toContain("Reads weather");
  });

  it("names the group and the title it is showing", async () => {
    renderReader({ provider: makeProvider("x").provider });
    await waitFor(() =>
      expect(document.querySelector(".dock-meta")).toBeTruthy(),
    );
    const meta = document.querySelector(".dock-meta")?.textContent ?? "";
    expect(meta).toContain("reference.group.characters");
    expect(meta).toContain("maren");
  });

  // A catalogue section shows its localized label: the file stem is the
  // English id, the words live in the locales.
  it("shows a catalogue section's label, not its file stem", async () => {
    renderReader({
      provider: makeProvider("x").provider,
      fileName: "world--economy.md",
    });
    await waitFor(() =>
      expect(document.querySelector(".dock-meta")).toBeTruthy(),
    );
    const meta = document.querySelector(".dock-meta")?.textContent ?? "";
    expect(meta).toContain("reference.group.world");
    expect(meta).toContain("reference.section.world.economy");
    expect(meta).not.toContain("economy.md");
  });

  // A file that declares no group — `reference/` refuses nothing — is named by
  // its title alone; there is no group label to print before it.
  it("names only the title when the file declares no group", async () => {
    renderReader({
      provider: makeProvider("x").provider,
      fileName: "scrap.md",
    });
    await waitFor(() =>
      expect(document.querySelector(".dock-meta")).toBeTruthy(),
    );
    const meta = document.querySelector(".dock-meta")?.textContent ?? "";
    expect(meta).toContain("scrap");
    expect(meta).not.toContain("reference.group.");
  });

  // The meta line already names what is open, and the vertical space is
  // better spent on the document, so nothing prints `reference/<file>` in
  // the reader.
  it("does not print the file's path", async () => {
    renderReader({ provider: makeProvider("x").provider });
    await waitFor(() =>
      expect(document.querySelector(".dock-meta")).toBeTruthy(),
    );
    await waitFor(() => expect(rendered()).toContain("x"));
    expect(document.querySelector(".dock-foot")).toBeNull();
  });

  it("offers no authority control: a reference is a reference", async () => {
    // The writer does not rate their own reference documents and the
    // assistant reads no rating. Pinned as an absence, because a two-button
    // group reappearing on this face is the regression nothing else would
    // catch.
    renderReader({ provider: makeProvider("A possibility.").provider });
    await waitFor(() => expect(rendered()).toContain("A possibility."));
    expect(document.querySelector(".dock-authority")).toBeNull();
    expect(screen.queryByRole("group", { name: /authority/i })).toBeNull();
    for (const name of ["dock.authority", "dock.tentative", "dock.canon"])
      expect(screen.queryByText(name), name).toBeNull();
  });

  it("renders generated summaries without metadata and never offers Edit", async () => {
    const body = "# What happened\n\nA storm arrives.";
    const raw = serializeSummary(
      {
        schemaVersion: 1,
        nodeId: "EL3",
        scope: "node",
        sources: [{ nodeId: "EL3", contentHash: "abc" }],
        model: { providerId: "ollama", modelId: "qwen" },
        recipe: "node-summary",
        recipeRevision: "1",
        language: "en",
        generatedAt: "2026-09-16T00:00:00.000Z",
        bodyHash: await hashOf(body),
      },
      body,
    );
    // The badge is the assistant's judgement, asked by node id.
    const judgeSummary = vi.fn(async () => "current" as const);
    renderReader({
      provider: makeProvider(raw).provider,
      fileName: "summary--EL3.md",
      judgeSummary,
    });
    await waitFor(() => expect(rendered()).toContain("What happened"));
    expect(rendered()).not.toContain("schemaVersion");
    expect(screen.queryByRole("button", { name: "dock.edit" })).toBeNull();
    await waitFor(() =>
      expect(
        document.querySelector(".dock-generated-badge")?.textContent,
      ).toContain("dock.summaryState.current"),
    );
    expect(judgeSummary).toHaveBeenCalledWith("EL3");
  });

  it("reads a summary the assistant cannot vouch for as Unverified, never Missing", async () => {
    // "missing" from the assistant means it could not read the summary that is
    // on screen right now — and a badge saying Missing over visible text is a
    // contradiction. Without an assistant there is nobody to ask at all.
    for (const judgeSummary of [
      vi.fn(async () => "missing" as const),
      undefined,
    ]) {
      renderReader({
        provider: makeProvider("Just prose.").provider,
        fileName: "summary--EL3.md",
        judgeSummary,
      });
      await waitFor(() =>
        expect(
          document.querySelector(".dock-generated-badge")?.textContent,
        ).toContain("dock.summaryState.unverified"),
      );
      cleanup();
    }
  });

  // A folder is not a trust boundary anyone should be asked to think about, so
  // the parser has HTML off and the markup arrives escaped.
  it("never lets a file become markup", async () => {
    renderReader({
      provider: makeProvider(
        'Careful: <img src=x onerror="alert(1)"> and <b>bold</b>.',
      ).provider,
    });
    await waitFor(() => expect(rendered()).toContain("Careful"));
    expect(document.querySelector(".dock-read img")).toBeNull();
    expect(document.querySelector(".dock-read b")).toBeNull();
    expect(rendered()).toContain("&lt;img");
  });

  // A generated summary is model output, and a model can be steered by what
  // it read: an image would be an automatic network request (a reading-event
  // leak), and a `javascript:` link a live protocol. Images render as their
  // alt text; unsafe protocols render inert.
  it("renders images inert and refuses unsafe link protocols", async () => {
    renderReader({
      provider: makeProvider(
        "![tracker](https://evil.example/pixel.png) and [click](javascript:alert(1)) and [site](https://example.com)",
      ).provider,
    });
    await waitFor(() => expect(rendered()).toContain("tracker"));
    expect(document.querySelector(".dock-read img")).toBeNull();
    const links = [...document.querySelectorAll(".dock-read a")].map((one) =>
      one.getAttribute("href"),
    );
    expect(links).toEqual(["https://example.com"]);
    expect(rendered()).toContain("javascript:alert(1)");
  });

  // Template notes are guidance for the writer only (stripped before any
  // document reaches a model): the reader shows them as quiet asides, never
  // as raw `<!-- -->` text.
  it("renders a template note as a quiet aside, never as raw comment text", async () => {
    renderReader({
      provider: makeProvider(
        "- **Central theme:**\n\n<!-- Hint: keep it arguable. -->\n",
      ).provider,
    });
    await waitFor(() => expect(rendered()).toContain("Central theme"));
    const note = document.querySelector(".dock-read .tpl-note");
    expect(note).toBeTruthy();
    // The note is drawn exactly as written — no label is parsed out of it.
    expect(note?.textContent).toContain("Hint: keep it arguable");
    expect(document.querySelector(".dock-read")?.textContent).not.toContain(
      "<!--",
    );
  });

  // Any comment at all becomes a note, whatever is inside it: the writer's
  // own remark in their own file is never swallowed for not looking like ours.
  it("renders any comment as a note, in any language", async () => {
    renderReader({
      provider: makeProvider("<!-- Esempio: la sete di sapere. -->\n").provider,
    });
    await waitFor(() =>
      expect(document.querySelector(".dock-read .tpl-note")).toBeTruthy(),
    );
    const note = document.querySelector(".dock-read .tpl-note");
    expect(note?.textContent).toContain("Esempio: la sete di sapere");
  });

  it("never lets a note's own markup become HTML either", async () => {
    renderReader({
      provider: makeProvider('<!-- Example: <img src=x onerror="alert(1)"> -->')
        .provider,
    });
    await waitFor(() =>
      expect(document.querySelector(".tpl-note")).toBeTruthy(),
    );
    expect(document.querySelector(".dock-read img")).toBeNull();
    expect(rendered()).toContain("&lt;img");
  });

  it("says so when the file cannot be read", async () => {
    renderReader({ provider: makeProvider(new Error("gone")).provider });
    await waitFor(() =>
      expect(screen.getByText("dock.unreadable")).toBeTruthy(),
    );
  });

  it("invites a choice when nothing is open", () => {
    renderReader({ provider: makeProvider("x").provider, fileName: null });
    expect(screen.getByText("dock.pickReference")).toBeTruthy();
  });

  // Each face names its own empty state: the notes face must not tell the
  // writer to choose something from the Reference shelf.
  it("lets a face name its own empty state", () => {
    renderReader({
      provider: makeProvider("x").provider,
      fileName: null,
      emptyLabel: "dock.pickNote",
    });
    expect(screen.getByText("dock.pickNote")).toBeTruthy();
    expect(screen.queryByText("dock.pickReference")).toBeNull();
  });

  it("renders the ordinary marks a note is written with", async () => {
    renderReader({
      provider: makeProvider("**bold** and *italic* and `code`\n\n- one\n- two")
        .provider,
    });
    await waitFor(() => expect(rendered()).toContain("<strong>bold</strong>"));
    expect(rendered()).toContain("<em>italic</em>");
    expect(rendered()).toContain("<code>code</code>");
    expect(document.querySelectorAll(".dock-read li")).toHaveLength(2);
  });

  it("offers to edit once the file has loaded, handing up the loaded text", async () => {
    const callbacks = renderReader({
      provider: makeProvider("# Maren").provider,
    });
    await waitFor(() => expect(screen.getByText("dock.edit")).toBeTruthy());
    fireEvent.click(screen.getByText("dock.edit"));
    expect(callbacks.onStartEdit).toHaveBeenCalledWith(FILE, "# Maren");
  });

  it("does not offer to edit a file that failed to read", async () => {
    renderReader({ provider: makeProvider(new Error("gone")).provider });
    await waitFor(() =>
      expect(screen.getByText("dock.unreadable")).toBeTruthy(),
    );
    expect(screen.queryByText("dock.edit")).toBeNull();
  });
});

describe("ReferenceReader — edit mode", () => {
  const session = (
    draft: string,
    savedText = "# Maren",
  ): ReferenceEditSession => ({
    fileName: FILE,
    savedText,
    draft,
  });

  it("shows the draft in the textarea and reports changes upward", () => {
    const callbacks = renderReader({
      provider: makeProvider("# Maren").provider,
      editing: session("# Maren"),
    });
    const area = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(area.value).toBe("# Maren");
    fireEvent.change(area, { target: { value: "# Maren\n\nHer eyes" } });
    expect(callbacks.onDraft).toHaveBeenCalledWith("# Maren\n\nHer eyes");
  });

  it("saves through the session saver and reports a failure, keeping the draft", async () => {
    const callbacks = noopCallbacks();
    callbacks.onSaveEdit = vi.fn(async () => false);
    renderReader({
      provider: makeProvider("# Maren").provider,
      editing: session("changed"),
      callbacks,
    });
    fireEvent.click(screen.getByText("dock.save"));
    await waitFor(() => expect(callbacks.onSaveEdit).toHaveBeenCalled());
    expect(screen.getByText("dock.saveFailed")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "changed",
    );
  });

  it("edits a document that is not on disk, and refuses to create it empty", async () => {
    // The chat's "Write X": the template opens in the
    // editor with no file behind it, and a save of the template alone writes
    // nothing — it says why, and the next keystroke clears the note.
    const provider = makeProvider(new Error("missing")).provider;
    const template = "# Logline\n\n- **The story in a sentence:**\n  - ";
    const callbacks = noopCallbacks();
    const { rerender } = render(
      <ReferenceReader
        provider={provider}
        projectRef={REF}
        fileName="guidebook--logline.md"
        editing={{
          fileName: "guidebook--logline.md",
          savedText: template,
          draft: template,
          unborn: true,
        }}
        {...callbacks}
      />,
    );
    // No read was attempted, so nothing calls the missing file unreadable.
    expect(provider.readFile).not.toHaveBeenCalled();
    expect(screen.queryByText("dock.unreadable")).toBeNull();
    fireEvent.click(screen.getByText("dock.save"));
    expect(callbacks.onSaveEdit).not.toHaveBeenCalled();
    expect(screen.getByText("dock.nothingWritten")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: `${template}Mara relights the lamp.` },
    });
    expect(screen.queryByText("dock.nothingWritten")).toBeNull();
    rerender(
      <ReferenceReader
        provider={provider}
        projectRef={REF}
        fileName="guidebook--logline.md"
        editing={{
          fileName: "guidebook--logline.md",
          savedText: template,
          draft: `${template}Mara relights the lamp.`,
          unborn: true,
        }}
        {...callbacks}
      />,
    );
    fireEvent.click(screen.getByText("dock.save"));
    await waitFor(() => expect(callbacks.onSaveEdit).toHaveBeenCalled());
  });

  it("asks before cancelling a dirty draft, and cancels when told to discard", () => {
    const callbacks = renderReader({
      provider: makeProvider("# Maren").provider,
      editing: session("changed"),
    });
    fireEvent.click(screen.getByText("confirm.cancel"));
    expect(callbacks.onCancelEdit).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("dock.discardEditTitle");
    fireEvent.click(screen.getByText("dock.discardEditConfirm"));
    expect(callbacks.onCancelEdit).toHaveBeenCalled();
  });

  it("cancels a clean draft without asking", () => {
    const callbacks = renderReader({
      provider: makeProvider("# Maren").provider,
      editing: session("# Maren"),
    });
    fireEvent.click(screen.getByText("confirm.cancel"));
    expect(callbacks.onCancelEdit).toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("applies the toolbar verbs to the selected text", () => {
    const callbacks = renderReader({
      provider: makeProvider("# Maren").provider,
      editing: session("# Maren"),
    });
    const area = screen.getByRole("textbox") as HTMLTextAreaElement;
    area.setSelectionRange(2, 7);
    fireEvent.click(screen.getByLabelText("toolbar.bold"));
    expect(callbacks.onDraft).toHaveBeenCalledWith("# **Maren**");
  });

  it("applies the toolbar verbs to a collapsed caret", () => {
    const callbacks = renderReader({
      provider: makeProvider("# Maren").provider,
      editing: session("# Maren"),
    });
    const area = screen.getByRole("textbox") as HTMLTextAreaElement;
    area.setSelectionRange(8, 8);
    fireEvent.click(screen.getByLabelText("dock.list"));
    expect(callbacks.onDraft).toHaveBeenCalledWith("- # Maren");
  });

  it("claims the shared shortcuts inside the textarea", () => {
    const callbacks = renderReader({
      provider: makeProvider("# Maren").provider,
      editing: session("# Maren"),
    });
    const area = screen.getByRole("textbox") as HTMLTextAreaElement;
    area.setSelectionRange(2, 7);
    fireEvent.keyDown(area, { key: "b", ctrlKey: true });
    expect(callbacks.onDraft).toHaveBeenCalledWith("# **Maren**");
  });

  it("saves on Ctrl+S and swallows the keystroke so the section editor never sees it", () => {
    const seenByWindow = vi.fn();
    window.addEventListener("keydown", seenByWindow);
    try {
      const callbacks = renderReader({
        provider: makeProvider("# Maren").provider,
        editing: session("# Maren"),
      });
      fireEvent.keyDown(screen.getByRole("textbox"), {
        key: "s",
        ctrlKey: true,
      });
      expect(callbacks.onSaveEdit).toHaveBeenCalled();
      expect(seenByWindow).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", seenByWindow);
    }
  });

  it("Escape behaves like the cancel button", () => {
    const callbacks = renderReader({
      provider: makeProvider("# Maren").provider,
      editing: session("changed"),
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(callbacks.onCancelEdit).not.toHaveBeenCalled();
  });
});
