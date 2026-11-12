// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Icon, Menu } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import {
  bareScope,
  completesTitle,
  parseCommand,
  quoteIsArgument,
  skillFor,
  takesShape,
  NO_NAMES,
  type AiCommand,
  type AiSkill,
  type CommandNames,
} from "../../ai/domain/skills";
import {
  SCOPE_WORDS,
  normaliseTyped,
  scopeKindOf,
} from "../../ai/domain/scope";
import { MAP_SHAPES } from "../../ai/domain/structureShapes";
import { MAP_SHAPE_IDS, type ScopeKind } from "../../ai/domain/types";

// ── The composer ─────────────────────────────────────────────────────────────
//
// A pill with the context button on the left, the field in the middle, and
// Send or Stop on the right.
//
// The field grows line by line with its text and shrinks when the text goes.
// It never resizes on focus: a box that changes size before the writer types
// reads as the layout moving under them.
//
// The placeholder invites ("Ask something…") rather than repeating the Dock
// tab's name. The accessible name stays "Ask", because a placeholder vanishes
// at the first keystroke and is not a label.
//
// ── The slash ────────────────────────────────────────────────────────────────
//
// An editorial chat can be asked for a named reading, and typing `/` alone
// opens the list. A typed command costs no permanent row in a dock as narrow
// as 340px, and a writer who knows the word never opens the menu.
//
// The menu opens on exactly `/`, not on a field that starts with one. A
// question can open with a slash, so there is no prefix matching and no
// filtering: a second character means the writer is writing, and the menu
// closes.
//
// Choosing a command writes it into the field rather than running it. A
// command takes an optional scope (`/continuity` reads the open Section,
// `/continuity structure` the whole Structure), so the writer needs room to
// add a word, and the submit key stays the one route from text to run.
//
// ── The pins ─────────────────────────────────────────────────────────────────
//
// Each live pin from the Context dialog is a chip above the field with its
// title and an × that unpins it, the same shape as the quote beside it: both
// show what is attached to the next message. The chip's words are not a button;
// the `@` is the one way into the whole list.
//
// Only live pins are drawn (`pinnedSources`). A pin whose source is gone or
// past a reader's horizon is attached to nothing.
//
// ── A command as it is typed ─────────────────────────────────────────────────
//
// `/where [a moment in the story]`: the command in the accent and, until the
// writer types it, what it takes in brackets in the placeholder's grey. A
// textarea cannot colour part of its text, so while a command is recognised
// the field's text goes transparent and an aria-hidden mirror in the same
// cell, on the same metrics, draws every glyph. The caret and the selection
// stay the field's.
//
// A command is recognised by `parseCommand`, the submit route's own reading,
// and nothing looser: the colour must not promise a run the router will not
// make, so `/wh` and `/canon deeply` stay ink.
//
// ── What the ghost says ──────────────────────────────────────────────────────
//
// The ghost says what Enter does now, never the wider choice, because grey
// text after a command reads as "type this". A description is bracketed; a
// completion is bare, so it never reads as a description, and Tab takes it.
// A completion never promises a run the parse would send as a question.
// `ghostFor`, `completionOf` and `referenceCompletionOf` state the cases.
// The command menu's notes teach the wider words.

