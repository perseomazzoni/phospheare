// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Assistant } from "../../ai";
import type {
  ChatRecord,
  ReviewScope,
  TurnCommand,
} from "../../ai/domain/types";
import {
  actionOf,
  asksAt,
  nearestCommand,
  parseCommand,
  questionOf,
  quoteIsArgument,
  skillsFor,
  type CommandNames,
} from "../../ai/domain/skills";
import { passageFor } from "../../ai/domain/scope";
import { nearScope, type OpenNode } from "./summarisePart";

/** What sending a line needs from the Ask face. */
export interface SendContext {
  assistant: Assistant;
  /** The chat the line is sent in. */
  chat: ChatRecord;
  /** Everything a typed line can name. */
  names: CommandNames;
  /** The passage riding on the line, and its setter. */
  quote: string | null;
  onQuote: (quote: string | null) => void;
  writeDraft: (chatId: string, value: string) => void;
  /** Words back into the field, if it is still empty. */
  giveBack: (chatId: string, words: string) => void;
  fieldEmpty: (chatId: string) => boolean;
  /** Follow the transcript to its foot, as after a run that started. */
  follow: () => void;
  /** A lone `/word` that is no command in this chat. */
  refuseUnknownCommand: (refusal: {
    typed: string;
    near: ReturnType<typeof nearestCommand>;
  }) => void;
  /** A line that named a reference the book does not hold. */
  refuseReference: (refusal: { command: string; typed: string }) => void;
}

/**
 * Send a line typed in the composer: a command runs its workflow, and
 * anything else is a question. A refusal leaves the words in the field.
 */
