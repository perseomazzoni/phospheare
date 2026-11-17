// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { DocumentStructure } from "../../project/types";
import { trustedHtml } from "../../security/trustedHtml";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Dots, Icon, Tip } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import { MD_EXT, REFERENCE_DIR, SUMMARY_PREFIX } from "../../project/naming";
import {
  referenceDisplayTitle,
  referenceGroupOf,
  referenceTitle,
} from "../../project/reference";
import { asideRegex } from "../../project/asides";
import { formatShortcut, matchesShortcut } from "../views/shortcuts";
import {
  setHeading,
  toggleBold,
  toggleItalic,
  toggleList,
  type EditResult,
} from "./referenceEdit";
import { hasWriting } from "../../project/referenceAnswers";
import ConfirmDialog from "../components/ConfirmDialog";
import type { ProjectRef, StorageProvider } from "../../storage";
import { parseSummary } from "../../ai/adapters/summaryCodec";
import type { SummaryState } from "../../ai/domain/types";
import { markdown } from "../components/safeMarkdown";
import { useReferenceRevision } from "./referenceShared";
import { appLog, describeError } from "../../log";

// ── The reference reader and editor ──────────────────────────────────────────
//
// A reference document, rendered beside the prose and editable in place.
//
// No engine. A reference document is not a `Doc`: it must not enter the main
// editor's undo history, dirty flag or autosave path, so checking a detail in
// the character bible never puts the novel one Ctrl+Z away. Editing works on
// the raw Markdown, because the engine's model has no list block and its
// codec cannot round-trip arbitrary reference files byte for byte.
//
// The edit session lives in the shell, where the exits are: switching
// reference files, switching the Dock face and leaving the project must all
// ask about unsaved changes first. This component never owns the decision to
// keep or drop a draft.

/**
 * The reader renders through the shared hardened renderer
 * (`safeMarkdown.ts`): raw HTML off, images inert, links allow-listed, and
 * `linkify` off, because a bare URL in a note is a note, not a link.
 */
const md = markdown;

// Asides (`<!-- Hint: … -->` and the like) are guidance for the writer only,
// stripped before any document reaches a model (`project/asides.ts`); the
// reader shows them as quiet notes. The split render keeps `html: false`
// true: every fragment still goes through markdown-it, and only the app's own
// wrapper markup is HTML.
//
// An aside is drawn as written: no label is parsed out of it, so an aside
// that opens "Hint:" reads "Hint:".
function renderNote(note: string): string {
  return `<div class="tpl-note">${md.render(note)}</div>`;
}

/** Markdown with comment notes rendered as `.tpl-note` asides. */
function renderWithNotes(text: string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(asideRegex())) {
    const at = match.index ?? 0;
    out += md.render(text.slice(last, at));
    const note = match[1].trim();
    if (note) out += renderNote(note);
    last = at + match[0].length;
  }
  return out + md.render(text.slice(last));
}

export interface ReferenceEditSession {
  fileName: string;
  /** The file's text when editing began: the clean state to compare against. */
  savedText: string;
  draft: string;
  /**
   * Not on disk yet: a document a chat asked for, opened on its template
   * (`sectionDraft`). The first save that carries something the writer wrote
   * creates it; a save of the template alone writes nothing, and a cancel
   * leaves no file behind.
   */
  unborn?: boolean;
}

export interface ReferenceReaderProps {
  provider: StorageProvider;
  projectRef: ProjectRef | null;
  /** The file name inside `reference/`, or nothing when none is open. */
  fileName: string | null;
  /**
   * The empty-state line. The notes face names a note; the default names a
   * reference document, because the two faces keep their own selection and
   * arriving without one must say which face is empty.
   */
  emptyLabel?: string;
  /** The edit session, when the open file is being edited. */
  editing: ReferenceEditSession | null;
  onStartEdit: (fileName: string, text: string) => void;
  onDraft: (draft: string) => void;
  onCancelEdit: () => void;
  /** Write the draft and leave edit mode; `false` when the write failed. */
  onSaveEdit: () => Promise<boolean>;
  /**
   * How a generated summary stands against its source: the assistant's
   * `summaryStateFor`, which checks the source's current text and the
   * summary's own body hash. Not hashes off the live structure, whose copy is
   * never moved by a save, so a just-written summary would read Outdated.
   * Absent without an assistant, and then the badge reads Unverified.
   */
  judgeSummary?: (nodeId: string) => Promise<SummaryState>;
  /**
   * The live structure, so a summary is named by the Part or Section it
   * summarises rather than by its node id (`referenceDisplayTitle`).
   */
  structure?: DocumentStructure | null;
}