export interface AiComposerProps {
  value: string;
  /**
   * The chat this draft belongs to, and a dependency of the measure. Two
   * chats can hold the same draft string, so `value` alone does not change
   * across the switch and the field would not be re-measured.
   */
  chatId: string;
  /** The selection the question is about, shown above the field. */
  quote: string | null;
  /**
   * The sources pinned to every message, in pin order. Live ones only; the
   * caller resolves them (`pinnedSources`).
   */
  pinned: ReadonlyArray<{ id: string; title: string }>;
  /** True while the chat has no usable persona: there is nothing to ask. */
  disabled: boolean;
  running: boolean;
  /**
   * The run is waiting on the writer to approve a web search. Stop
   * stays and still ends the run, but drops its running edge: that edge
   * means the writer waits on the machine, and here the machine waits on the
   * writer.
   */
  waiting?: boolean;
  /** Opens the Context dialog: what this chat can see. */
  onOpenContext: () => void;
  /**
   * The named readings this chat can be asked for, reached by typing `/`.
   * Empty for every kind but an editorial chat. The placeholder follows it,
   * so the field never advertises commands the chat does not have.
   */
  commands: readonly AiSkill[];
  /**
   * What a typed line can name: the Parts and Sections by title, and the
   * references a command that takes one can name. The panel builds it once
   * from its live catalogue, and the submit route parses against the same
   * bundle.
   */
  names?: CommandNames;
  /**
   * The word naming where the writer is: `part` while the open node
   * is a Part or sits in one, `section` in a loose Section, and `null` with
   * nothing open or the catalogue not yet read. The menu notes teach from it
   * (`/map`'s narrower word, and the `part` tail of a command that offers no
   * `structure`), so the menu never teaches a word the run refuses.
   * Omitted, it is `part`, the most common place; the panel always passes
   * it.
   */
  openWord?: "part" | "section" | null;
  /** Puts a command in the field without running it. */
  onPickCommand: (skill: AiSkill) => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onDropQuote: () => void;
  /** Take one source off every message, as unticking it in Context does. */
  onUnpin: (id: string) => void;
  onStop: () => void;
}

/** What the grey text after a command says. */
export type ComposerGhost =
  | { readonly kind: "describe"; readonly key: string }
  | { readonly kind: "complete"; readonly rest: string };

/** The command at the head of the field, split for the mirror. */
export interface TypedCommand {
  readonly lead: string;
  readonly word: string;
  readonly after: string;
  readonly skill: AiSkill;
  /** Whether Enter runs it, by the parser; only then is it coloured. */
  readonly runnable: boolean;
  readonly ghost: ComposerGhost | null;
}

/**
 * The command at the head of the field, or null when the field holds a
 * question. `language` picks which spelling of a scope word a completion
 * offers first; either spelling runs.
 */
export function typedCommand(
  value: string,
  commands: readonly AiSkill[],
  names: CommandNames = NO_NAMES,
  {
    language = "en",
    quoted = false,
  }: { language?: "en" | "it"; quoted?: boolean } = {},
): TypedCommand | null {
  const lead = /^\s*/.exec(value)?.[0] ?? "";
  const word = /^\S+/.exec(value.slice(lead.length))?.[0] ?? "";
  const after = value.slice(lead.length + word.length);
  const split = { lead, word, after };
  const command = parseCommand(value, commands, names);
  // A name the writer has not finished, or one the book does not hold, is no
  // run yet: the command word stays ink, with no error styling while they
  // type, and Enter sends nothing. A tail still on its way to a title keeps
  // that title's completion below.
  if (command && command.kind !== "unknown-reference")
    return {
      ...split,
      skill: command.skill,
      runnable: true,
      ghost: ghostFor(command, after, quoted),
    };
  // Not a run, but perhaps a scope word, a title or a shape word on its way
  // to being one.
  const skill = word.startsWith("/") ? skillFor(word, commands) : null;
  const rest = skill
    ? (completionOf(skill, after, names, language) ??
      shapeCompletionOf(skill, value, commands, names, language))
    : null;
  return skill && rest
    ? { ...split, skill, runnable: false, ghost: { kind: "complete", rest } }
    : null;
}

/** The shape words, the interface's spelling first; never the `also` ones. */
function shapeWordList(language: "en" | "it"): string[] {
  const other = language === "it" ? "en" : "it";
  return MAP_SHAPE_IDS.flatMap((id) => [
    MAP_SHAPES[id].word[language],
    MAP_SHAPES[id].word[other],
  ]);
}

