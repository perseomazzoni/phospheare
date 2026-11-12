// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AiChatsDialog from "./AiChatsDialog";
import type { ChatRecord } from "../../ai/domain/types";
import { __resetOverlays } from "../../ui/overlay/useOverlay";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

afterEach(() => {
  cleanup();
  __resetOverlays();
});

/**
 * The nth row's action, reached the way a writer reaches it: the row's one
 * `more` button, as a tree row's actions are, then the item in the kit menu it
 * opens.
 */
function row(action: string, nth = 0): HTMLElement {
  const more = screen.getAllByRole("button", {
    name: /^dock\.chatActions/,
  })[nth];
  if (!more) throw new Error(`no row actions at ${nth}`);
  fireEvent.click(more);
  return screen.getByRole("menuitem", { name: action });
}

function chat(over: Partial<ChatRecord> = {}): ChatRecord {
  return {
    schemaVersion: 1,
    id: "one",
    title: "Alpha chat",
    kind: "general",
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
    preferences: {
      personaId: "persona-fixture",
      model: { providerId: "ollama", modelId: "llama" },
      pinnedSourceIds: [],
    },
    turns: [],
    ...over,
  };
}

function mount(props: Partial<Parameters<typeof AiChatsDialog>[0]> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onSelect: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onRemoveUnreadable: vi.fn(),
  };
  const view = render(
    <AiChatsDialog
      open
      chats={[chat(), chat({ id: "two", title: "Beta chat" })]}
      activeChatId="one"
      unreadable={[]}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, view };
}