export default function ReferenceReader({
  provider,
  projectRef,
  fileName,
  emptyLabel,
  editing,
  onStartEdit,
  onDraft,
  onCancelEdit,
  onSaveEdit,
  judgeSummary,
  structure,
}: ReferenceReaderProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ text: string | null; failed: boolean }>({
    text: null,
    failed: false,
  });
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // A save refused because a document that is not on disk yet still says
  // nothing the writer wrote. Cleared by the next keystroke.
  const [nothingWritten, setNothingWritten] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [summaryStatus, setSummaryStatus] =
    useState<SummaryState>("unverified");

  // While this file is being edited, the source of truth is the session
  // above, not a fresh read, which would clobber the draft. When the session
  // clears (a save that landed, or a cancel), the read effect re-runs and
  // reloads the file, so read mode shows what is on disk.
  const editingThis = editing && editing.fileName === fileName ? editing : null;
  const generatedSummary = fileName?.startsWith(SUMMARY_PREFIX) ?? false;

  // Judged again whenever the file is read, on opening it or when a summary
  // is rewritten under it, so the badge describes the text on screen.
  useEffect(() => {
    if (
      !generatedSummary ||
      state.text === null ||
      !fileName ||
      !judgeSummary
    ) {
      setSummaryStatus("unverified");
      return;
    }
    let live = true;
    const nodeId = fileName.slice(SUMMARY_PREFIX.length, -MD_EXT.length);
    judgeSummary(nodeId).then(
      // "missing" is the assistant failing to read a summary that is on
      // screen (unparseable, or bound to another node): it cannot vouch.
      (next) => {
        if (live) setSummaryStatus(next === "missing" ? "unverified" : next);
      },
      () => {
        if (live) setSummaryStatus("unverified");
      },
    );
    return () => {
      live = false;
    };
  }, [generatedSummary, state.text, fileName, judgeSummary]);

  // Re-read on the folder's revision as well as on a new name: an updated
  // summary is rewritten in place, under the name the reader already has
  // open, and would otherwise go on showing the old text.
  const revision = useReferenceRevision();
  // Which file the text on screen belongs to. A different file starts blank;
  // the same file re-read because something in the folder changed keeps its
  // text until the new one lands, so a note saved elsewhere does not flash
  // the open document empty.
  const shownFile = useRef<string | null>(null);
  useEffect(() => {
    if (!fileName || !projectRef || editingThis) {
      shownFile.current = null;
      setState({ text: null, failed: false });
      return;
    }
    let live = true;
    if (shownFile.current !== fileName) setState({ text: null, failed: false });
    shownFile.current = fileName;
    void (async () => {
      try {
        const text = await provider.readFile(
          projectRef,
          `${REFERENCE_DIR}/${fileName}`,
        );
        if (live) setState({ text, failed: false });
      } catch (err) {
        appLog.warn("reference", "A reference document could not be read.", {
          group: referenceGroupOf(fileName) ?? "none",
          ...describeError(err),
        });
        if (live) setState({ text: null, failed: true });
      }
    })();
    return () => {
      live = false;
    };
  }, [provider, projectRef, fileName, editingThis, revision]);

  const html = useMemo(() => {
    if (state.text === null) return "";
    const visible = generatedSummary
      ? (parseSummary(state.text)?.body ?? state.text)
      : state.text;
    return renderWithNotes(visible);
  }, [state.text, generatedSummary]);

  // ── Editing ────────────────────────────────────────────────────────────────

  // The textarea's selection is applied after the draft's re-render, because
  // `selectionStart` cannot be set on a node whose value has not landed. The
  // ops return the selection to land in; this ref carries it across one
  // render, then the layout effect plants it and the textarea keeps focus.
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelRef = useRef<EditResult | null>(null);

  useLayoutEffect(() => {
    if (!pendingSelRef.current) return;
    const area = areaRef.current;
    if (area) {
      area.focus();
      area.setSelectionRange(
        pendingSelRef.current.start,
        pendingSelRef.current.end,
      );
    }
    pendingSelRef.current = null;
  }, [editing?.draft]);

  useEffect(() => {
    if (editingThis) {
      requestAnimationFrame(() => areaRef.current?.focus());
    }
  }, [editingThis]);

  const applyOp = useCallback(
    (op: (text: string, start: number, end: number) => EditResult) => {
      const area = areaRef.current;
      if (!area || !editingThis) return;
      const next = op(
        editingThis.draft,
        area.selectionStart,
        area.selectionEnd,
      );
      pendingSelRef.current = next;
      onDraft(next.text);
    },
    [editingThis, onDraft],
  );

  // The toolbar buttons must not steal the textarea's selection: mousedown
  // would blur it and collapse the caret to the button. `preventDefault` on
  // the press keeps the selection, and the op then reads it.
  const holdSelection = useCallback(
    (e: React.MouseEvent) => e.preventDefault(),
    [],
  );

  const doSave = useCallback(async () => {
    if (saving || !editingThis) return;
    if (editingThis.unborn && !hasWriting(editingThis.draft)) {
      setNothingWritten(true);
      return;
    }
    setSaving(true);
    setSaveFailed(false);
    const ok = await onSaveEdit();
    setSaving(false);
    if (!ok) setSaveFailed(true);
  }, [saving, editingThis, onSaveEdit]);

  const cancel = useCallback(() => {
    if (editingThis && editingThis.draft !== editingThis.savedText) {
      setConfirmCancel(true);
      return;
    }
    onCancelEdit();
  }, [editingThis, onCancelEdit]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const ev = e.nativeEvent;
      // Claim every binding this editor shares with the main one, so a
      // keystroke meant for the reference file never reaches the section's
      // editor: the shell's window listener is one bubble away.
      if (matchesShortcut("save", ev)) {
        e.preventDefault();
        e.stopPropagation();
        void doSave();
        return;
      }
      if (matchesShortcut("bold", ev)) {
        e.preventDefault();
        e.stopPropagation();
        applyOp(toggleBold);
        return;
      }
      if (matchesShortcut("italic", ev)) {
        e.preventDefault();
        e.stopPropagation();
        applyOp(toggleItalic);
        return;
      }
      if (matchesShortcut("setTitle", ev)) {
        e.preventDefault();
        e.stopPropagation();
        applyOp((text, s, e) => setHeading(text, s, e, 1));
        return;
      }
      if (matchesShortcut("setSubtitle", ev)) {
        e.preventDefault();
        e.stopPropagation();
        applyOp((text, s, e) => setHeading(text, s, e, 2));
        return;
      }
      if (matchesShortcut("setBody", ev)) {
        e.preventDefault();
        e.stopPropagation();
        applyOp((text, s, e) => setHeading(text, s, e, null));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancel();
        return;
      }
    },
    [doSave, applyOp, cancel],
  );

  if (!fileName) {
    return (
      <div className="dock-face dock-face-empty">
        <p>{emptyLabel ?? t("dock.pickReference")}</p>
      </div>
    );
  }

  // The meta line names the group and the title ("Characters · maren").
  const group = referenceGroupOf(fileName);
  const title = referenceDisplayTitle(fileName, t, structure);
  const metaLabel = group
    ? `${t(`reference.group.${group}`)} · ${title}`
    : title;

  // ── Edit mode ──────────────────────────────────────────────────────────────
  if (editingThis) {
    return (
      <div className="dock-face">
        <p className="dock-meta">{metaLabel}</p>

        <div
          className="dock-editbar"
          role="toolbar"
          aria-label={t("toolbar.formatting")}
        >
          <div className="dock-editbar-formats">
            <button
              type="button"
              aria-label={t("toolbar.bold")}
              onMouseDown={holdSelection}
              onClick={() => applyOp(toggleBold)}
            >
              <Icon name={appIcons.bold} size={14} />
              <Tip
                label={t("toolbar.bold")}
                shortcut={formatShortcut("bold")}
              />
            </button>
            <button
              type="button"
              aria-label={t("toolbar.italic")}
              onMouseDown={holdSelection}
              onClick={() => applyOp(toggleItalic)}
            >
              <Icon name={appIcons.italic} size={14} />
              <Tip
                label={t("toolbar.italic")}
                shortcut={formatShortcut("italic")}
              />
            </button>
            <span className="dock-editbar-sep" />
            <button
              type="button"
              aria-label={t("toolbar.title")}
              onMouseDown={holdSelection}
              onClick={() => applyOp((text, s, e) => setHeading(text, s, e, 1))}
            >
              <Icon name={appIcons.title} size={14} />
              <Tip
                label={t("toolbar.title")}
                shortcut={formatShortcut("setTitle")}
              />
            </button>
            <button
              type="button"
              aria-label={t("toolbar.subtitle")}
              onMouseDown={holdSelection}
              onClick={() => applyOp((text, s, e) => setHeading(text, s, e, 2))}
            >
              <Icon name={appIcons.subtitle} size={14} />
              <Tip
                label={t("toolbar.subtitle")}
                shortcut={formatShortcut("setSubtitle")}
              />
            </button>
            <button
              type="button"
              aria-label={t("toolbar.body")}
              onMouseDown={holdSelection}
              onClick={() =>
                applyOp((text, s, e) => setHeading(text, s, e, null))
              }
            >
              <Icon name={appIcons.body} size={14} />
              <Tip
                label={t("toolbar.body")}
                shortcut={formatShortcut("setBody")}
              />
            </button>
            <span className="dock-editbar-sep" />
            {/* No shortcut: the shared table belongs to the section editor,
                and a binding here would surface in its sheet, where lists do
                not exist. This one verb is toolbar-only. */}
            <button
              type="button"
              aria-label={t("dock.list")}
              onMouseDown={holdSelection}
              onClick={() => applyOp(toggleList)}
            >
              <Icon name={appIcons.list} size={14} />
              <Tip label={t("dock.list")} />
            </button>
          </div>

          <div className="dock-editbar-actions">
            <button type="button" className="dock-cancel" onClick={cancel}>
              {t("confirm.cancel")}
            </button>
            <button
              type="button"
              className="dock-save"
              onClick={() => void doSave()}
              disabled={saving}
            >
              {saving ? t("dock.saving") : t("dock.save")}
            </button>
          </div>
        </div>

        {saveFailed && (
          <p className="dock-problem dock-save-error">{t("dock.saveFailed")}</p>
        )}
        {nothingWritten && (
          <p className="dock-hint dock-save-error" role="status">
            {t("dock.nothingWritten")}
          </p>
        )}

        <textarea
          ref={areaRef}
          className="dock-edit"
          value={editingThis.draft}
          aria-label={t("dock.edit")}
          spellCheck={true}
          autoFocus
          onChange={(e) => {
            setNothingWritten(false);
            onDraft(e.target.value);
          }}
          onKeyDown={onKeyDown}
        />

        {confirmCancel && (
          <ConfirmDialog
            title={t("dock.discardEditTitle")}
            body={t("dock.discardEditBody", {
              title: referenceTitle(fileName),
            })}
            confirmLabel={t("dock.discardEditConfirm")}
            danger
            onConfirm={() => {
              setConfirmCancel(false);
              onCancelEdit();
            }}
            onCancel={() => setConfirmCancel(false)}
          />
        )}
      </div>
    );
  }

  // ── Read mode ──────────────────────────────────────────────────────────────
  const loaded = state.text;
  return (
    <div className="dock-face">
      <div className="dock-document-meta">
        <p className="dock-meta">{metaLabel}</p>
        {generatedSummary && (
          <span className={`dock-generated-badge is-${summaryStatus}`}>
            {t("dock.aiGenerated")} · {t(`dock.summaryState.${summaryStatus}`)}
          </span>
        )}
      </div>

      <div className="dock-scroll">
        {state.failed ? (
          <p className="dock-problem">{t("dock.unreadable")}</p>
        ) : loaded === null ? (
          <Dots label={t("tree.loading")} />
        ) : (
          <>
            {/* The one control that makes this document editable. Shown only
                once the text has loaded: editing a file that failed to read
                would overwrite it with whatever was on screen, possibly
                nothing. */}
            {!generatedSummary && (
              <button
                type="button"
                className="dock-edit-btn"
                onClick={() => onStartEdit(fileName, loaded)}
              >
                <Icon name={appIcons.edit} size={12} />
                {t("dock.edit")}
              </button>
            )}
            {/* The writer's own file, rendered by a parser with HTML off.
                eslint-disable-next-line react/no-danger */}
            <div
              className="dock-read"
              dangerouslySetInnerHTML={{ __html: trustedHtml(html) }}
            />
          </>
        )}
      </div>
    </div>
  );
}
