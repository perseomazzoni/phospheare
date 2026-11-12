// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useMemo, useRef } from "react";
import { getI18n } from "react-i18next";
import { Assistant, type Evidence } from "../../ai";
import type {
  DocNode,
  DocumentProperties,
  DocumentStructure,
} from "../../project/types";
import type { ProjectRef, StorageProvider } from "../../storage";
import type { BarredSources } from "../assistant/barredSources";
import { commentsPort } from "../assistant/commentsAdapter";
import {
  createEvidenceOpener,
  type EvidenceTargets,
} from "../assistant/evidenceOpener";
import { ProjectAiAdapter } from "../assistant/projectAdapter";
import { projectFactsOf } from "../assistant/projectFacts";
import type { CommentsService } from "../comments/application/comments";
import { referenceFolderChanged } from "../reference/referenceShared";
import type { ProjectActions } from "../ProjectContext";
import { evidenceOrdinal, evidencePassage } from "../searchArrival";
import type { EditorServices } from "../services/port";
import { useDeferredDispose } from "../useDeferredDispose";
import type { EditorEngine } from "../views/engine";

// This is the AI composition root. The editor exposes narrow project ports;
// prompts, retrieval, tool dispatch and persistence remain inside `src/ai`.
// Everything the Assistant reads per call goes through `aiState`, so a
// properties write never rebuilds it.

/** The open node, as the assistant takes it for its default scope. */
export interface ActiveNode {
  id: string;
  title: string;
  kind: DocNode["kind"];
}

export interface EditorAssistantOptions {
  engine: EditorEngine;
  provider: StorageProvider;
  projectRef: ProjectRef | null;
  structure: DocumentStructure | null;
  props: DocumentProperties | null;
  activeFile: string | null;
  activeNode: ActiveNode | null;
  openFile: ProjectActions["openFile"];
  bindSummary: ProjectActions["bindSummary"];
  /** The margin's service, which the assistant reads through its own port. */
  comments: CommentsService | null;
  /** The writer's barred sources, which gate every source the assistant sees. */
  barredSources: BarredSources | null;
  services: Pick<EditorServices, "useAssistantWiring">;
}

export function useEditorAssistant({
  engine,
  provider,
  projectRef: ref,
  structure,
  props,
  activeFile,
  activeNode,
  openFile,
  bindSummary,
  comments,
  barredSources,
  services,
}: EditorAssistantOptions) {
  const aiState = useRef({
    structure,
    props,
    activeFile,
    activeNode,
  });
  aiState.current = {
    structure,
    props,
    activeFile,
    activeNode,
  };
  const aiReady = Boolean(ref && structure && props);

  // The book's language for a search, read per call (`aiState`).
  const languageCode = useCallback(
    () => projectFactsOf(aiState.current.props)?.languageCode,
    [],
  );
  const wiring = services.useAssistantWiring(languageCode);

  const projectAdapter = useMemo(() => {
    if (!ref || !aiReady || !barredSources) return null;
    return new ProjectAiAdapter({
      storage: provider,
      ref,
      structure: () => {
        if (!aiState.current.structure)
          throw new Error("project-structure-unavailable");
        return aiState.current.structure;
      },
      properties: () => {
        if (!aiState.current.props)
          throw new Error("project-properties-unavailable");
        return aiState.current.props;
      },
      barred: () => barredSources.current(),
      activeFile: () => aiState.current.activeFile,
      liveText: () => engine.commonmark,
      // `bindSummary` has no deleting twin. The two places that delete a
      // summary, the writer's row action and a node's removal, reach
      // `clearSummary` themselves, and the assistant writes and reads
      // summaries but never deletes one.
      bindSummary,
      referenceChanged: referenceFolderChanged,
    });
  }, [provider, ref, aiReady, engine, bindSummary, barredSources]);

  // Evidence navigation: the workspace registers the two entry points it
  // owns, and the navigation lives in `assistant/evidenceDoor.ts`.
  const evidenceTargets = useRef<EvidenceTargets | null>(null);
  const evidence = useMemo<Evidence>(
    () =>
      createEvidenceOpener({
        list: async () => (projectAdapter ? projectAdapter.list() : []),
        structure: () => aiState.current.structure,
        activeFile: () => aiState.current.activeFile,
        unsaved: () => engine.hasChanges,
        openFile,
        passage: (quote) => evidencePassage(engine.doc, quote),
        ordinal: (passage, context) =>
          evidenceOrdinal(engine.doc, passage, context),
        targets: () => (projectAdapter ? evidenceTargets.current : null),
        // Neither edited nor switched file since: the open file by name, and
        // the engine's document by identity. The document is replaced on
        // every change, so identity means "edited" and the AI layer never
        // sees a character of what changed.
        watch: () => {
          const file = aiState.current.activeFile;
          const doc = engine.doc;
          return () =>
            aiState.current.activeFile === file && engine.doc === doc;
        },
      }),
    [projectAdapter, openFile, engine],
  );

  const assistant = useMemo<Assistant | null>(() => {
    if (!wiring || !ref || !aiReady || !projectAdapter) return null;
    return new Assistant({
      sources: projectAdapter,
      artifacts: projectAdapter,
      model: wiring.createModel(),
      ...(wiring.defaultModel ? { defaultModel: wiring.defaultModel } : {}),
      // No model thunk: the chat is the only store of the model selection,
      // and the Assistant reads it from the chat it runs. A second selection
      // lets the model button name one model while another answers.
      projectFacts: () => projectFactsOf(aiState.current.props),
      defaultNode: () => aiState.current.activeNode,
      evidence,
      // A reference by the name the writer's shelf gives it, in the interface
      // language at the moment of asking, read per call.
      referenceLabel: (reference) =>
        getI18n().t(
          reference.sectionId
            ? `reference.section.${reference.group}.${reference.sectionId}`
            : `reference.group.${reference.group}`,
        ),
      // A chat kind by the name the panel shows, read per call, so General's
      // pointer to another chat names one the writer can find.
      chatKindLabel: (kind) => getI18n().t(`dock.chatKind.${kind}`),
      // The same comments the margin draws, read through the assistant's own
      // port so it never learns the margin's files or types. A persona's
      // quote is found in the chapter through the same adapter, so a
      // document the writer barred is not read for this either.
      ...(comments
        ? {
            comments: commentsPort(comments, (nodeId) =>
              projectAdapter.read(`node:${nodeId}`).then(
                (source) => source.text,
                () => null,
              ),
            ),
          }
        : {}),
      ...(wiring.webSearch ? { webSearch: wiring.webSearch } : {}),
    });
  }, [wiring, ref, aiReady, projectAdapter, evidence, comments]);

  // Leaving the project aborts every run and refuses late writes; the
  // disposal waits one macrotask (`useDeferredDispose`).
  useDeferredDispose(assistant);

  // The chat list loads at the bridge, not the panel: the command palette's
  // chat search can run before the Ask face mounts, and a search over an
  // uninitialized aggregate finds nothing.
  useEffect(() => {
    if (assistant) void assistant.initialize();
  }, [assistant]);

  // Once the workspace has mounted its entry points.
  const registerEvidence = useCallback((targets: EvidenceTargets) => {
    evidenceTargets.current = targets;
  }, []);

  return { assistant, registerEvidence };
}