describe("AiChatsDialog", () => {
  // No foot and no Done: every action here lands the moment it is made, so
  // Done would only be a way out the scrim already offers.
  it("has no foot, and Escape is the way out without choosing", () => {
    const { onSelect, onClose } = mount();
    expect(document.querySelector(".ui-dialog-foot")).toBeNull();
    expect(screen.queryByText("confirm.done")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    mount({ open: false });
    expect(screen.queryByText("Alpha chat")).toBeNull();
  });

  it("marks the chat whose run waits on the writer, in place of its dots", () => {
    // The mark carries the state only, never the query, with a name a screen
    // reader hears.
    mount({ runningChatId: "two", waiting: true });
    const mark = screen.getByRole("img", { name: "dock.awaitingWriter" });
    expect(mark.classList.contains("ai-switcher-waiting")).toBe(true);
    expect(mark.closest("li, .ai-switcher-row")?.textContent).toContain(
      "Beta chat",
    );
    expect(screen.queryByLabelText("dock.working")).toBeNull();
    cleanup();
    mount({ runningChatId: "two" });
    expect(
      screen.queryByRole("img", { name: "dock.awaitingWriter" }),
    ).toBeNull();
  });

  it("closes on the way out of picking a chat", () => {
    // Picking is the one action here that changes what the panel behind
    // shows, so it does not leave a sheet over it.
    const { onSelect, onClose } = mount();
    fireEvent.click(screen.getByText("Beta chat"));
    expect(onSelect).toHaveBeenCalledWith("two");
    expect(onClose).toHaveBeenCalled();
  });

  it("names each chat's kind beside its time", () => {
    // A title is whatever the writer typed and need not say which chat is the
    // drafting partner and which the editorial sweep. The kind says it, on
    // the row's quiet line beside the time.
    mount({
      chats: [
        chat(),
        chat({ id: "two", title: "Beta chat", kind: "drafting" }),
        // A chat nobody has used or renamed yet is named after its own kind.
        chat({
          id: "three",
          title: "dock.chatKind.editorial",
          kind: "editorial",
        }),
      ],
    });
    const rows = [...document.querySelectorAll(".ai-switcher-open small")];
    expect(rows[0]?.textContent).toContain("dock.chatKind.general");
    expect(rows[1]?.textContent).toContain("dock.chatKind.drafting");
    // Beside the time, not instead of it.
    expect(rows[1]?.textContent).toMatch(/dock\.chatKind\.drafting\s·\s\S/);
    // Not twice: a title that already names the kind is not repeated
    // underneath.
    expect(rows[2]?.textContent).not.toContain("dock.chatKind.editorial");
    expect(rows[2]?.textContent).not.toContain("·");
  });

  it("marks which chat is open", () => {
    mount();
    const rows = [...document.querySelectorAll(".ai-switcher-row")];
    expect(rows[0]?.getAttribute("data-active")).toBe("true");
    expect(rows[1]?.hasAttribute("data-active")).toBe(false);
    // With the kit row's trailing tick and `aria-current`, not a green tint:
    // colour alone never carries the state.
    const open = [...document.querySelectorAll(".ai-switcher-open")];
    expect(open[0]?.getAttribute("aria-current")).toBe("true");
    expect(open[0]?.querySelector(".ui-row-tick svg")).not.toBeNull();
    expect(open[1]?.querySelector(".ui-row-tick svg")).toBeNull();
  });

  it("wears the kit, not a look of its own", () => {
    // The rows are the kit's rows and the one action is the kit's icon
    // button, so the dialog matches the rest of the application.
    mount();
    expect(document.querySelectorAll(".ai-switcher-open.ui-row")).toHaveLength(
      2,
    );
    expect(document.querySelector(".ai-icon-button")).toBeNull();
    const more = screen.getAllByRole("button", {
      name: /^dock\.chatActions/,
    });
    expect(more[0]?.classList.contains("ui-btn-icon")).toBe(true);
  });

  it("swaps the body to rename and comes back to the list", () => {
    // Renaming stays inside the dialog: it neither closes nor leaves a lone
    // form where the list was.
    const { onRename, onClose } = mount();
    fireEvent.click(row("dock.renameChat"));
    expect(screen.queryByText("Beta chat")).toBeNull();
    fireEvent.change(screen.getByLabelText("dock.chatTitle"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByText("dock.save"));
    expect(onRename).toHaveBeenCalledWith("one", "Renamed");
    expect(screen.getByText("Beta chat")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves the title alone when the rename is abandoned", () => {
    const { onRename } = mount();
    fireEvent.click(row("dock.renameChat"));
    fireEvent.change(screen.getByLabelText("dock.chatTitle"), {
      target: { value: "Never mind" },
    });
    fireEvent.click(screen.getByText("confirm.cancel"));
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText("Alpha chat")).toBeTruthy();
  });

  it("starts each rename from the title it is renaming", () => {
    // Not from the last one abandoned: a stale draft in the field is a rename
    // the writer did not ask for, one keystroke from being saved.
    mount();
    fireEvent.click(row("dock.renameChat"));
    fireEvent.click(screen.getByText("confirm.cancel"));
    fireEvent.click(row("dock.renameChat", 1));
    expect(
      (screen.getByLabelText("dock.chatTitle") as HTMLInputElement).value,
    ).toBe("Beta chat");
  });

  it("hands a delete up rather than doing it", () => {
    // The confirmation belongs to the panel, and it stacks over this dialog
    // instead of replacing it.
    const { onDelete, onClose } = mount();
    fireEvent.click(row("dock.deleteChat"));
    expect(onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: "one" }),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says so when there is nothing to list", () => {
    mount({ chats: [] });
    expect(screen.getByText("dock.noChats")).toBeTruthy();
  });

  it("closes itself when its last row goes, and not before", () => {
    // A dialog emptied by deleting the last chat has nothing left to do. One
    // opened empty stays, with its empty-state line.
    const { onClose, view, ...handlers } = mount();
    const again = (chats: ChatRecord[]) =>
      view.rerender(
        <AiChatsDialog
          open
          chats={chats}
          activeChatId="one"
          unreadable={[]}
          onClose={onClose}
          {...handlers}
        />,
      );
    again([chat()]);
    expect(onClose).not.toHaveBeenCalled();
    again([]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers to remove a chat file it could not read", () => {
    const { onRemoveUnreadable } = mount({
      unreadable: [{ file: "chat-broken.json", message: "bad json" }],
    });
    expect(screen.getByText("chat-broken.json")).toBeTruthy();
    fireEvent.click(screen.getByText("dock.removeUnreadable"));
    expect(onRemoveUnreadable).toHaveBeenCalledWith("chat-broken.json");
  });
});
