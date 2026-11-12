// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { isFactTask } from "../domain/policy";
import { nextSection } from "../domain/reading";
import { relevanceTerms } from "../domain/relevance";
import { pageOf } from "../domain/referenceCatalogue";
import type { AiSkill } from "../domain/skills";
import { declaredSources, readRoles } from "../domain/sourceView";
import type {
  ChatRecord,
  ContextUse,
  ReadRef,
  ReviewTask,
  SourceDescriptor,
} from "../domain/types";
import type { AssistantDependencies } from "./assistantTypes";
import type { RunBudget } from "./budgets";
import {
  missingWants,
  refAddress,
  referenceMessage,
  referenceUsage,
  selectDeclared,
  type ContextSelection,
} from "./context";
import { letterEvidence } from "./letterEvidence";
import type { SignalPass } from "./signalPass";
import { SKILLS_PER_RUN } from "./tools";

/** What a turn hands the skill pickup: its sources, reads and room. */
export interface SkillPickupContext {
  dependencies: Pick<
    AssistantDependencies,
    "sources" | "referenceLabel" | "comments"
  >;
  catalog: readonly SourceDescriptor[];
  allowed: ReadonlySet<string>;
  /** The skills this run offers. */
  skills: readonly AiSkill[];
  chat: ChatRecord;
  /** Every chat as it is now, for an editor's letter. */
  chats: () => readonly ChatRecord[];
  /** The writer's question, which ranks the records a skill reads. */
  question: string;
  /** What this turn's chat reads. */
  reads: readonly ReadRef[];
  /** What this turn's chat attached of them. */
  declared: ContextSelection;
  /** How to read this turn's references, as the request says it. */
  referenceClause: string;
  budget: RunBudget;
  /** The run's receipts: a skill's reads join them. */
  used: ContextUse[];
  pass: SignalPass | null;
  /** The run's one fact check. */
  bookFacts: (task: ReviewTask) => Promise<string>;
}

/**
 * The `use_skill` handler for one run, which keeps the skills picked up so
 * far. A skill picked up answers with its method: the studio's own text,
 * with the documents it reads resolved to ids the run can read, the opening
 * for a skill that reads it, and the other chats' findings for the one
 * editorial skill that asks for them, the same three a typed command gets.
 * One that needs a document the writer has written none of is refused with
 * the names, as its command is.
 */
export function skillPickup(
  context: SkillPickupContext,
): (word: string) => Promise<unknown> {
  const {
    dependencies,
    catalog,
    allowed,
    skills,
    chat,
    question,
    reads,
    declared,
    referenceClause,
    budget,
    used,
    pass,
    bookFacts,
  } = context;
  const picked: string[] = [];
  return async (word: string): Promise<unknown> => {
    const skill = skills.find((one) => one.command === word.replace(/^\//, ""));
    if (!skill)
      return {
        error: "unknown-skill",
        skills: skills.map((one) => one.command),
      };
    if (picked.includes(skill.command))
      return {
        skill: `/${skill.command}`,
        note: "Already picked up in this answer; its method still holds.",
      };
    if (picked.length >= SKILLS_PER_RUN)
      return { error: "skill-limit", limit: SKILLS_PER_RUN };
    if (skill.needs.length > 0) {
      const unwritten = await missingWants(
        dependencies.sources,
        catalog,
        allowed,
        skill.needs,
        new Set(),
      );
      if (unwritten.length === skill.needs.length)
        return {
          error: "needs-documents",
          missing: unwritten.map(dependencies.referenceLabel ?? refAddress),
          hint: "The writer has written none of the documents this skill needs. Answer as well as you can without it, and name a document only where it would change your answer.",
        };
    }
    picked.push(skill.command);
    pass?.addSkill(skill);
    const opening =
      skill.target === "opening"
        ? nextSection(catalog, undefined)?.nodeId
        : undefined;
    const facts =
      skill.reviewTask && isFactTask(skill.reviewTask)
        ? await bookFacts(skill.reviewTask)
        : "";
    // The documents the skill reads, shown as a chat's declared ones are:
    // their records under their headings, within what is left of the
    // references' room. Ids alone would leave the model reading a sheet raw,
    // with no heading to tell a plan from a fact.
    const skillSources = declaredSources(catalog, allowed, skill.reads);
    // A document the room attached is not sent again, unless the room
    // showed less of it than the skill reads: the drafting room's
    // `characters(fact rule)` would leave `/what-if` with none of the
    // motives it reads the whole sheet for.
    const covers = (source: SourceDescriptor) => {
      const had = readRoles(source, reads);
      const wants = readRoles(source, skill.reads);
      return (
        had === null ||
        (wants !== null && [...wants].every((role) => had.has(role)))
      );
    };
    const partial = new Set(
      declared.uses
        .filter((use) => {
          const source = catalog.find((one) => one.id === use.id);
          return source !== undefined && !covers(source);
        })
        .map((use) => use.id),
    );
    // How to read them, only where the chat's own clause has not said it:
    // a page it already explains, at roles it already covers, is not
    // explained again.
    const turnPages = new Set(
      declaredSources(catalog, allowed, reads).map((one) => pageOf(one)?.id),
    );
    const explained = (source: SourceDescriptor) =>
      referenceClause !== "" &&
      turnPages.has(pageOf(source)?.id) &&
      covers(source);
    const howToRead = referenceUsage(
      skillSources.filter((source) => !explained(source)),
      Math.floor(budget.referenceCharacters / 4),
      skill.reads,
    );
    // What is left of the references' room, never a whole read window on
    // top of it: the room less the clause and what the room already
    // attached.
    const left =
      budget.referenceCharacters -
      referenceClause.length -
      declared.uses.reduce((sum, use) => sum + use.characters, 0);
    const shown = await selectDeclared(
      dependencies.sources,
      catalog,
      allowed,
      skill.reads,
      {
        uses: used.filter((use) => !partial.has(use.id)),
        texts: new Map(),
      },
      0,
      budget,
      {
        cap: Math.max(0, Math.min(budget.readWindow, left) - howToRead.length),
        terms: relevanceTerms(question, []),
        request: question,
      },
    );
    // Read, so a quote from them is checked like any other (`used`): one
    // receipt per document, the fuller reading replacing the room's.
    for (const use of shown.uses) {
      const at = used.findIndex((one) => one.id === use.id);
      if (at >= 0) used.splice(at, 1);
      used.push(use);
    }
    return {
      skill: `/${skill.command}`,
      method: skill.instruction,
      ...(facts ? { facts } : {}),
      reads: skillSources.map((source) => source.id),
      ...(shown.uses.length > 0
        ? {
            ...(howToRead ? { howToRead } : {}),
            references: referenceMessage(shown),
          }
        : {}),
      ...(opening && allowed.has(`node:${opening}`)
        ? { opening: `node:${opening}` }
        : {}),
      ...(skill.evidence === "rooms" && chat.kind === "editorial"
        ? {
            evidence: await letterEvidence(
              context.chats(),
              chat,
              catalog,
              dependencies.comments,
            ),
          }
        : {}),
    };
  };
}
