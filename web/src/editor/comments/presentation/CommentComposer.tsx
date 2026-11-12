// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../../ui/Button";
import { ENTRY_BODY_MAX } from "../domain/limits";
import type { PersonaFace } from "./faces";

// Writing a comment, always as plain text. Enter is a new line, because a
// comment is often two sentences and a stray key must not send half of one;
// Ctrl+Enter (⌘+Enter) sends, and Escape lets go. Typing `@` offers the
// personas: the one picked is written into the text as `@Name`, read as any
// typed tag is (`mentions.ts`).

export default function CommentComposer({
  personas,
  placeholder,
  submitLabel,
  autoFocus = true,
  onSubmit,
  onCancel,
}: {
  personas: readonly PersonaFace[];
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => Promise<unknown> | undefined | void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const listId = useId();

  // The word being typed right before the caret, when it starts with `@`.
  const query = useMemo(() => {
    const before = text.slice(0, caret);
    const match = /(^|\s)@([\p{L}\p{N}_]*)$/u.exec(before);
    return match ? match[2] : null;
  }, [text, caret]);
  const offered = useMemo(
    () =>
      query === null
        ? []
        : personas.filter((p) =>
            p.name.toLocaleLowerCase().startsWith(query.toLocaleLowerCase()),
          ),
    [personas, query],
  );

  const pick = (persona: PersonaFace) => {
    const before = text.slice(0, caret).replace(/@[\p{L}\p{N}_]*$/u, "");
    const next = `${before}@${persona.name} ${text.slice(caret)}`;
    const at = before.length + persona.name.length + 2;
    setText(next);
    setCaret(at);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(at, at);
    });
  };

  // A submit that writes hands back its promise: the words stay until it
  // lands, and stay put when it is refused, so nothing typed is lost.
  const send = () => {
    const body = text.trim();
    if (!body || sending) return;
    const done = onSubmit(body);
    if (!done) return setText("");
    setSending(true);
    done
      .then(
        () => setText(""),
        () => undefined,
      )
      .finally(() => setSending(false));
  };

  return (
    <div className="cm-composer">
      <textarea
        ref={area}
        className="cm-input"
        value={text}
        rows={2}
        maxLength={ENTRY_BODY_MAX}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={offered.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart);
          setPicked(0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (offered.length > 0) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setPicked((i) => (i + step + offered.length) % offered.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(offered[Math.min(picked, offered.length - 1)]);
              return;
            }
          }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            send();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      {offered.length > 0 && (
        <ul className="cm-mentions" id={listId} role="listbox">
          {offered.map((persona, i) => (
            <li
              key={persona.id}
              role="option"
              aria-selected={i === picked}
              onPointerDown={(e) => {
                e.preventDefault();
                pick(persona);
              }}
            >
              <span
                className="cm-dot"
                style={{ background: persona.color }}
                aria-hidden
              />
              {persona.name}
            </li>
          ))}
        </ul>
      )}
      <div className="cm-composer-actions">
        <Button variant="link" onClick={onCancel}>
          {t("comments.cancel")}
        </Button>
        <Button
          variant="soft"
          disabled={!text.trim() || sending}
          onClick={send}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
