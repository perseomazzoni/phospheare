// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import Avatar from "../../../ui/Avatar";
import Button from "../../../ui/Button";
import type {
  Entry,
  Searched as SearchedRecord,
  Thread,
} from "../domain/model";
import { slotted } from "../../components/slotted";
import type { ReplyState } from "../host/answers";
import { tagsIn } from "../domain/mentions";
import CommentComposer from "./CommentComposer";
import {
  faceOf,
  inkOn,
  type AuthorFace,
  type PersonaFace,
  type WriterFace,
} from "./faces";

// One thread in the margin. Folded, a card shows who opened the thread, the
// opening words, and how many answers follow. Open, it shows every entry and
// what can be done with the thread in its state:
//
//   a ghost comment (proposed)  keep · reply · dismiss
//   an open thread              reply · resolve · remove
//   a resolved thread           reopen · remove
//   an orphan (its passage is gone)  its original words, and re-attach
//
// Removing a thread a person wrote takes their words with it, so it asks
// once more; dismissing a ghost does not, because a ghost was never the
// writer's. Every body is plain text: React escapes it, and nothing here
// builds markup from a comment.

export interface ThreadActions {
  keep: () => void;
  remove: () => void;
  resolve: () => void;
  reopen: () => void;
  /** Settles when the file has taken the reply; refused, it rejects. */
  reply: (body: string) => Promise<unknown>;
  /** Present only while there is a selection to re-attach to. */
  reattach?: () => void;
}

export type { ReplyState };

/** An author's face: their picture, else their initial on their colour. */
export function Face({ face }: { face: AuthorFace }) {
  if (face.avatar)
    return <img className="cm-face" src={face.avatar} alt="" aria-hidden />;
  return (
    <span
      className="cm-face cm-face-letter"
      style={
        face.color
          ? { background: face.color, color: inkOn(face.color) }
          : undefined
      }
      aria-hidden
    >
      {face.name.slice(0, 1).toLocaleUpperCase()}
    </span>
  );
}

/**
 * A body with its persona tags in the link's colour, without an underline. A
 * tag is not a link and not a control (nothing happens on a press), so it has
 * no pointer either. Built from the text's own slices: React escapes each,
 * and no markup is made from the body.
 */
function Body({
  text,
  personas,
}: {
  text: string;
  personas: readonly PersonaFace[];
}) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const tag of tagsIn(text, personas)) {
    if (tag.start < at) continue;
    if (tag.start > at) parts.push(text.slice(at, tag.start));
    parts.push(
      <span key={tag.start} className="ui-mention">
        {text.slice(tag.start, tag.end)}
      </span>,
    );
    at = tag.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <p className="cm-body">{parts}</p>;
}

