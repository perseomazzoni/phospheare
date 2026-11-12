// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { SummaryState } from "../../ai";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import { ShelfAddButton, ShelfHead, ShelfRow, ShelfVerb } from "../../ui";
import { ARC_PREFIX, referenceFileName } from "../../project/naming";
import {
  arcFileNameForCharacter,
  charactersWithArcs,
  groupReference,
  referenceDisplayTitle,
  referencePrefixOf,
  type ReferenceDoc,
  type ReferenceGroup,
  type ReferenceGroupId,
} from "../../project/reference";
import {
  isSectionGroup,
  type SectionGroupId,
} from "../../project/referenceSections";
import type { ProjectRef, StorageProvider } from "../../storage";
import type { DocumentStructure } from "../../project/types";
import { useReferenceFiles } from "./referenceShared";
import { deleteReference } from "./referenceDelete";
import { renameReference } from "./referenceRename";
import {
  arcTemplateFor,
  characterTemplateFor,
  substituteTitle,
} from "./referenceTemplates";
import { newDraft, sectionDraft } from "./referenceWrite";
import ReferenceReader, { type ReferenceEditSession } from "./ReferenceReader";
import ReferenceNameInput from "./ReferenceNameInput";
import SectionPicker from "../components/SectionPicker";
import ConfirmDialog from "../components/ConfirmDialog";
import AiBarToggle from "../assistant/AiBarToggle";
import {
  splitHeight,
  useSplitDrag,
  FACE_SPLIT_OPTIONS,
} from "../components/useSplitDrag";

// ── Reference panel ──────────────────────────────────────────────────────────
//
// The Dock's `reference` face: four cards over the divider, over the reader.
// The compiled spaces (guidebook, world) add a section through the picker;
// an arc is created from its character, never named on its own. A deleted
// document leaves the reader and the edit session through `onDeleted`.

// Row-major: Guidebook and Worldbuilding over Characters and Summaries. The
// grid aligns its items to the start (`editor.css`), so an expanded card
// never stretches the card beside it.
const CARD_ORDER: ReferenceGroupId[] = [
  "guidebook",
  "world",
  "characters",
  "summaries",
];

interface PendingDelete {
  fileName: string;
  /** The confirm dialog's title, already localized. */
  title: string;
  body: string;
  /** Files removed in the same confirm: a character's attached arc. */
  also?: string[];
  /**
   * Derived material, which is removed outright rather than binned.
   * It decides the confirm's word: everything the bin catches names where the
   * document goes, and only what goes nowhere says Delete.
   */
  derived?: boolean;
}