/**
 * The rest of a shape word begun after a complete scope, the second slot:
 * `/map part h` completes `ero`. Only where the parser takes a shape, and
 * only after a scope it reads.
 */
function shapeCompletionOf(
  skill: AiSkill,
  value: string,
  commands: readonly AiSkill[],
  names: CommandNames,
  language: "en" | "it",
): string | null {
  if (!takesShape(skill)) return null;
  const split = /^(.*\S)\s+(\S+)$/.exec(value.trimStart());
  if (!split) return null;
  const [, head, begun] = split;
  const parsed = parseCommand(head, commands, names);
  // A shape already typed takes no second one.
  if (parsed?.kind !== "scoped" || parsed.shape) return null;
  const word = shapeWordList(language).find(
    (one) =>
      one.length > begun.length &&
      one.toLocaleLowerCase().startsWith(begun.toLocaleLowerCase()),
  );
  return word ? word.slice(begun.length) : null;
}

function ghostFor(
  // A refused reference is never drawn as a run (`typedCommand`).
  command: Exclude<AiCommand, { kind: "unknown-reference" }>,
  after: string,
  quoted: boolean,
): ComposerGhost | null {
  if (command.kind === "text") {
    if (after.trim()) return null;
    // A question takes a quote as its words, and `/verify` as its
    // claim: over one, Enter already sends, so the ghost names the quote
    // rather than claiming a description is needed. It is derived from the
    // current quote, so dropping the quote brings the hint back. `/where`'s
    // words are its own, and a quote stands for none of them
    // (`quoteIsArgument`).
    if (quoted && quoteIsArgument(command.skill))
      return { kind: "describe", key: "dock.scope.quote" };
    // Each command names what it takes, from its own keys.
    return { kind: "describe", key: `dock.${command.skill.command}.hint` };
  }
  const { skill, scope } = command;
  // A name typed: the line already says what Enter reads.
  if (command.kind === "scoped" && command.references) return null;
  if (skill.scopes.length === 0) return null;
  if (scope.kind === "structure")
    // A command whose bare scope is the Structure (`/map`) reads summaries,
    // not prose, so there are no hours to warn of. The test is the declared
    // bare scope, not whether the command is a workflow, since a scoped
    // workflow is not `/map`. Typed alone, the ghost names what it reads;
    // with the word typed, the word says it. A shape word alone
    // leaves the scope unsaid, so the ghost still names the scope, never the
    // shape.
    return bareScope(skill).kind === "structure"
      ? scopeTyped(command, after)
        ? null
        : { kind: "describe", key: "dock.scope.structure" }
      : { kind: "describe", key: "dock.scope.cost" };
  if (scope.kind !== "current") return null;
  if (!quoted) return { kind: "describe", key: "dock.scope.current" };
  // The quote above the field already shows what a command that reaches no
  // further than a Section will read.
  return skill.scopes.includes("structure")
    ? { kind: "describe", key: "dock.scope.quote" }
    : null;
}

/** Whether the writer typed the scope, rather than only a shape after it. */
function scopeTyped(command: AiCommand, after: string): boolean {
  const words = after.trim().split(/\s+/).filter(Boolean);
  return words.length > (command.kind === "scoped" && command.shape ? 1 : 0);
}

/**
 * The rest of the one scope word, shape word or title `after` has begun, or
 * `null`, tried in slot order: a scope word, then a shape word typed with no
 * scope before it, then the one title. A word the command does not offer is
 * never completed, nor a title for a command that takes none: completing it
 * would promise a run that is a question.
 */
