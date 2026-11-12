// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dots,
  Icon,
  Input,
  Menu,
  Scrim,
  useMenuAnchor,
} from "../../ui";
import { useTimeWords } from "../../ui/useTimeWords";
import { appIcons } from "../../ui/appIcons";
import type { ChatRecord } from "../../ai/domain/types";
import type { UnreadableChat } from "../../ai/ports";
import { chatTitleShown } from "./chatTitleShown";

// Every chat, in a dialog over the conversation rather than a block that
// pushes it down: a set the writer reads and acts on, with three actions per
// row and no length bound, is a dialog, not a `Menu`.
//
// Renaming swaps the dialog's body, so the writer keeps their place and lands
// back on the same row. Deleting asks the panel, whose `ConfirmDialog` stacks
// over this one; the row that opened the confirm still exists when it
// closes, so the overlay's own focus restore is correct.
//
// There is no foot: every action lands when made, and the scrim is the way
// out.

export interface AiChatsDialogProps {
  open: boolean;
  onClose: () => void;
  chats: readonly ChatRecord[];
  activeChatId: string | null;
  /** The chat with a run in flight, marked in its row. */
  runningChatId?: string | null;
  /**
   * Whether that run waits on the writer for a web search: its row's
   * dots give way to the waiting mark. State only; the query never reaches
   * this list.
   */
  waiting?: boolean;
  /** Chat files on disk that could not be parsed. */
  unreadable: readonly UnreadableChat[];
  onSelect: (chatId: string) => void;
  onRename: (chatId: string, title: string) => void;
  /** Hands the chat back so the panel can raise its confirmation over this. */
  onDelete: (chat: ChatRecord) => void;
  onRemoveUnreadable: (file: string) => void;
}

export default function AiChatsDialog({
  open,
  onClose,
  chats,
  activeChatId,
  runningChatId,
  waiting = false,
  unreadable,
  onSelect,
  onRename,
  onDelete,
  onRemoveUnreadable,
}: AiChatsDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  // The chat being renamed, and the text so far. Null is the list.
  const [renaming, setRenaming] = useState<ChatRecord | null>(null);
  const [draft, setDraft] = useState("");
  // A list emptied while open closes itself, since a dialog saying only "no
  // chats" leaves nothing to do but dismiss it. A list opened empty still
  // says so, because the writer asked to look.
  const listed = chats.length + unreadable.length;
  const wasListed = useRef(listed);
  useEffect(() => {
    const before = wasListed.current;
    wasListed.current = listed;
    if (open && before > 0 && listed === 0) onClose();
  }, [open, listed, onClose]);
  if (!open) return null;

  const stopRenaming = () => {
    setRenaming(null);
    setDraft("");
  };

  return (
    <Scrim
      open
      dismissible
      onClose={onClose}
      labelledBy={titleId}
      className="ui-dialog ai-chats-dialog"
    >
      <header className="ui-dialog-head">
        <h2 id={titleId} className="ui-dialog-title">
          {t("dock.chats")}
        </h2>
      </header>

      <div className="ui-dialog-body">
        {renaming ? (
          <form
            className="ai-rename"
            onSubmit={(event) => {
              event.preventDefault();
              onRename(renaming.id, draft);
              stopRenaming();
            }}
          >
            <Input
              autoFocus
              maxLength={120}
              value={draft}
              label={t("dock.chatTitle")}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="ai-rename-actions">
              <Button variant="quiet" onClick={stopRenaming}>
                {t("confirm.cancel")}
              </Button>
              <Button variant="primary" type="submit">
                {t("dock.save")}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className="ai-switcher-list ui-scroll">
              {chats.map((chat) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  active={chat.id === activeChatId}
                  running={runningChatId === chat.id}
                  waiting={waiting && runningChatId === chat.id}
                  onOpen={() => {
                    onSelect(chat.id);
                    onClose();
                  }}
                  onRename={() => {
                    setDraft(chatTitleShown(t, chat));
                    setRenaming(chat);
                  }}
                  onDelete={() => onDelete(chat)}
                />
              ))}
              {chats.length === 0 ? (
                <p className="dock-hint">{t("dock.noChats")}</p>
              ) : null}
            </div>
            {unreadable.length > 0 ? (
              <div className="ai-unreadable">
                {unreadable.map((file) => (
                  <div key={file.file} className="ai-unreadable-row">
                    <span className="ui-row-text">{file.file}</span>
                    <Button
                      variant="link"
                      onClick={() => onRemoveUnreadable(file.file)}
                    >
                      {t("dock.removeUnreadable")}
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </Scrim>
  );
}

/**
 * One chat: the kit's row to open it, and one `more` button to its actions.
 *
 * Its own component because each row owns a menu anchor, and hooks cannot
 * live in a `map`.
 */
function ChatRow({
  chat,
  active,
  running,
  waiting,
  onOpen,
  onRename,
  onDelete,
}: {
  chat: ChatRecord;
  active: boolean;
  running: boolean;
  waiting: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { relative } = useTimeWords();
  const menu = useMenuAnchor();
  const title = chatTitleShown(t, chat);
  const actionsLabel = t("dock.chatActions", { title });
  return (
    <div className="ai-switcher-row" data-active={active || undefined}>
      <button
        type="button"
        className="ui-row ai-switcher-open"
        aria-current={active || undefined}
        onClick={onOpen}
      >
        <span className="ui-row-text">{title}</span>
        {/* The chat's kind beside the time, because a typed title does not
            say which kind a chat is. Omitted when the title shown
            (`chatTitleShown`) is already the translated kind, so an unnamed
            chat reads its kind once in any language. */}
        <small className="ui-row-note">
          {title === t(`dock.chatKind.${chat.kind}`)
            ? relative(chat.updatedAt)
            : `${t(`dock.chatKind.${chat.kind}`)} · ${relative(chat.updatedAt)}`}
        </small>
        {waiting ? (
          // The attention ink, with a name a screen reader hears: the row
          // leads to a question only the writer can answer.
          <span
            className="ai-switcher-waiting"
            role="img"
            aria-label={t("dock.awaitingWriter")}
            title={t("dock.awaitingWriter")}
          >
            <Icon name={appIcons.pending} size={11} />
          </span>
        ) : running ? (
          <Dots label={t("dock.working")} />
        ) : null}
        {/* The open chat's mark: the tick the model menu uses for the model
            in use, in a seat held whether or not it is filled. */}
        <span className="ui-row-tick" aria-hidden="true">
          {active ? <Icon name={appIcons.confirm} size={11} /> : null}
        </span>
      </button>
      <Button
        variant="icon"
        className="ai-switcher-more"
        aria-label={actionsLabel}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={(event) => menu.toggle(event.currentTarget)}
      >
        <Icon name={appIcons.menu} size={15} />
      </Button>
      <Menu
        open={menu.open}
        onClose={menu.close}
        anchor={menu.anchor}
        label={actionsLabel}
        items={[
          { id: "rename", label: t("dock.renameChat"), onSelect: onRename },
          {
            id: "delete",
            label: t("dock.deleteChat"),
            danger: true,
            onSelect: onDelete,
          },
        ]}
      />
    </div>
  );
}
