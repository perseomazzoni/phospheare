// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Assistant } from "../../ai";
import type {
  ChatRecord,
  ReadRef,
  ReviewScope,
  SourceDescriptor,
} from "../../ai/domain/types";
import {
  aiSkills,
  type CommandNames,
  type NamedNode,
} from "../../ai/domain/skills";
import {
  structureNodeIds,
  structureRevision,
} from "../../ai/domain/structureShapes";
import { pinnedSources, unsummarised } from "../../ai/domain/sourceView";
import { sectionsInPart } from "../../ai/domain/parts";
import type { DocumentStructure } from "../../project/types";
import {
  isSectionGroup,
  sectionLabelKey,
} from "../../project/referenceSections";
import { referenceNames } from "./commandReferences";
import type { LiveStructure } from "./mapAnswer";
import { appLog, describeError } from "../../log";

// Both listings rerun on every run, chat switch and tree change: one line a
// session for each.
const logged = new Set<"missing" | "catalogue">();

function logOnce(listing: "missing" | "catalogue", err: unknown): void {
  if (logged.has(listing)) return;
  logged.add(listing);
  appLog.warn("ai", "The panel's source listing failed.", {
    listing,
    ...describeError(err),
  });
}

/**
 * The Ask face's view of the project's sources: the live catalogue and
 * everything read from it (the titles every id is shown as, the names a
 * command can take, the Structure a `/map` answer is compared with), and
 * the documents the active chat relies on that are not written yet.
 */