function completionOf(
  skill: AiSkill,
  after: string,
  names: CommandNames,
  language: "en" | "it",
): string | null {
  const typed = after.replace(/^\s+/, "");
  if (skill.argument === "reference")
    return referenceCompletionOf(skill, typed, names, language);
  const { nodes } = names;
  if (!typed || /\s$/.test(typed) || skill.scopes.length === 0) return null;
  const other = language === "it" ? "en" : "it";
  const words = skill.scopes.flatMap((kind) => [
    SCOPE_WORDS[kind][language],
    SCOPE_WORDS[kind][other],
  ]);
  const begun = (candidate: string) =>
    candidate.length > typed.length &&
    candidate.toLocaleLowerCase().startsWith(typed.toLocaleLowerCase());
  // A word first, in the interface's language; a title only when it is the
  // one title the letters can still become.
  const word = [
    ...words,
    ...(takesShape(skill) ? shapeWordList(language) : []),
  ].find(begun);
  if (word) return word.slice(typed.length);
  // Only the titles this command runs from (`completesTitle`: a Part's after
  // `/summarise`), and only a spelling no other node shares, which the parse
  // would take as neither.
  const titles = nodes
    .filter((node) => completesTitle(skill, node) && begun(node.title))
    .map((node) => node.title);
  const spelt = (title: string) =>
    nodes.filter((node) => normaliseTyped(node.title) === normaliseTyped(title))
      .length;
  return titles.length === 1 && spelt(titles[0]) === 1
    ? titles[0].slice(typed.length)
    : null;
}

/**
 * The rest of a scope word, title or name for a command that takes a
 * reference, in its two slots:
 * - the first: a scope word, then a title or a name only when it is the one
 *   candidate across both that the letters can still become;
 * - after a scope (an offered scope word, or a whole title): names only, and
 *   only once a letter of one is typed, so a ghost never teaches the slot.
 * It continues past a space while one candidate fits, since names and titles
 * can contain spaces. It appends and never re-cases the writer's letters.
 */
function referenceCompletionOf(
  skill: AiSkill,
  typed: string,
  names: CommandNames,
  language: "en" | "it",
): string | null {
  if (!typed) return null;
  const begun = (text: string) => (candidate: string) =>
    candidate.length > text.length &&
    candidate.toLocaleLowerCase().startsWith(text.toLocaleLowerCase());
  const other = language === "it" ? "en" : "it";
  const word = skill.scopes
    .flatMap((kind) => [SCOPE_WORDS[kind][language], SCOPE_WORDS[kind][other]])
    .find(begun(typed));
  if (word) return word.slice(typed.length);
  const sole = (candidates: readonly string[]) => {
    const distinct = [...new Set(candidates)];
    return distinct.length === 1 ? distinct[0] : null;
  };
  // Only what the parse can take: a spelling two titles, or two names, share
  // names neither (`soleOf`), so it is never completed. A title and a name
  // spelt alike are one text, and either role parses.
  const taken = (spellings: readonly string[]) =>
    spellings.filter(
      (one, _, all) =>
        all.filter((other) => normaliseTyped(other) === normaliseTyped(one))
          .length === 1,
    );
  // Taken among every title (a Part and a Section spelt alike name
  // neither), then narrowed to the kind this command completes.
  const unique = new Set(taken(names.nodes.map((node) => node.title)));
  const titles = names.nodes
    .filter((node) => unique.has(node.title) && completesTitle(skill, node))
    .map((node) => node.title);
  const named = taken(names.references.map((one) => one.name));
  const first = sole([...titles, ...named].filter(begun(typed)));
  if (first) return first.slice(typed.length);
  // After a scope: every split whose head is one and whose tail has begun.
  const after: string[] = [];
  for (const space of typed.matchAll(/\s+/g)) {
    const at = space.index ?? 0;
    const tail = typed.slice(at + space[0].length);
    if (!tail) continue;
    const head = typed.slice(0, at);
    const kind = scopeKindOf(head);
    const namesScope = kind
      ? skill.scopes.includes(kind)
      : skill.scopes.length > 0 &&
        names.nodes.filter(
          (node) => normaliseTyped(node.title) === normaliseTyped(head),
        ).length === 1;
    if (!namesScope) continue;
    for (const name of named)
      if (begun(tail)(name)) after.push(name.slice(tail.length));
  }
  return sole(after);
}