export interface ReferencePanelProps {
  provider: StorageProvider;
  projectRef: ProjectRef | null;
  structure: DocumentStructure | null;
  /**
   * The manuscript's own `document.language`, set at creation. It picks the
   * language of the reference templates; it is not the UI language.
   */
  language: string | null;
  reference: string | null;
  editing: ReferenceEditSession | null;
  onStartEdit: (fileName: string, text: string) => void;
  onDraft: (draft: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => Promise<boolean>;
  onOpen: (fileName: string) => void;
  /**
   * Opens a document straight into its editor, as every add control here
   * does; `unborn` when it is not on disk yet (`ReferenceReader`).
   */
  onWrite: (fileName: string, text: string, unborn: boolean) => void;
  /** A deleted document; the shell clears the open file and edit session. */
  onDeleted?: (fileName: string) => void;
  /**
   * The project's barred-from-the-assistant list, and the way to change it.
   * Absent, the row carries no toggle.
   */
  barredSourceIds?: readonly string[];
  onBarSource?: (sourceId: string, barred: boolean) => void;
  /**
   * The cards the shell keeps open. Controlled from above because the panel
   * unmounts when the Dock shows another face: a fold the writer left open
   * is still open on return, and a remount does not replay the fold
   * animation. Only a press on a card head or an add control moves it.
   *
   * The setter takes functional updates like React state, so the callbacks
   * here stay identity-stable: the auto-expand effect must not re-run, and
   * re-open the open document's card, every time the set changes, or a
   * collapse could never stick.
   */
  expandedCards: ReadonlySet<ReferenceGroupId>;
  onExpandedCardsChange: Dispatch<
    SetStateAction<ReadonlySet<ReferenceGroupId>>
  >;
  /** How a generated summary stands against its source (`ReferenceReader`). */
  judgeSummary?: (nodeId: string) => Promise<SummaryState>;
}

export default function ReferencePanel({
  provider,
  projectRef,
  structure,
  language,
  reference,
  editing,
  onStartEdit,
  onDraft,
  onCancelEdit,
  onSaveEdit,
  onOpen,
  onWrite,
  onDeleted,
  barredSourceIds,
  onBarSource,
  expandedCards,
  onExpandedCardsChange,
  judgeSummary,
}: ReferencePanelProps) {
  const { t } = useTranslation();
  const { files, reload } = useReferenceFiles(provider, projectRef);
  const [adding, setAdding] = useState<ReferenceGroupId | null>(null);
  /** The character whose name the writer is editing in place, if any. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameFailed, setRenameFailed] = useState(false);
  const [picking, setPicking] = useState<SectionGroupId | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PendingDelete | null>(
    null,
  );
  // The card whose last create failed. Held per group so the failure line
  // appears under the card the writer acted on.
  const [writeFailed, setWriteFailed] = useState<ReferenceGroupId | null>(null);
  // A delete the port refused. Panel-wide rather than per card: a confirm can
  // span two groups (a character and its arc), so there is no one card it
  // belongs under.
  const [deleteFailed, setDeleteFailed] = useState(false);
  const openCard = useCallback(
    (id: ReferenceGroupId) => {
      onExpandedCardsChange((prev) =>
        prev.has(id) ? prev : new Set(prev).add(id),
      );
    },
    [onExpandedCardsChange],
  );

  const toggleCard = useCallback(
    (id: ReferenceGroupId) => {
      onExpandedCardsChange((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      // Closing the card that owns the transient affordance takes it with the
      // card; another card's expansion leaves it alone. The failure line goes
      // with the field it belongs to.
      setAdding((now) => (now === id ? null : now));
      setPicking((now) => (now === id ? null : now));
      setWriteFailed((now) => (now === id ? null : now));
    },
    [onExpandedCardsChange],
  );

  const groups = useMemo(
    () => groupReference(files, structure),
    [files, structure],
  );
  const byId = useMemo(() => {
    const m = new Map<ReferenceGroupId, ReferenceGroup>();
    for (const g of groups) m.set(g.id, g);
    return m;
  }, [groups]);

  const characters = useMemo(() => charactersWithArcs(files), [files]);

  const taken = useMemo(
    () => new Set(files.map((f) => f.toLowerCase())),
    [files],
  );

  // Auto-expand the card that owns the open document. An arc belongs to its
  // character's card, where the writer sees it.
  useEffect(() => {
    if (!reference) return;
    if (reference.startsWith(ARC_PREFIX)) {
      openCard("characters");
      return;
    }
    const lower = reference.toLowerCase();
    for (const id of CARD_ORDER) {
      const g = byId.get(id);
      if (g?.docs.some((d) => d.fileName.toLowerCase() === lower)) {
        openCard(id);
        break;
      }
    }
  }, [reference, byId, openCard]);

  // A file being edited is not deletable: the delete would race the draft the
  // writer still holds. Cancel the edit and the control comes back.
  const canDelete = useCallback(
    (fileName: string) => editing?.fileName !== fileName,
    [editing],
  );
  // A character's rename and delete move its arc too, so they wait while the
  // arc is the edit session, written or not: the session would go on saving
  // under the old arc name, bound to no character.
  const canTouchCharacter = useCallback(
    (fileName: string) =>
      canDelete(fileName) && canDelete(arcFileNameForCharacter(fileName)),
    [canDelete],
  );

  // A catalogue section shows its localized label, every other file its
  // title.
  const sectionTitle = useCallback(
    (doc: ReferenceDoc) => referenceDisplayTitle(doc.fileName, t, structure),
    [t, structure],
  );

  // ── Creation ───────────────────────────────────────────────────────────────

  const commitSection = useCallback(
    async (group: SectionGroupId, id: string): Promise<boolean> => {
      // Opened, not written: a section another tab created meanwhile opens
      // on its own text, and a new one on its template (`sectionDraft`).
      const draft = await sectionDraft(
        provider,
        projectRef,
        { group, sectionId: id },
        language,
      );
      if (!draft) {
        // The listing is re-read even on failure: a failed probe, or a race
        // with another tab, would otherwise leave the picker offering a file
        // that exists, with no explanation.
        reload();
        setWriteFailed(group);
        return false;
      }
      setWriteFailed(null);
      setPicking(null);
      onWrite(draft.fileName, draft.text, draft.unborn);
      return true;
    },
    [provider, projectRef, reload, onWrite, language],
  );

  const commitCharacter = useCallback(
    async (title: string): Promise<boolean> => {
      const fileName = referenceFileName(
        referencePrefixOf("characters"),
        title,
      );
      const draft = await newDraft(
        provider,
        projectRef,
        fileName,
        substituteTitle(characterTemplateFor(language), title),
      );
      if (!draft) {
        reload();
        setWriteFailed("characters");
        return false;
      }
      setWriteFailed(null);
      setAdding(null);
      onWrite(draft.fileName, draft.text, draft.unborn);
      return true;
    },
    [provider, projectRef, reload, onWrite, language],
  );

  /**
   * Commit a character's new name. The document's title is its file name, so
   * this renames the file, and its arc with it, because the pair is bound by
   * the stem alone. The open reader follows: left pointing at the old name,
   * it would show a document that vanished.
   */
  const commitRename = useCallback(
    async (fileName: string, title: string): Promise<boolean> => {
      setRenameFailed(false);
      const next = await renameReference(provider, projectRef, fileName, title);
      if (next === null) {
        setRenameFailed(true);
        reload();
        return false;
      }
      setRenaming(null);
      reload();
      if (reference === fileName) onOpen(next);
      return true;
    },
    [provider, projectRef, reload, reference, onOpen],
  );

  const commitArc = useCallback(
    async (
      characterFileName: string,
      characterTitle: string,
    ): Promise<boolean> => {
      const fileName = arcFileNameForCharacter(characterFileName);
      const draft = await newDraft(
        provider,
        projectRef,
        fileName,
        substituteTitle(arcTemplateFor(language), characterTitle),
      );
      if (!draft) {
        reload();
        setWriteFailed("characters");
        return false;
      }
      setWriteFailed(null);
      onWrite(draft.fileName, draft.text, draft.unborn);
      return true;
    },
    [provider, projectRef, reload, onWrite, language],
  );

  // ── Deletion ───────────────────────────────────────────────────────────────

  const askDeleteSection = useCallback(
    (group: ReferenceGroupId, doc: ReferenceDoc) => {
      const name = sectionTitle(doc);
      // Summaries are not a compiled section group: no picker re-offers them,
      // so the Section's "It will be offered in the picker again" would be a
      // false promise on a destructive action.
      const isSummary = group === "summaries";
      setConfirmDelete({
        fileName: doc.fileName,
        title: isSummary
          ? t("reference.deleteSummaryTitle", { name })
          : t("reference.deleteSectionTitle", { name }),
        body: isSummary
          ? t("reference.deleteSummaryBody")
          : t("reference.deleteSectionBody"),
        derived: isSummary,
      });
    },
    [t, sectionTitle],
  );

  const doDelete = useCallback(async () => {
    const target = confirmDelete;
    if (!target || !projectRef) return;
    setConfirmDelete(null);
    setDeleteFailed(false);
    const names = [target.fileName, ...(target.also ?? [])];
    const removed: string[] = [];
    let failed = false;
    for (const name of names) {
      // The seam tells authored from derived (`referenceDelete.ts`).
      if (await deleteReference(provider, projectRef, name)) removed.push(name);
      // Keep the rest of the confirm going: a character's arc must not be
      // left behind because the sheet's own delete failed.
      else failed = true;
    }
    // A refused delete is said: on a project whose bytes commit over the
    // network, a swallowed failure leaves the row in place with nothing said.
    setDeleteFailed(failed);
    reload();
    for (const name of removed) onDeleted?.(name);
  }, [confirmDelete, provider, projectRef, reload, onDeleted]);

  // ── Split divider ──────────────────────────────────────────────────────────

  const { split, panelRef, beginSplitDrag, onSplitKeyDown } =
    useSplitDrag(FACE_SPLIT_OPTIONS);
  const topHeight = splitHeight(split);

  const barred = new Set(barredSourceIds ?? []);
  const renderBar = (fileName: string) =>
    onBarSource ? (
      <AiBarToggle
        sourceId={`reference:${fileName}`}
        barred={barred.has(`reference:${fileName}`)}
        onToggle={onBarSource}
      />
    ) : null;

  const renderSectionRow = (group: ReferenceGroupId, doc: ReferenceDoc) => (
    <ShelfRow
      key={doc.fileName}
      label={sectionTitle(doc)}
      hint={doc.fileName}
      open={reference === doc.fileName}
      onOpen={() => onOpen(doc.fileName)}
      verbs={
        <>
          {renderBar(doc.fileName)}
          {canDelete(doc.fileName) && (
            <ShelfVerb
              icon="delete"
              label={t("reference.delete")}
              onClick={() => askDeleteSection(group, doc)}
            />
          )}
        </>
      }
    />
  );

  return (
    <div className="dock-face ref-face" ref={panelRef}>
      <div className="ref-top" style={{ height: topHeight }}>
        <div className="ref-card-grid">
          {CARD_ORDER.map((id) => {
            const group = byId.get(id);
            const docs = group?.docs ?? [];
            const isExpanded = expandedCards.has(id);
            const isCharacters = id === "characters";
            const isSections = isSectionGroup(id);
            const label = t(`reference.group.${id}`);
            const isAdding = adding === id;
            const count = isCharacters ? characters.length : docs.length;
            return (
              <section
                key={id}
                className="ref-card"
                data-open={isExpanded ? "1" : "0"}
              >
                <ShelfHead
                  label={label}
                  count={count}
                  open={isExpanded}
                  onToggle={() => toggleCard(id)}
                />
                <div className="ref-card-body">
                  <div className="ref-card-inner">
                    {isCharacters
                      ? characters.map(({ character, arc }) => (
                          <div className="ref-char" key={character.fileName}>
                            {renaming === character.fileName &&
                            canTouchCharacter(character.fileName) ? (
                              <ReferenceNameInput
                                prefix={referencePrefixOf("characters")}
                                group={label}
                                // The document's own name is not a duplicate
                                // of itself: a rename that only changes case,
                                // or retypes the same words, is not refused.
                                taken={
                                  new Set(
                                    [...taken].filter(
                                      (name) =>
                                        name !==
                                        character.fileName.toLowerCase(),
                                    ),
                                  )
                                }
                                initial={character.title}
                                rowClassName="ref-name-row"
                                onCommit={(title) =>
                                  commitRename(character.fileName, title)
                                }
                                onCancel={() => {
                                  setRenameFailed(false);
                                  setRenaming(null);
                                }}
                              />
                            ) : (
                              <ShelfRow
                                label={character.title}
                                hint={character.fileName}
                                open={reference === character.fileName}
                                onOpen={() => onOpen(character.fileName)}
                                verbs={
                                  <>
                                    {renderBar(character.fileName)}
                                    {canTouchCharacter(character.fileName) && (
                                      <ShelfVerb
                                        icon="rename"
                                        label={t("reference.rename")}
                                        onClick={() => {
                                          setRenameFailed(false);
                                          setRenaming(character.fileName);
                                        }}
                                      />
                                    )}
                                    {canTouchCharacter(character.fileName) && (
                                      <ShelfVerb
                                        icon="delete"
                                        label={t("reference.delete")}
                                        onClick={() =>
                                          setConfirmDelete({
                                            fileName: character.fileName,
                                            title: t(
                                              "reference.deleteCharacterTitle",
                                              { name: character.title },
                                            ),
                                            body: arc
                                              ? t(
                                                  "reference.deleteCharacterArcBody",
                                                )
                                              : t(
                                                  "reference.deleteCharacterBody",
                                                ),
                                            also: arc
                                              ? [arc.fileName]
                                              : undefined,
                                          })
                                        }
                                      />
                                    )}
                                  </>
                                }
                              />
                            )}
                            {arc ? (
                              <ShelfRow
                                arc
                                label={t("reference.arc")}
                                hint={arc.fileName}
                                open={reference === arc.fileName}
                                onOpen={() => onOpen(arc.fileName)}
                                verbs={
                                  <>
                                    {renderBar(arc.fileName)}
                                    {canDelete(arc.fileName) && (
                                      <ShelfVerb
                                        icon="delete"
                                        label={t("reference.delete")}
                                        onClick={() =>
                                          setConfirmDelete({
                                            fileName: arc.fileName,
                                            title: t(
                                              "reference.deleteArcTitle",
                                              { name: character.title },
                                            ),
                                            body: t("reference.deleteArcBody"),
                                          })
                                        }
                                      />
                                    )}
                                  </>
                                }
                              />
                            ) : (
                              <ShelfAddButton
                                arc
                                untitled
                                label={t("reference.addArc")}
                                onClick={() =>
                                  void commitArc(
                                    character.fileName,
                                    character.title,
                                  )
                                }
                              />
                            )}
                          </div>
                        ))
                      : docs.map((doc) => renderSectionRow(id, doc))}

                    {isSections && (
                      <ShelfAddButton
                        label={t("reference.addSection")}
                        onClick={(e) => {
                          e.stopPropagation();
                          openCard(id);
                          setAdding(null);
                          setWriteFailed(null);
                          setPicking(id);
                        }}
                      />
                    )}

                    {isCharacters && !isAdding && (
                      <ShelfAddButton
                        label={t("reference.addCharacter")}
                        onClick={(e) => {
                          e.stopPropagation();
                          openCard(id);
                          setPicking(null);
                          setWriteFailed(null);
                          setAdding(id);
                        }}
                      />
                    )}
                    {isCharacters && isAdding && (
                      <ReferenceNameInput
                        prefix={referencePrefixOf(id)}
                        group={label}
                        taken={taken}
                        rowClassName="ref-name-row"
                        onCommit={commitCharacter}
                        onCancel={() => {
                          // Dismissing the field dismisses its failure with it.
                          setWriteFailed(null);
                          setAdding(null);
                        }}
                      />
                    )}

                    {docs.length === 0 && !isSections && !isCharacters && (
                      <span className="ref-card-empty">
                        {t("reference.emptyGroup")}
                      </span>
                    )}
                    {isCharacters && characters.length === 0 && (
                      <span className="ref-card-empty">
                        {t("reference.emptyGroup")}
                      </span>
                    )}
                    {/* A creation that did not land says so, under the card
                        the writer acted on, and the field or picker above it
                        stays open for the retry. */}
                    {writeFailed === id && (
                      <p className="ref-write-error" role="alert">
                        {t("reference.createFailed")}
                      </p>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
        {deleteFailed && (
          <p className="ref-write-error" role="alert">
            {t("reference.deleteFailed")}
          </p>
        )}
        {/* A rename the port refused: a name already taken, or a write that
            did not land. Said once, beside the delete's failure, because the
            field stays open above it for the retry. */}
        {renameFailed && (
          <p className="ref-write-error" role="alert">
            {t("reference.renameFailed")}
          </p>
        )}
      </div>

      <div
        className="snap-divider ref-divider"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("dock.resize")}
        tabIndex={0}
        onPointerDown={beginSplitDrag}
        onKeyDown={onSplitKeyDown}
      />

      <div className="ref-bottom">
        {picking ? (
          <SectionPicker
            group={picking}
            fileNames={files}
            onPick={(id) => void commitSection(picking, id)}
            onClose={() => {
              // Dismissing the picker dismisses its failure with it.
              setWriteFailed(null);
              setPicking(null);
            }}
          />
        ) : (
          <ReferenceReader
            provider={provider}
            projectRef={projectRef}
            fileName={reference}
            editing={editing}
            onStartEdit={onStartEdit}
            onDraft={onDraft}
            onCancelEdit={onCancelEdit}
            onSaveEdit={onSaveEdit}
            judgeSummary={judgeSummary}
            structure={structure}
          />
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={confirmDelete.title}
          body={confirmDelete.body}
          confirmLabel={
            confirmDelete.derived ? t("reference.delete") : t("bin.moveTo")
          }
          danger
          onConfirm={() => void doDelete()}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