function when(at: string, language: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * A search behind a reply: the query in the writer's own quotes,
 * as a slot and never an interpolation, and the pages it found by title. A
 * link opens apart from the editor and tells the page nothing of it; the
 * codec has already refused any address that is not a web page.
 */
function Searched({ search }: { search: SearchedRecord }) {
  const { t } = useTranslation();
  return (
    <div className="cm-searched">
      <p>
        {slotted(t, `comments.searched.${search.engine}`, {
          query: (
            <q>
              <bdi>{search.query}</bdi>
            </q>
          ),
        })}
      </p>
      {search.links.length > 0 && (
        <ul>
          {search.links.map((link) => (
            <li key={link.url}>
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {link.title || new URL(link.url).host}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EntryView({
  entry,
  personas,
  writer,
}: {
  entry: Entry;
  personas: readonly PersonaFace[];
  writer?: WriterFace | null;
}) {
  const { t, i18n } = useTranslation();
  const face = faceOf(entry.author, personas, {
    you: t("comments.you"),
    unknown: t("comments.unknownAuthor"),
  });
  return (
    <div className="cm-entry">
      <div className="cm-byline">
        {/* The writer's own entries use the face the titlebar does: one
            face for one person, wherever the app draws them. */}
        {entry.author.kind === "writer" && writer ? (
          <Avatar name={writer.name} avatarUrl={writer.avatarUrl} />
        ) : (
          <Face face={face} />
        )}
        <span className="cm-name">{face.name}</span>
        <time className="cm-when" dateTime={entry.at}>
          {when(entry.at, i18n.language)}
        </time>
      </div>
      <Body text={entry.body} personas={personas} />
      {entry.searched?.map((one, index) => (
        <Searched key={index} search={one} />
      ))}
    </div>
  );
}

export default function ThreadCard({
  thread,
  personas,
  writer,
  orphan,
  active,
  onActivate,
  actions,
  reply,
}: {
  thread: Thread;
  personas: readonly PersonaFace[];
  /** The signed-in writer's face, for their own entries. */
  writer?: WriterFace | null;
  /** The passage it was about is not in the text. */
  orphan: boolean;
  active: boolean;
  onActivate: () => void;
  actions: ThreadActions;
  reply?: ReplyState;
}) {
  const { t } = useTranslation();
  const [replying, setReplying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [opening, ...answers] = thread.entries;
  const ghost = thread.state === "proposed";
  const resolved = thread.state === "resolved";
  const ownedByPerson = opening.author.kind !== "persona";

  return (
    <article
      className="cm-card"
      data-state={thread.state}
      data-active={active ? "1" : "0"}
      data-orphan={orphan ? "1" : "0"}
      aria-label={ghost ? t("comments.ghostLabel") : t("comments.threadLabel")}
      onClick={() => {
        if (!active) onActivate();
      }}
    >
      {ghost && <p className="cm-kicker">{t("comments.suggested")}</p>}
      {orphan && (
        <div className="cm-orphan">
          <p>{t("comments.orphan")}</p>
          {thread.anchor && <q>{thread.anchor.quote}</q>}
        </div>
      )}
      <EntryView entry={opening} personas={personas} writer={writer} />
      {active ? (
        answers.map((entry) => (
          <EntryView
            key={entry.id}
            entry={entry}
            personas={personas}
            writer={writer}
          />
        ))
      ) : answers.length > 0 ? (
        <p className="cm-more">
          {t("comments.answers", { count: answers.length })}
        </p>
      ) : null}

      {reply?.writing && (
        <p className="cm-writing" role="status">
          {reply.doing
            ? t("comments.doing", { name: reply.writing, doing: reply.doing })
            : t("comments.writing", { name: reply.writing })}
        </p>
      )}
      {reply?.asking && <div className="cm-asking">{reply.asking}</div>}
      {reply?.failed && (
        <p className="cm-failed" role="alert">
          {t("comments.replyFailed", { name: reply.failed.name })}{" "}
          <Button variant="link" onClick={reply.failed.retry}>
            {t("comments.retry")}
          </Button>
        </p>
      )}

      {active && (
        <div className="cm-actions" onClick={(e) => e.stopPropagation()}>
          {replying ? (
            <CommentComposer
              personas={personas}
              placeholder={t("comments.replyPlaceholder")}
              submitLabel={t("comments.send")}
              // Closed only once the reply is written: a refused one keeps
              // its words in the composer.
              onSubmit={(body) =>
                actions.reply(body).then(() => setReplying(false))
              }
              onCancel={() => setReplying(false)}
            />
          ) : confirming ? (
            <div className="cm-confirm" role="group">
              <span>{t("comments.removeConfirm")}</span>
              <Button variant="link" onClick={() => setConfirming(false)}>
                {t("comments.cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirming(false);
                  actions.remove();
                }}
              >
                {t("comments.remove")}
              </Button>
            </div>
          ) : (
            <div className="cm-buttons">
              {ghost && (
                <Button variant="soft" onClick={actions.keep}>
                  {t("comments.keep")}
                </Button>
              )}
              {!resolved && (
                <Button variant="quiet" onClick={() => setReplying(true)}>
                  {t("comments.reply")}
                </Button>
              )}
              {orphan && actions.reattach && (
                <Button variant="quiet" onClick={actions.reattach}>
                  {t("comments.reattach")}
                </Button>
              )}
              {!ghost && !resolved && (
                <Button variant="quiet" onClick={actions.resolve}>
                  {t("comments.resolve")}
                </Button>
              )}
              {resolved && (
                <Button variant="quiet" onClick={actions.reopen}>
                  {t("comments.reopen")}
                </Button>
              )}
              {ghost ? (
                <Button variant="link" onClick={actions.remove}>
                  {t("comments.dismiss")}
                </Button>
              ) : (
                <Button
                  variant="link"
                  onClick={() =>
                    ownedByPerson ? setConfirming(true) : actions.remove()
                  }
                >
                  {t("comments.remove")}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