/**
 * The tail of a command's menu note that teaches one word the command runs
 * from where the writer is, with the word itself in ink: it is the thing to
 * type, and the rest is about it.
 */
function scopeNote(
  skill: AiSkill,
  quoted: boolean,
  openWord: "part" | "section" | null,
  language: "en" | "it",
  t: (key: string, values: Record<string, string>) => string,
): ReactNode {
  const tail = (key: string, kind: ScopeKind) => {
    const mark = "\u0000";
    const [before = "", after = ""] = t(key, { [kind]: mark }).split(mark);
    // The tail (its middot, the keyword and its gloss) is one unbreakable
    // unit (`.ui-menu-tail`): a note wraps before it, never inside it, so the
    // keyword stays with its gloss and the dot never dangles. The space
    // before it stays outside, as the break point.
    return (
      <>
        {" "}
        <span className="ui-menu-tail">
          {"· "}
          {before}
          <span className="ui-keyword">{SCOPE_WORDS[kind][language]}</span>
          {after}
        </span>
      </>
    );
  };
  // One rule for every scoped command, measured against what typing
  // the command alone reads, never against a command's name:
  // - a command whose bare scope is already the whole Structure (`/map`) has
  //   nothing wider to teach, so it teaches the narrower word that runs from
  //   here; a quote narrows nothing it reads;
  // - over a quote, the word that takes the whole Section instead of the
  //   passage;
  // - otherwise the widest word offered: `structure`, else `part`, and `part`
  //   only where the open node sits in a Part, so the menu never teaches a
  //   word the run refuses.
  // One keyword per note.
  if (bareScope(skill).kind === "structure") {
    if (openWord && skill.scopes.includes(openWord))
      return tail(`dock.scopeNote.${openWord}`, openWord);
    return null;
  }
  if (quoted && skill.scopes.includes("section"))
    return tail("dock.scopeNote.withQuote", "section");
  if (skill.scopes.includes("structure"))
    return tail("dock.scopeNote.structure", "structure");
  if (openWord === "part" && skill.scopes.includes("part"))
    return tail("dock.scopeNote.part", "part");
  return null;
}