export async function sendLine(
  context: SendContext,
  text: string,
): Promise<void> {
  const {
    assistant,
    chat: active,
    names: commandNames,
    quote,
    onQuote,
    writeDraft,
    giveBack,
    fieldEmpty,
  } = context;
  if (!text.trim()) return;
  const chatId = active.id;
  // One parse in one place: the `/` menu only fills the field, so a picked
  // and a typed command arrive here the same way. Anything the parser does
  // not recognise is a question, including a sentence that starts with a
  // slash.
  const command = parseCommand(text, skillsFor(active.kind), commandNames);
  // What the writer typed, kept apart from what is sent: a question command
  // sends its rubric, and a refusal must give back the writer's words,
  // never the rubric.
  const typed = text;
  let asked: TurnCommand | undefined;
  // Whether the attached quote goes with the question: it does, unless
  // the command reads the whole Section instead.
  let withQuote = true;
  // A lone slash-word that names no command here is no question either.
  if (!command && /^\/[^\s/]+$/.test(text.trim())) {
    context.refuseUnknownCommand({
      typed: text.trim(),
      near: nearestCommand(text, active.kind),
    });
    return;
  }
  // A reference the book does not hold sends nothing, and the words stay
  // in the field: never a question, and never every reference instead.
  if (command?.kind === "unknown-reference") {
    context.refuseReference({
      command: `/${command.skill.command}`,
      typed: command.typed,
    });
    return;
  }
  if (command) {
    const action = actionOf(command.skill);
    // A command that takes an argument never goes to the model as a bare
    // line: the writer is halfway through asking, so a bare one stays in
    // the field with the quote where it is. Where the quote is the
    // argument (`quoteIsArgument`: a question command, `/verify`), it runs
    // bare with one attached.
    if (
      command.kind === "text" &&
      !command.argument.trim() &&
      !(quoteIsArgument(command.skill) && quote)
    )
      return;
    switch (action) {
      case "locate": {
        if (command.kind !== "text") return;
        writeDraft(chatId, "");
        // A refusal: too long, or a model without tools.
        if ((await assistant.locate.run(command.argument)) === "rejected")
          giveBack(chatId, typed);
        else context.follow();
        return;
      }
      case "verify": {
        if (command.kind !== "text") return;
        // The quote goes with the claim, or stands for it.
        const passage = quote ?? undefined;
        writeDraft(chatId, "");
        if (passage) onQuote(null);
        if (
          (await assistant.verify.run(command.argument, passage)) === "rejected"
        ) {
          if (fieldEmpty(chatId)) {
            writeDraft(chatId, typed);
            if (passage) onQuote(passage);
          }
          return;
        }
        context.follow();
        return;
      }
      case "journal":
      case "predict": {
        // A beta reader reads where it stands, never where the writer
        // points: no scope, no quote.
        writeDraft(chatId, "");
        const outcome =
          action === "journal"
            ? await assistant.reader.readOn()
            : await assistant.reader.predict();
        if (outcome === "rejected") giveBack(chatId, typed);
        else context.follow();
        return;
      }
      case "map": {
        // `/map` reads summaries, never the quote.
        if (command.kind !== "scoped") return;
        writeDraft(chatId, "");
        if (
          (await assistant.maps.run(command.scope, command.shape)) ===
          "rejected"
        )
          giveBack(chatId, typed);
        else context.follow();
        return;
      }
      case "review": {
        if (command.kind !== "scoped" || !command.skill.reviewTask) return;
        writeDraft(chatId, "");
        // The nearest scope reads the quote when there is one, so the
        // quote goes with it, as it goes with a question; any other scope
        // leaves it where it is (`passageFor`).
        const passage = passageFor(command.scope, quote ?? undefined);
        if (passage) onQuote(null);
        const outcome = await assistant.reviews.run(
          command.skill.reviewTask,
          command.scope,
          passage,
          // The set the name stood for as typed; the run checks it again.
          command.references,
        );
        // A refusal leaves nothing in the transcript, so the words come
        // back with the quote they took (`giveBack`).
        if (outcome === "rejected") {
          if (fieldEmpty(chatId)) {
            writeDraft(chatId, typed);
            if (passage) onQuote(passage);
          }
          return;
        }
        context.follow();
        return;
      }
      case "summarise": {
        if (command.kind !== "scoped") return;
        const scope = nearScope(command.scope, assistant.currentNode());
        // At the quote or the open Section the command is a question
        // (`asksAt`): the rubric, asked as the writer's words. `section`
        // summarises the whole Section, so a quote stays where it is,
        // unsent (`passageFor`).
        if (asksAt(command.skill, scope)) {
          const question = questionOf(command.skill);
          text = question.text;
          asked = question.command;
          withQuote = passageFor(scope, true) === true;
          break;
        }
        writeDraft(chatId, "");
        // A refusal: another Section's title, no Part, or a Section whose
        // summary would not come.
        if ((await assistant.summaries.run(scope)) === "rejected") {
          if (fieldEmpty(chatId)) writeDraft(chatId, typed);
          return;
        }
        context.follow();
        return;
      }
      case "question": {
        // The rubric, then the writer's words last as data. `questionOf` is
        // the one composition the codec checks a replayed turn against.
        const question = questionOf(
          command.skill,
          command.kind === "text" ? command.argument : undefined,
        );
        text = question.text;
        asked = question.command;
        break;
      }
      default:
        return action satisfies never;
    }
  }
  // Clear the composer at submit, not at completion: `send` resolves when
  // the run ends, and text left in place while the answer streams lets
  // Enter queue the same question twice. The quote clears with it; left in
  // the composer through the answer, it looks unsent and rides on the next
  // question.
  const sent = withQuote ? quote : null;
  writeDraft(chatId, "");
  if (withQuote) onQuote(null);
  // Only a command's question carries what the writer typed with it.
  const outcome = asked
    ? await assistant.send(text, sent ?? undefined, asked)
    : await assistant.send(text, sent ?? undefined);
  // Given back only into an empty field: a refusal over a named reference
  // comes once the context is read, and the writer may have begun the next
  // line by then.
  if (outcome === "rejected") {
    if (fieldEmpty(chatId)) {
      writeDraft(chatId, typed);
      // A quote that never left stays where it is.
      if (withQuote) onQuote(sent);
    }
    return;
  }
  context.follow();
}

/**
 * What an edited question sends. A question command's line is
 * composed as the composer composes it, the rubric then the words, and
 * carries the line the writer typed; anything else goes as their words.
 * `null` for a line the composer would hold: a command that takes text,
 * with none and no quote to stand for it.
 */
export function editedQuestion(
  text: string,
  chat: ChatRecord | null,
  names: CommandNames,
  quote: string | undefined,
  open: OpenNode | null,
): { text: string; command?: TurnCommand; withoutQuote?: true } | null {
  const command = chat ? parseCommand(text, skillsFor(chat.kind), names) : null;
  const scope: ReviewScope =
    command?.kind === "scoped"
      ? nearScope(command.scope, open)
      : { kind: "current" };
  // Only a command asked as a question at this scope (`asksAt`) is composed:
  // a `/summarise` of the open Section is one, while `/summarise part` is a
  // workflow and is sent as words.
  if (
    !command ||
    command.kind === "unknown-reference" ||
    !asksAt(command.skill, scope)
  )
    return { text };
  const argument = command.kind === "text" ? command.argument : undefined;
  if (command.kind === "text" && !argument?.trim() && !quote) return null;
  // The turn's quote goes with it wherever a typed line's would
  // (`passageFor`); `/summarise section` reads the whole Section instead.
  return quote && passageFor(scope, quote) === undefined
    ? { ...questionOf(command.skill, argument), withoutQuote: true }
    : questionOf(command.skill, argument);
}