export function usePanelCatalogue({
  assistant,
  active,
  running,
  structure,
  declared,
  scopeLanguage,
}: {
  assistant: Assistant | null | undefined;
  active: ChatRecord | null;
  running: boolean;
  /** The editor's live tree: when it changes, the sources are listed again. */
  structure: DocumentStructure | null | undefined;
  /** The project's declared shape, read at render by the panel. */
  declared: LiveStructure["declared"];
  scopeLanguage: "it" | "en";
}) {
  const { t } = useTranslation();
  // The live catalogue, whose titles are what every id in the transcript is
  // shown as. Refreshed on mount, when the chat changes and when a
  // run starts or ends, not per render, because listing it reads the
  // reference shelf. A title can therefore trail a rename by one run, which
  // costs nothing: opening anything re-checks the id against the catalogue.
  //
  // The descriptors are kept, not only their titles, because the pinned
  // chips above the composer need to know which pins are still live, and a
  // pin past a reader's horizon depends on the source's kind and order. One
  // listing feeds both, so the chips and the transcript never disagree.
  const [catalogue, setCatalogue] = useState<readonly SourceDescriptor[]>([]);
  // The documents the active chat relies on that are not written yet, asked
  // of the Assistant (`sources.missing`) whenever the chat changes or a run
  // ends. A run is when a document the writer just wrote gets read, and a
  // chat switch is a different room with different wants.
  const [missing, setMissing] = useState<readonly ReadRef[]>([]);
  useEffect(() => {
    if (!assistant || !active?.id || running) return undefined;
    let current = true;
    assistant.sources
      .missing()
      .then((found) => {
        if (current) setMissing(found);
      })
      .catch((err: unknown) => {
        logOnce("missing", err);
        // A failed listing names nothing missing rather than everything.
        if (current) setMissing([]);
      });
    return () => {
      current = false;
    };
  }, [
    assistant,
    active?.id,
    active?.kind,
    active?.preferences.preset,
    active?.preferences.personaId,
    running,
    structure,
  ]);
  // A summary is named as one. Its own title is its Section's,
  // so unnamed, a cited summary reads as the chapter itself and a derived
  // retelling passes for the book. A Guidebook page goes by the name its
  // shelf gives it, because its own title is the file's stem: a citation
  // would read "editing-brief" where the Reference panel says "Indicazioni
  // per la revisione".
  const titles = useMemo<ReadonlyMap<string, string>>(
    () =>
      new Map(
        catalogue.map((one) => [
          one.id,
          one.kind === "summary"
            ? t("dock.summaryTitle", { title: one.title })
            : one.group === "guidebook" && one.sectionId
              ? t(`reference.section.guidebook.${one.sectionId}`, {
                  defaultValue: one.title,
                })
              : one.title,
        ]),
      ),
    [catalogue, t],
  );
  const pinned = useMemo(
    () => (active ? pinnedSources(active, catalogue) : []),
    [active, catalogue],
  );
  // The Parts and Sections a scoped command can name by title, from
  // the same listing the run checks the id against again when it starts.
  const namedNodes = useMemo<NamedNode[]>(
    () =>
      catalogue.flatMap((source) =>
        source.kind === "manuscript" && source.nodeId
          ? [
              {
                id: source.nodeId,
                title: source.title,
                ...(source.nodeKind ? { kind: source.nodeKind } : {}),
              },
            ]
          : [],
      ),
    [catalogue],
  );
  // The references a command can check against by name, as in `/canon Marta`.
  // The run checks the ids again against its own task's.
  const references = useMemo(() => {
    const other = scopeLanguage === "it" ? "en" : "it";
    return referenceNames(
      catalogue,
      aiSkills
        .filter((skill) => skill.argument === "reference")
        .flatMap((skill) => skill.reads),
      (source) => {
        const group = source.group ?? "";
        if (!source.sectionId || !isSectionGroup(group as never)) return [];
        const key = sectionLabelKey(group as "guidebook", source.sectionId);
        return [t(key), t(key, { lng: other })];
      },
    );
  }, [catalogue, scopeLanguage, t]);
  // A manuscript node's title by id, for the reading's curve and ledger,
  // from the live catalogue so a renamed Section reads by its new name.
  const nodeTitleOf = useMemo(() => {
    const byNode = new Map(
      catalogue
        .filter((one) => one.kind === "manuscript" && one.nodeId)
        .map((one) => [one.nodeId as string, one.title] as const),
    );
    return (nodeId: string) => byNode.get(nodeId) ?? nodeId;
  }, [catalogue]);
  // Everything a typed line can name, built once: the parse, the composer's
  // completion and the transit notice read the same bundle.
  const commandNames = useMemo<CommandNames>(
    () => ({ nodes: namedNodes, references: references.accepted }),
    [namedNodes, references],
  );
  // Which of an answer's "no summary" rows a click would summarise now: the
  // run's own list (`unsummarised`) over the same listing,
  // refreshed as a run ends so the count moves once the summaries are
  // written. A Part review's click reads only the Part's Sections as they
  // stand now, so a row moved out of it since is on no count;
  // the Structure's scope is every live Section, which `unsummarised`
  // already is. Absent until the catalogue has been read: an empty catalogue
  // would say "nothing is missing" about every answer and offer Search again
  // before the first listing lands.
  const [catalogueRead, setCatalogueRead] = useState(false);
  // What a `/map` answer is stale against, written by the listing below.
  const [liveStructure, setLiveStructure] = useState<LiveStructure>();
  const live = useMemo<LiveStructure | undefined>(
    () => liveStructure && { ...liveStructure, declared },
    [liveStructure, declared],
  );
  const stillMissing = useMemo(
    () =>
      catalogueRead
        ? (sourceIds: readonly string[], scope?: ReviewScope) => {
            const reach =
              scope?.kind === "node"
                ? new Set(sectionsInPart(catalogue, scope.nodeId))
                : null;
            return unsummarised(
              catalogue,
              reach ? sourceIds.filter((id) => reach.has(id)) : sourceIds,
            ).map((source) => source.id);
          }
        : undefined,
    [catalogue, catalogueRead],
  );

  // Every document a name still stands for. An answer named against one
  // outside it offers no Resume, which would only be refused.
  const nameableIds = useMemo(
    () => new Set(references.accepted.flatMap((one) => one.ids)),
    [references],
  );
  // Judged only once the catalogue has been read: before the first listing
  // lands nothing is nameable, and every named answer would read as gone.
  // `stillMissing` waits the same way.
  const referenceGone = (ids: readonly string[] | undefined) =>
    catalogueRead && (ids ?? []).some((id) => !nameableIds.has(id));
  // The Sections this chat's Section maps cover, as one string, so the
  // listing below re-reads their revisions when a Section map arrives and
  // not on every render.
  const sectionMapKey = [
    ...new Set(
      (active?.turns ?? []).flatMap((turn) =>
        turn.mapped && turn.mapped.kind !== "arc"
          ? [`node:${turn.mapped.scope.nodeId}`]
          : [],
      ),
    ),
  ].join("\n");
  // Bumped when a click on a quote is refused because its passage changed.
  // The listing re-reads at once, so the refusal and a Section map's
  // "changed" land together, instead of the ruler offering starts that are
  // each refused until a later re-list.
  const [relist, setRelist] = useState(0);

  useEffect(() => {
    // Not skipped while a run is going: the panel remounts on every dock-face
    // switch, and one mounted mid-run would hold an empty map until the run
    // ended, every finding saying its source is gone and every citation a raw
    // id.
    if (!assistant) return;
    let current = true;
    assistant
      .listSources()
      .then((sources) => {
        if (!current) return;
        setCatalogue(sources);
        setCatalogueRead(true);
        // The Structure a `/map` answer is compared with, from this listing
        // and no other, so the fingerprint and the node ids always come from
        // one listing; the effect's flag drops a slower hash of an older
        // listing. It has its own catch: the hash is `crypto.subtle`, and a
        // failure there must not cost the transcript its titles. The map
        // then says nothing about staleness, which is the true state.
        //
        // A Section map is compared with its Section's content, read here
        // with the listing under the same flag, as the run reads it: the live
        // buffer or the file. So it is checked on every re-list (a run, a
        // chat, a tree change, a quote's click refused as changed), never on
        // each keystroke. `revealEvidence` checks the passage itself.
        const sectionIds = sectionMapKey ? sectionMapKey.split("\n") : [];
        void Promise.all([
          structureRevision(sources),
          assistant.sources.sectionRevisions(sectionIds),
        ]).then(
          ([revision, sections]) => {
            if (current)
              setLiveStructure({
                revision,
                nodeIds: structureNodeIds(sources),
                sections,
              });
          },
          () => undefined,
        );
      })
      .catch((err: unknown) => {
        logOnce("catalogue", err);
        // The catalogue stays as it is: a failed listing is no reason to
        // strip the titles the transcript already shows.
      });
    return () => {
      current = false;
    };
  }, [assistant, running, active?.id, structure, sectionMapKey, relist]);

  return {
    catalogue,
    catalogueRead,
    missing,
    titles,
    pinned,
    references,
    nodeTitleOf,
    commandNames,
    live,
    stillMissing,
    referenceGone,
    /** List the sources again at once, as after a quote refused as changed. */
    relistNow: () => setRelist((count) => count + 1),
  };
}