export default function AiComposer({
  value,
  chatId,
  quote,
  pinned,
  disabled,
  running,
  waiting = false,
  onOpenContext,
  commands,
  names,
  openWord = "part",
  onPickCommand,
  onChange,
  onSubmit,
  onDropQuote,
  onUnpin,
  onStop,
}: AiComposerProps) {
  const { t, i18n } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const language = i18n.language?.startsWith("it") ? "it" : "en";
  const typed = typedCommand(value, commands, names, {
    language,
    quoted: Boolean(quote),
  });
  const ghost = typed?.ghost ?? null;
  // What a command that takes words still takes, spoken as the aria-hidden
  // ghost shows it: its own sentence, or the one for Enter sending the quote
  // in their place. Keyed by the command, so a new text command brings its
  // strings without an edit here.
  const described =
    typed?.runnable &&
    typed.skill.argument === "text" &&
    ghost?.kind === "describe"
      ? ghost.key === "dock.scope.quote"
        ? `dock.${typed.skill.command}.hintQuoteDescription`
        : `dock.${typed.skill.command}.hintDescription`
      : null;
  // Driven by the text, not a press, so this is local state rather than the
  // shared `useMenuAnchor`, whose only way in is a toggle from a clicked
  // element.
  const [commandAnchor, setCommandAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // Anchored to the pill, not the field inside it, so the list's edges line
    // up with the box the writer sees.
    setCommandAnchor(
      value === "/" && commands.length > 0 ? root.current : null,
    );
  }, [value, commands.length]);

  // Resolved once, so the field and the measure read the same string.
  const placeholder = t(
    commands.length > 0 ? "dock.askPlaceholderCommands" : "dock.askPlaceholder",
  );

  // `field-sizing: content` would do this in CSS but is Chrome-only. The cap
  // stays in CSS (`max-height`, with `overflow-y: auto` past it), so no
  // line-height arithmetic lives here to drift from the stylesheet.
  //
  // `height = "auto"` comes first: `scrollHeight` cannot report less than an
  // explicit height, so without the reset a shortened draft keeps the tallest
  // box it had. A layout effect, or the box resizes a frame after the
  // keystroke and visibly snaps.
  //
  // This measure stays apart from the kit's `useAutoGrow` (`ui/Input.tsx`),
  // which has no mirror and no grown flag.
  //
  // The measure also sets the grown flag. The `@` and Stop sit at the bottom
  // of a grown field, but at resting height a 30px button bottom-aligned in a
  // one-line row is unbalanced, so the row centres them until the field grows.
  //
  // The threshold is read from the stylesheet, from `line-height` and the
  // padding: the height one line of text occupies.
  //
  // The flag is written onto the node, like the height: routing it through
  // state would re-render the panel on every keystroke.
  const measure = useCallback(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    // The mirror too: a hint can wrap where the text alone would not at the
    // 340px dock floor, and a field shorter than its mirror clips the hint.
    const measured = Math.max(
      element.scrollHeight,
      mirror.current?.scrollHeight ?? 0,
    );
    element.style.height = `${measured}px`;
    const style = getComputedStyle(element);
    const oneLine =
      parseFloat(style.lineHeight) +
      parseFloat(style.paddingTop) +
      parseFloat(style.paddingBottom);
    // The tolerance absorbs subpixel rounding. A `line-height: normal` that
    // does not parse reads as not grown, the state that is right at rest. An
    // empty field is never grown, whatever its placeholder needs: the flag
    // positions the `@` and Stop against the writer's own text.
    if (root.current)
      root.current.dataset.grown =
        value !== "" && Number.isFinite(oneLine) && measured > oneLine + 1
          ? "1"
          : "0";
  }, [value]);

  // The placeholder is a dependency: `scrollHeight` counts an empty field's
  // placeholder, and it changes with the chat kind and the language without
  // the value changing. Without it, a longer placeholder wraps inside a
  // one-line box. The ghost is one too, as one string: it can wrap the field
  // on its own, and it changes on the same keystroke as the text, so the
  // height moves once.
  const ghostText =
    ghost?.kind === "describe" ? t(ghost.key) : (ghost?.rest ?? null);
  useLayoutEffect(measure, [measure, chatId, placeholder, ghostText]);

  // The width matters too, and no prop carries it: dragging the dock changes
  // how many lines the text needs, so an observer re-measures. It hears only
  // a change of the box's size; a webfont landing after first paint re-flows
  // the text without resizing the box, so it is not measured for here.
  useEffect(() => {
    const element = field.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div className="composer" ref={root}>
      {pinned.length > 0 ? (
        <ul className="composer-pins" aria-label={t("dock.pinnedSources")}>
          {pinned.map((source) => (
            <li key={source.id} className="composer-pin">
              <Icon name={appIcons.context} size={10} />
              {/* The whole title is the tooltip, because a chip clips a long
                  one. */}
              <span title={source.title}>{source.title}</span>
              <button
                type="button"
                aria-label={t("dock.unpin", { title: source.title })}
                onClick={() => onUnpin(source.id)}
              >
                <Icon name={appIcons.close} size={10} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {quote ? (
        <p className="composer-quote">
          <span>{quote}</span>
          <button
            type="button"
            aria-label={t("dock.dropQuote")}
            onClick={onDropQuote}
          >
            <Icon name={appIcons.close} size={11} />
          </button>
        </p>
      ) : null}
      <button
        type="button"
        className="ai-composer-menu"
        aria-label={t("dock.context")}
        aria-haspopup="dialog"
        onClick={onOpenContext}
      >
        <Icon name={appIcons.context} size={15} />
      </button>
      {typed ? (
        <div className="composer-mirror" ref={mirror} aria-hidden="true">
          {typed.lead}
          <span className={typed.runnable ? "composer-command" : undefined}>
            {typed.word}
          </span>
          {typed.after}
          {ghost?.kind === "describe" ? (
            // The bracketed phrase is one unit that drops whole to the next
            // line. The space before it stays outside the unit,
            // as a break point the field has too; inside it, the typed
            // keyword would wrap with the phrase while the field keeps it up,
            // and the caret would sit off its letters.
            <span className="composer-hint">
              {typed.after.endsWith(" ") ? "" : " "}
              <span className="composer-hint-unit">{`[${t(ghost.key)}]`}</span>
            </span>
          ) : ghost?.kind === "complete" ? (
            // A break point between what was typed and its completion. The
            // two are one word in the mirror, so near the line's end the
            // mirror would wrap all of it while the field, holding only the
            // typed letters, keeps them up, drawing them a line below the
            // caret.
            <>
              <wbr />
              <span className="composer-hint">{ghost.rest}</span>
            </>
          ) : null}
          {/* A pre-wrap box drops a final newline's empty line, which the
              field keeps; a zero-width space holds it, so the two stay the
              same height. */}
          {"​"}
        </div>
      ) : null}
      {described ? (
        <span id={hintId} className="ui-visually-hidden">
          {t(described)}
        </span>
      ) : null}
      <textarea
        ref={field}
        rows={1}
        value={value}
        className={typed ? "has-command" : undefined}
        aria-describedby={described ? hintId : undefined}
        aria-label={t("dock.ask")}
        placeholder={placeholder}
        spellCheck={false}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // Tab takes a completion and only a completion; without one it
          // leaves the field, as everywhere else.
          if (event.key === "Tab" && ghost?.kind === "complete") {
            event.preventDefault();
            onChange(value + ghost.rest);
            return;
          }
          if (
            event.key !== "Enter" ||
            event.shiftKey ||
            event.nativeEvent.isComposing
          )
            return;
          event.preventDefault();
          onSubmit();
        }}
      />
      {/* One button in one seat: Send at rest, Stop while a run is in flight.
          Enter stays the fast path; the button serves a pointer, and a phone
          keyboard whose Enter is a line break. Both are glyphs, with the
          words as their accessible names. Send is disabled with nothing to
          send (spaces alone, by the same trim `send` applies) and while there
          is no persona to ask. Enter during a run queues the next question;
          the button, by then Stop, does not. */}
      {running ? (
        <button
          type="button"
          // `is-running` draws the running edge and spark in `editor.css`
          // while the writer waits.
          className={waiting ? "ai-stop" : "ai-stop is-running"}
          aria-label={t("dock.stop")}
          onClick={onStop}
        >
          <Icon name={appIcons.stop} size={12} />
        </button>
      ) : (
        <button
          type="button"
          className="ai-stop is-send"
          aria-label={t("dock.send")}
          disabled={disabled || !value.trim()}
          onClick={onSubmit}
        >
          <Icon name={appIcons.send} size={14} />
        </button>
      )}
      {/* The command is the label: these are the words the writer types, so
          the menu teaches the language rather than itself. */}
      <Menu
        open={commandAnchor !== null}
        onClose={() => setCommandAnchor(null)}
        anchor={commandAnchor}
        placement="above-start"
        label={t("dock.commands")}
        items={commands.map((skill) => ({
          id: skill.command,
          label: `/${skill.command}`,
          // What each one does, always under it: a touch screen has no
          // hover, and bare command words read only to an expert.
          description: (
            <>
              {t(`dock.commandNote.${skill.command}`)}
              {scopeNote(skill, Boolean(quote), openWord, language, t)}
            </>
          ),
          onSelect: () => onPickCommand(skill),
        }))}
      />
    </div>
  );
}
