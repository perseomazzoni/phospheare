// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { useMenuAnchor } from "../../ui";
import { Icon } from "../../ui";
import { useTranslation } from "react-i18next";
import { appIcons } from "../../ui/appIcons";
import type {
  ChatRecord,
  PersonaDefinition,
  PersonaPreset,
} from "../../ai/domain/types";
import { chatTitleShown } from "./chatTitleShown";

/**
 * The Ask face's head: whose voice, which conversation, and the button for
 * a new one. The three facts that identify a chat rather than steer one.
 */
export default function AiChatHead({
  active,
  persona,
  focus,
  askElsewhere,
  chatsOpen,
  newChatMenu,
  onPersona,
  onChats,
}: {
  active: ChatRecord | null;
  /** The chat's voice, or `undefined` when none resolves. */
  persona: PersonaDefinition | undefined;
  /** The voice's focus in this room: what it offers, and which is in force. */
  focus: {
    offered: readonly PersonaPreset[];
    current: PersonaPreset | undefined;
  };
  /** Whether a search waits on the writer in another chat. */
  askElsewhere: boolean;
  chatsOpen: boolean;
  newChatMenu: ReturnType<typeof useMenuAnchor>;
  onPersona: () => void;
  onChats: () => void;
}) {
  const { t } = useTranslation();
  const selectedPersona = persona;
  return (
    <div className="ai-chathead">
      {/* The name is the label: "Persona: <name>" would spend width on a
          word the writer infers. The accessible name carries "Persona", so
          the button is still named where the drawing is not. Gated on a chat,
          because a persona is a property of one and its dialog writes to
          one. */}
      {active ? (
        <button
          type="button"
          className="ai-persona"
          aria-haspopup="dialog"
          aria-label={t("dock.persona")}
          // The focus in force rides the tooltip, which a screen reader
          // also reads as the button's description, rather than the drawing:
          // at a 340px dock "Nova · Dialogue" beside the chat picker cuts
          // both short. The name stays "Persona", the button's one
          // stable handle, and the dialog shows the focus in full.
          title={
            focus.offered.length > 1 && focus.current
              ? t(`dock.preset.${focus.current.id}.name`)
              : undefined
          }
          onClick={onPersona}
        >
          {/* The voice's own face, which says which voice speaks. The
              assistant mark shows only when no persona resolves
              (`dock.noPersona`).

              `alt=""` and nothing else: an empty alt already takes an image
              out of the accessibility tree, and `aria-hidden` on top would
              be two mechanisms for one fact. The dimensions are attributes
              so the chip does not reflow after the image decodes, and the
              face is not draggable out of a button. */}
          {selectedPersona ? (
            <img
              className="ai-face"
              src={selectedPersona.avatar}
              alt=""
              width={18}
              height={18}
              draggable={false}
            />
          ) : (
            <Icon name={appIcons.assistant} size={11} />
          )}
          <span>{selectedPersona?.name ?? t("dock.noPersona")}</span>
          {/* The chat title's mark: two buttons side by side with only one
              marked would read as a label beside a control. */}
          <Icon name={appIcons.expand} size={10} />
        </button>
      ) : null}
      {/* The one label in this panel. The title is whatever the writer
          named the chat, and a title alone on a bar reads as the page's
          heading rather than a button that opens the list of chats.
          `aria-hidden`, because the button's accessible name already says
          "Chats". */}
      <span className="ai-chathead-label" aria-hidden="true">
        {t("dock.chatLabel")}
      </span>
      <button
        type="button"
        // Ember while a search waits in another chat: the one route
        // on this face to the chat that holds it. The accessible name says
        // another chat, because the title shown is this one's.
        className={
          askElsewhere ? "ai-chat-title is-attention" : "ai-chat-title"
        }
        aria-label={t(askElsewhere ? "dock.chatsWaiting" : "dock.chats")}
        aria-haspopup="dialog"
        aria-expanded={chatsOpen}
        onClick={onChats}
      >
        <span className="ai-chat-title-text">
          {active ? chatTitleShown(t, active) : t("dock.noChats")}
        </span>
        {/* The mark that says this is a button, not a caption; a bare word
            reads as a heading. */}
        <Icon name={appIcons.expand} size={12} />
      </button>
      {/* Named, not a bare `+`, in the dock's add-pill.

          At the end of the line rather than beside the field: starting a
          conversation is not part of asking in this one, and a `+` near
          the send key is a mis-press that costs a half-typed question. */}
      <button
        type="button"
        className="snap-add ai-new-chat"
        aria-haspopup="menu"
        aria-expanded={newChatMenu.open}
        onClick={(event) => newChatMenu.toggle(event.currentTarget)}
      >
        <Icon name={appIcons.add} size={11} />
        <span>{t("dock.newChatAdd")}</span>
      </button>
    </div>
  );
}
