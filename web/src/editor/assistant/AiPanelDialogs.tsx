// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Menu, useMenuAnchor, type MenuItem } from "../../ui";
import type { Assistant } from "../../ai";
import type { AssistantSnapshot } from "../../ai/application/assistantTypes";
import { CHAT_KINDS } from "../../ai/domain/types";
import type { ChatRecord } from "../../ai/domain/types";
import ConfirmDialog from "../components/ConfirmDialog";
import AiChatsDialog from "./AiChatsDialog";
import AiContextDialog from "./AiContextDialog";
import AiPersonaDialog from "./AiPersonaDialog";
import type { PersonaChoice } from "./usePersonaChoice";

/**
 * Every surface the panel opens over itself: the context and persona
 * dialogs, the list of chats, the delete confirmation and the new-chat menu.
 */
export function usePanelDialogs() {
  const [contextOpen, setContextOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<ChatRecord | null>(
    null,
  );
  const newChatMenu = useMenuAnchor();
  return {
    contextOpen,
    personaOpen,
    chatsOpen,
    confirmingDelete,
    newChatMenu,
    openContext: () => setContextOpen(true),
    closeContext: () => setContextOpen(false),
    openPersona: () => setPersonaOpen(true),
    closePersona: () => setPersonaOpen(false),
    openChats: () => setChatsOpen(true),
    closeChats: () => setChatsOpen(false),
    setConfirmingDelete,
  };
}

export type PanelDialogs = ReturnType<typeof usePanelDialogs>;

/** The surfaces `usePanelDialogs` opens, drawn with the panel's state. */
export default function AiPanelDialogs({
  dialogs,
  assistant,
  active,
  snapshot,
  waiting,
  persona,
}: {
  dialogs: PanelDialogs;
  assistant: Assistant;
  active: ChatRecord | null;
  snapshot: Pick<
    AssistantSnapshot,
    "chats" | "activeChatId" | "runningChatId" | "unreadable"
  >;
  /** A search waits on the writer. */
  waiting: boolean;
  persona: PersonaChoice;
}) {
  const { t } = useTranslation();
  const { confirmingDelete, setConfirmingDelete, newChatMenu } = dialogs;
  // Editorial review is absent from a non-editorial chat, not present and
  // greyed. A chat's kind is fixed at creation, so the row is not disabled
  // for now but absent for good, and a permanently dead row misdescribes the
  // surface.
  const chatKinds: MenuItem[] = CHAT_KINDS.map((kind) => ({
    id: kind,
    label: t(`dock.chatKind.${kind}`),
    onSelect: () => void assistant.chats.create(kind),
  }));
  return (
    <>
      {active ? (
        <>
          <AiContextDialog
            open={dialogs.contextOpen}
            onClose={dialogs.closeContext}
            assistant={assistant}
            chat={active}
          />

          <AiPersonaDialog
            open={dialogs.personaOpen}
            onClose={dialogs.closePersona}
            personas={persona.pickerPersonas}
            unavailable={persona.unavailablePersonas}
            selectedId={active.preferences.personaId}
            onSelect={persona.selectPersona}
            presets={persona.focus.offered}
            selectedPresetId={persona.focus.current?.id}
            onSelectPreset={persona.selectPreset}
          />
        </>
      ) : null}

      <Menu
        open={newChatMenu.open}
        onClose={newChatMenu.close}
        anchor={newChatMenu.anchor}
        label={t("dock.newChat")}
        items={chatKinds}
      />

      {/* Outside the active branch: the list of chats is what a writer with
          no chat open needs to reach. */}
      <AiChatsDialog
        open={dialogs.chatsOpen}
        onClose={dialogs.closeChats}
        chats={snapshot.chats}
        activeChatId={snapshot.activeChatId}
        runningChatId={snapshot.runningChatId}
        waiting={waiting}
        unreadable={snapshot.unreadable}
        onSelect={(chatId) => assistant.selectChat(chatId)}
        onRename={(chatId, title) => void assistant.chats.rename(chatId, title)}
        onDelete={(chat) => setConfirmingDelete(chat)}
        onRemoveUnreadable={(file) => void assistant.deleteChatFile(file)}
      />

      {confirmingDelete ? (
        <ConfirmDialog
          title={t("dock.deleteChatTitle")}
          body={t("dock.deleteChatBody", {
            title: confirmingDelete.title,
          })}
          confirmLabel={t("dock.deleteChatConfirm")}
          danger
          onConfirm={() => {
            const chat = confirmingDelete;
            setConfirmingDelete(null);
            void assistant.deleteChat(chat.id);
          }}
          onCancel={() => {
            setConfirmingDelete(null);
          }}
        />
      ) : null}
    </>
  );
}
