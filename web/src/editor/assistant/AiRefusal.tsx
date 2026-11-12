// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button } from "../../ui";
import { aiSkills, type nearestCommand } from "../../ai/domain/skills";
import type { AssistantProblem } from "../../ai/application/assistant";
import type {
  ChatKind,
  ReadRef,
  SourceDescriptor,
} from "../../ai/domain/types";
import { SCOPE_WORDS } from "../../ai/domain/scope";
import { slotted } from "../components/slotted";
import { referenceName, type referenceNames } from "./commandReferences";
import { shapeWords } from "./mapAnswer";

/**
 * The refusal strip above the composer: the one row that says why the last
 * line went nowhere, or nothing. A missing persona first, then a line the
 * parse refused (an unknown command, an unknown reference), then the
 * assistant's own problem, then a model's failure that did not become a
 * turn.
 */
export default function AiRefusal({
  personaMissing,
  onChoosePersona,
  unknownCommand,
  activeKind,
  refused,
  references,
  catalogue,
  problem,
  onCleanChat,
  onWriteReference,
  modelError,
}: {
  personaMissing: boolean;
  onChoosePersona: () => void;
  /** A lone `/word` that is no command in this chat. */
  unknownCommand: {
    typed: string;
    near: ReturnType<typeof nearestCommand>;
  } | null;
  activeKind: ChatKind;
  /** A line that named a reference the book does not hold. */
  refused: { command: string; typed: string } | null;
  references: ReturnType<typeof referenceNames>;
  catalogue: readonly SourceDescriptor[];
  problem: AssistantProblem | null | undefined;
  onCleanChat: () => void;
  onWriteReference: ((reference: ReadRef) => void) | undefined;
  /** A failure with no turn to say it, and the provider it names. */
  modelError: { code: string | null | undefined; provider: string } | null;
}) {
  const { t, i18n } = useTranslation();
  const scopeLanguage = i18n.language?.startsWith("it") ? "it" : "en";
  // A refusal about a named reference names it as the writer sees it, and
  // puts the command and the scope word it teaches in ink. The set is matched
  // to a name the parse takes; a set that is gone has none, and its copy asks
  // for none.
  const problemSlots = (
    problem: AssistantProblem,
  ): Record<string, ReactNode> => {
    // `/summarise part`'s refusals: the Section a title names, as the writer
    // wrote it, and the scope word they teach in ink.
    if (problem.kind.startsWith("summarise-"))
      return {
        section: (
          <span className="ui-keyword">
            {SCOPE_WORDS.section[scopeLanguage]}
          </span>
        ),
        ...("title" in problem ? { title: <bdi>{problem.title}</bdi> } : {}),
      };
    if (!problem.kind.startsWith("review-reference")) return {};
    const ids = "references" in problem ? problem.references : undefined;
    const same = (one: readonly string[]) =>
      ids !== undefined &&
      one.length === ids.length &&
      one.every((id) => ids.includes(id));
    const name =
      references.accepted.find((one) => same(one.ids))?.name ??
      catalogue.find((one) => one.id === ids?.[0])?.title ??
      "";
    // The one command that takes a name. The problem does not say which
    // command refused, which holds while `/canon` is the only one; a second
    // must carry its command on the problem.
    const command = aiSkills.find((skill) => skill.argument === "reference");
    return {
      command: (
        <span className="ui-keyword">
          {command ? `/${command.command}` : ""}
        </span>
      ),
      section: (
        <span className="ui-keyword">{SCOPE_WORDS.section[scopeLanguage]}</span>
      ),
      name: <bdi>{name}</bdi>,
    };
  };
  if (personaMissing)
    return (
      <Banner
        tone="attention"
        action={
          <Button
            variant="attention"
            className="ui-btn-sm"
            onClick={onChoosePersona}
          >
            {t("dock.choosePersona")}
          </Button>
        }
      >
        {t("dock.problem.persona-missing")}
      </Banner>
    );
  if (unknownCommand)
    return (
      <p className="dock-problem ai-refusal">
        <span>
          {slotted(
            t,
            !unknownCommand.near
              ? "dock.problem.command-unknown"
              : unknownCommand.near.kind === activeKind
                ? "dock.problem.command-near"
                : "dock.problem.command-elsewhere",
            {
              typed: <span className="ui-keyword">{unknownCommand.typed}</span>,
              command: (
                <span className="ui-keyword">
                  /{unknownCommand.near?.skill.command}
                </span>
              ),
              room: unknownCommand.near
                ? t(`dock.chatKind.${unknownCommand.near.kind}`)
                : "",
            },
          )}
        </span>
      </p>
    );
  if (refused)
    return (
      <>
        <p className="dock-problem ai-refusal">
          {/* One flex item: the refusal lays its parts out as a
              row, and a sentence cut at its slots would wrap as
              separate pieces. */}
          <span>
            {slotted(
              t,
              references.shown.length > 0
                ? "dock.problem.review-reference-unknown"
                : "dock.problem.review-reference-unknown-none",
              {
                command: <span className="ui-keyword">{refused.command}</span>,
                name: <bdi>{refused.typed}</bdi>,
              },
            )}
          </span>
        </p>
        {/* The writer's own names, out of the crimson: every one the
            parse takes, uncapped, in shelf order, as text. */}
        {references.shown.length > 0 ? (
          <p className="dock-hint">
            {slotted(t, "dock.canon.names", {
              names: nameList(references.shown, i18n.language),
            })}
          </p>
        ) : null}
      </>
    );
  if (problem)
    return (
      <p className="dock-problem ai-refusal">
        {/* The problem's own values fill its copy: the model a
            `/where` refusal names and the cap it gives, and
            the scope words a refusal offers as its remedy, in the
            interface's language, from the one list the parser
            accepts, never a locale's own spelling. One flex item,
            so a sentence with elements in it wraps as a sentence. */}
        <span>
          {slotted(t, problemKey(problem), problemSlots(problem), {
            ...problem,
            // A refusal that differs by what it names picks its words
            // by i18next's context: a Part's title or a Section's.
            ...(problem.kind === "map-one-unit"
              ? { context: problem.unit }
              : {}),
            ...(problem.kind === "reference-needed"
              ? {
                  names: problem.needs
                    .map((need) => referenceName(t, need))
                    .join(", "),
                  count: problem.needs.length,
                }
              : {}),
            section: SCOPE_WORDS.section[scopeLanguage],
            part: SCOPE_WORDS.part[scopeLanguage],
            structure: SCOPE_WORDS.structure[scopeLanguage],
            // The structure words a `/map` refusal teaches, from the
            // parser's own table.
            ...shapeWords(scopeLanguage),
          })}
        </span>
        {problem.kind === "reader-contaminated" ? (
          <button
            type="button"
            className="ai-text-button"
            onClick={onCleanChat}
          >
            {t("dock.cleanChat")}
          </button>
        ) : null}
        {problem.kind === "reference-needed" && onWriteReference ? (
          // A space, not a margin, before the links: it collapses
          // when the group wraps to its own line.
          <>
            {" "}
            <span className="ai-write-links">
              {problem.needs
                .filter((need) => need.sectionId !== undefined)
                .map((need) => (
                  <button
                    key={`${need.group}:${need.sectionId}`}
                    type="button"
                    className="ui-text-link"
                    onClick={() => onWriteReference(need)}
                  >
                    {t("dock.writeReference", {
                      name: referenceName(t, need),
                    })}
                  </button>
                ))}
            </span>
          </>
        ) : null}
      </p>
    );
  if (modelError)
    return (
      <p className="dock-problem">
        {/* A failure with no code carries a thrown message, English
            and internal, so it reads as the generic line. */}
        {modelError.code
          ? t(`dock.modelError.${modelError.code}`, {
              provider: modelError.provider,
            })
          : t("dock.unexpectedError")}
      </p>
    );
  return null;
}

/**
 * A problem's copy key: its kind, except for a too-long Section whose Part
 * map would be refused too, whose remedy then names only a larger model,
 * never a move that fails.
 */
export function problemKey(problem: AssistantProblem): string {
  return problem.kind === "map-section-too-long" && !problem.offersPart
    ? "dock.problem.map-section-too-long-no-part"
    : `dock.problem.${problem.kind}`;
}

/**
 * The names a refused line may use, as the locale joins a choice ("Marta,
 * Aldo, or Key Locations"): each name the writer's own text in an inked
 * `<bdi>`, the joins the locale's.
 */
export function nameList(
  names: readonly string[],
  language: string,
): ReactNode {
  return new Intl.ListFormat(language, { type: "disjunction" })
    .formatToParts(names)
    .map((part, index) =>
      part.type === "element" ? (
        <bdi key={index} className="ui-keyword">
          {part.value}
        </bdi>
      ) : (
        part.value
      ),
    );
}
