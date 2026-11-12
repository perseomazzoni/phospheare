// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  chatKindsField,
  parseFrontmatter,
  readsField,
  requireField,
  scopeKindsField,
  wordKindsField,
} from "./frontmatter";
import { ROOMS, sameRef } from "./rooms";
import { normaliseTyped, scopeKindOf, wideScope } from "./scope";
import { shapeOfWord } from "./structureShapes";
import {
  CHAT_KINDS,
  REVIEW_TASKS,
  type ChatKind,
  type MapShapeId,
  type ReadRef,
  type ReviewScope,
  type ReviewTask,
  type ScopeKind,
  type TurnCommand,
  type WordKind,
} from "./types";

// ── The editorial skills ─────────────────────────────────────────────────────
//
// One Markdown file per slash command, under `skills/`, read at build time.
// The folder is the list: adding a skill is adding a file, and there is no
// second table of names to keep in step with the first.
//
// These are application assets, not the writer's documents: they ship inside
// the bundle, they are never written to the writer's folder, and no surface
// offers to edit them. A command is a promise about what the assistant does
// when it is typed, and a promise the writer can rewrite in place is not one
// the product can keep.
//
// The instructions are English regardless of the book's language:
// the manuscript's own language reaches the model through the project's
// `document.language`, which is what the answer comes back in. One set of
// instructions means one behaviour, not one per locale, silently drifting.
//
// ── One file, one prompt ─────────────────────────────────────────────────────
//
// Five of the files declare a `reviewTask`, and those five are the review
// rubrics: `domain/policy.ts` reads them from here rather than holding a
// second copy. A command and the review it runs are the same editorial
// instruction, so they are the same file.
//
// `/summarise` declares no task, because summarising a section is a question
// with an answer rather than a sweep that produces findings. Its body is sent
// as the writer's own question at the scopes its workflow asks at (`asksAt`:
// the quote or the open Section, and `section`), and is the instruction the
// Part's account is composed by at `part`.

/** Every skill file, keyed by its path. */
const RAW = import.meta.glob<string>("./skills/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * What a command may take after its name: the writer's words
 * (`text`), or the name of one document the review reads (`reference`).
 * Above the skills, which are read from their files at module load.
 */
export const ARGUMENTS = ["text", "reference"] as const;
export type Argument = (typeof ARGUMENTS)[number];

/**
 * The interface languages a command's guide is written in. The guide is copy
 * the writer reads, so unlike the instruction it comes in
 * every language the interface speaks; `locales.test.ts` pins this list to
 * the app's own, so a third interface language fails the build until every
 * command has been given a guide in it.
 */
export const GUIDE_LANGUAGES = ["en", "it"] as const;
export type GuideLanguage = (typeof GUIDE_LANGUAGES)[number];

/** The three things a writer needs to know before running a command. */
export interface CommandGuide {
  /** What it does, and what comes back. */
  readonly what: string;
  /** The moment in the work it is for. */
  readonly when: string;
  /** What to type, point at or have written first. */
  readonly how: string;
}

const GUIDE_PARTS = ["what", "when", "how"] as const;

/** One editorial skill, reached by typing its command into the composer. */
export interface AiSkill {
  /**
   * The word after the slash, taken from the file name minus its ordering
   * prefix. `60-line-editing.md` is `/line-editing` and nothing else decides
   * that, so a command and the text behind it cannot drift apart.
   */
  readonly command: string;
  /**
   * The instruction. For a skill with a review task it is that review's
   * rubric; for one without, it is the question sent on the writer's behalf.
   */
  readonly instruction: string;
  /**
   * The review this command runs, when it runs one. Absent means the command
   * asks a question instead, or runs a `workflow` of its own; `/map`, which
   * takes `part` and `structure`, is the one without a task whose scope words
   * apply.
   */
  readonly reviewTask?: ReviewTask;
  /**
   * The chats that offer this command: `chats:` in the file, a comma list
   * read by the same strict reader personas use. Absent means Editorial.
   * Reader chats are never listed by a skill that reaches past a horizon:
   * `readSkill` refuses the file.
   */
  readonly chats: readonly ChatKind[];
  /**
   * The workflow of its own the command runs instead of a review or a
   * question: `workflow:` in the file. The app recognises
   * `/where` and `/map` by this, never by their names, so a command word is
   * the file's to choose and a second workflow is a file plus a case in
   * `actionOf`'s switch.
   */
  readonly workflow?: Workflow;
  /**
   * The command takes the rest of the line as its argument: `argument: text`
   * in the file. `/where the car crash happens` is one command and one
   * sentence, not a word parse that fails. Only a skill that declares it
   * reads free text; every other command keeps the strict parse, so an
   * ordinary sentence can never become a whole-structure run by accident.
   *
   * `argument: reference` is the other kind: after any scope, the
   * name of one of the documents the review reads (`/canon Marta`, `/canon
   * part Key Locations`), resolved against the names the caller hands the
   * parse. Never free text, so a tail that names nothing is refused rather
   * than read as a question the writer did not mean to ask.
   */
  readonly argument?: Argument;
  /**
   * The scope words it offers after its name: `scopes:` in the file.
   * Typing nothing is always offered and reads the command's bare scope
   * (`bareScope`). A word the command does not list is not a scope for it,
   * and not a title either, so the line stays a question. A command with
   * none offers no titles: a title is a scope.
   */
  readonly scopes: readonly ScopeKind[];
  /**
   * The references and notes it reads besides the prose, in priority order:
   * `reads:` in the file, with the Editing brief put first for every review.
   * The run attaches them whole, in this order, while the window
   * has room; what does not fit is named on the coverage, never cut short.
   * Empty for a command that runs no review.
   */
  readonly reads: readonly ReadRef[];
  /**
   * The word counts its run prints beside the rows: `words:` in the file.
   * The key is the switch: absent, the run prints none, so a count
   * reaches a model only because a file asked for it, and only a command
   * whose run prints counts may declare it: a workflow whose `WORKFLOWS`
   * entry says `words` (`/map`'s rows), or a review read by the Sections
   * engine (its `LENGTHS` block, never the line sweep).
   */
  readonly words?: readonly WordKind[];
  /**
   * The documents the command cannot do its job without: `needs:` in the
   * file. The command is refused, before anything is sent, while the writer
   * has written none of them (an untouched template counts as unwritten,
   * `isUnwritten`), and the panel offers to open each, so the writer fills
   * one in and comes back. At least one, not all: `/intent` can measure the
   * draft against a promise alone, and refusing it until the theme was
   * written too would be nagging. Empty for a command that needs nothing.
   */
  readonly needs: readonly ReadRef[];
  /**
   * `evidence: rooms`: the command reads what this book's other chats found
   * (`roomEvidence`): the beta readers' journals, an alpha reader's reaction
   * to the intent, the persona notes the writer kept in the margin.
   * An editor's alone, by the direction rule (reader output flows to the
   * editor and nothing flows into a reader), so any other chat refuses the
   * file at build time.
   */
  readonly evidence?: "rooms";
  /**
   * `target: opening`: the command reads the book's first Section rather
   * than the one open (`/first-pages`: the opening as an agent reads it,
   * wherever the writer happens to be standing). A question's alone.
   */
  readonly target?: "opening";
  /**
   * The obsession domains the skill's method serves: `lenses:` in the file,
   * a comma list of domain letters (`obsessions.md`: `F` is Prose, `I`
   * Continuity). How a persona knows which skills its own obsessions call
   * for: a voice whose preset watches rhythm and echoes is told that
   * `/line-editing` is its method. Empty for a skill no obsession leads to.
   */
  readonly lenses: readonly string[];
  /**
   * The guide shown above the composer while the command is typed:
   * `guide.<language>.<what|when|how>:` in the command's own file, every one
   * required, so a command cannot ship without telling the writer how to use
   * it. Beside the instruction and never inside it: it is not sent to any
   * model.
   */
  readonly guide: Readonly<Record<GuideLanguage, CommandGuide>>;
}

/**
 * One domain letter of `obsessions.md`. Above the registry, which reads
 * every file at module load.
 */
const LENS = /^[A-M]$/;

/**
 * What the writer asked of every review (the choices to respect and the
 * help they want), so every review reads it first. Added here rather than
 * listed in each file: a review file that forgot the line would silently
 * ignore what the writer said they wanted, and nothing would fail.
 */
export const EDITING_BRIEF: ReadRef = {
  group: "guidebook",
  sectionId: "editing-brief",
};

/**
 * What each workflow asks of the file that declares it, checked at build
 * time, so a file that promises a workflow it cannot run fails here, named.
 * `bare` is the scope typing the command alone means: `/map` reads summaries
 * rather than prose, so its nearest scope is the whole Structure, and
 * `current` keeps its one meaning (the quote or the open Section). `shapes`
 * is whether a shape word may close the line (`/map part hero`).
 * `words` is whether its run prints the counts a `words:` key asks for:
 * `/map`'s rows do; `/where`'s ranking does not. `asks` is the scopes at
 * which the command is still asked as a question rather than run as its
 * workflow (`asksAt`): `/summarise` of the quote or the open Section is a
 * plain question, and only its `part` composes. `titles` narrows the titles
 * the composer completes after it to one kind (`completesTitle`): another
 * Section's title is refused, so offering one would complete a line Enter
 * refuses.
 */
const WORKFLOWS = {
  locate: { argument: true, scopes: false, shapes: false, words: false },
  map: {
    argument: false,
    scopes: true,
    shapes: true,
    words: true,
    bare: { kind: "structure" },
  },
  summarise: {
    argument: false,
    scopes: true,
    shapes: false,
    words: false,
    asks: ["current", "section"],
    titles: "part",
  },
  // `/verify`: the claim is the writer's own words, as `/where`'s
  // description is, and the quote may stand for it.
  verify: { argument: true, scopes: false, shapes: false, words: false },
  // A beta reader's journal: `/read-on` reads the next Section in order,
  // `/predict` writes down what it expects before it does. Neither takes
  // words nor a scope: the reader's position decides what is read, never the
  // writer's pointing, or the predictions would stop being blind.
  journal: { argument: false, scopes: false, shapes: false, words: false },
  predict: { argument: false, scopes: false, shapes: false, words: false },
} as const satisfies Record<
  string,
  {
    argument: boolean;
    scopes: boolean;
    shapes: boolean;
    words: boolean;
    bare?: ReviewScope;
    asks?: readonly ReviewScope["kind"][];
    titles?: "part";
  }
>;

export type Workflow = keyof typeof WORKFLOWS;

/** The workflows a reader chat may run: its own journal, and nothing wider. */
export const READER_WORKFLOWS: readonly Workflow[] = ["journal", "predict"];

/**
 * The skills, in the order of the numeric prefixes on their files: from the
 * widest question to the narrowest, and then each room's own. It is not the
 * menu's order, which is alphabetical (`skillsFor`). The prefixes give the
 * registry one fixed order, so nothing downstream depends on how a bundler
 * hands the glob back.
 */
export const aiSkills: readonly AiSkill[] = Object.entries(RAW)
  .sort(([a], [b]) => bySkillFile(a, b))
  .map(([path, text]) => readSkill(path, text));

/**
 * The prefixes compared as numbers: a plain string sort puts `100-` before
 * `20-`.
 */
export function bySkillFile(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * One skill file, read strictly: every declared value is checked, and a file
 * that says something this app cannot do throws at build time, naming it.
 */
export function readSkill(path: string, text: string): AiSkill {
  const parsed = parseFrontmatter(path, text);
  const task = parsed.fields.get("reviewTask");
  if (task !== undefined && !(REVIEW_TASKS as readonly string[]).includes(task))
    throw new Error(`${path}: unknown review task "${task}"`);
  const argument = parsed.fields.get("argument");
  if (
    argument !== undefined &&
    !(ARGUMENTS as readonly string[]).includes(argument)
  )
    throw new Error(`${path}: argument must be one of ${ARGUMENTS.join(", ")}`);
  const workflow = parsed.fields.get("workflow");
  if (
    workflow !== undefined &&
    !Object.prototype.hasOwnProperty.call(WORKFLOWS, workflow)
  )
    throw new Error(`${path}: unknown workflow "${workflow}"`);
  if (workflow !== undefined && task !== undefined)
    throw new Error(`${path}: a command runs a review or a workflow, not both`);
  if (workflow !== undefined) {
    const needs = WORKFLOWS[workflow as Workflow];
    if (needs.argument !== (argument === "text"))
      throw new Error(
        `${path}: workflow "${workflow}" ${needs.argument ? "takes" : "takes no"} text`,
      );
    if (needs.scopes !== parsed.fields.has("scopes"))
      throw new Error(
        `${path}: workflow "${workflow}" ${needs.scopes ? "declares" : "takes no"} scopes`,
      );
  }
  // A review reads a scope, never the writer's words: text on one would be
  // parsed and then dropped, which is a silent promise. A question
  // may take text (`/how-to-say`), and a workflow's `WORKFLOWS` entry says
  // whether it does.
  if (argument === "text" && task !== undefined)
    throw new Error(`${path}: a review takes no text`);
  // Free text and scope words cannot share a line: which one would
  // "/where section" be? A reference can: it is a name, matched exactly
  // after the scope (`/canon part Marta`), never the rest of a sentence.
  if (argument === "text" && parsed.fields.has("scopes"))
    throw new Error(`${path}: a command takes an argument or scopes, not both`);
  // A reference is one of the documents a review reads: a question or a
  // workflow attaches none, so a name typed after one would be read by
  // nothing (a silent promise, as a question's `reads` would be).
  if (
    argument === "reference" &&
    (task === undefined || workflow !== undefined)
  )
    throw new Error(`${path}: only a review takes a reference`);
  const reads = parsed.fields.has("reads")
    ? readsField(path, parsed, "reads")
    : [];
  // A review attaches its reads to every sweep, and a question to its one
  // turn, beside the room's own (`/scene-plan` reads the cast and the
  // places). A workflow attaches none, since its run builds its own request,
  // so its reads would be read by nothing, which is a silent promise.
  if (reads.length > 0 && workflow !== undefined)
    throw new Error(`${path}: a workflow command reads no references`);
  // The brief's one home is `EDITING_BRIEF`, so a review listing it is a
  // second home that would drift.
  if (
    task !== undefined &&
    reads.some((one) => one.sectionId === EDITING_BRIEF.sectionId)
  )
    throw new Error(`${path}: every review reads the Editing brief already`);
  // A reference is named from what the file declares it reads; with nothing
  // declared there is nothing to name.
  if (argument === "reference" && reads.length === 0)
    throw new Error(`${path}: a reference is named from the file's reads`);
  const words = parsed.fields.has("words")
    ? wordKindsField(path, parsed, "words")
    : undefined;
  // A count asked of a run that prints none is a silent promise, as a
  // question's `reads` would be. A workflow says whether its run prints
  // them; a review's Sections engine prints its `LENGTHS` block, but the
  // line sweep reads each Section alone and prints none, and so does a
  // review that offers no scope past one Section, since the block is built
  // only for a Part or the Structure.
  const scopes = parsed.fields.has("scopes")
    ? scopeKindsField(path, parsed, "scopes")
    : [];
  const chats = parsed.fields.has("chats")
    ? chatKindsField(path, parsed, "chats")
    : (["editorial"] as const);
  // A reader's command is the reader rooms' alone, and reaches nothing the
  // reader's horizon does not already hold: no scope a writer could point
  // past the horizon with, no words of the writer's to carry, no review
  // (which reads the book at a scope of its own), and of the workflows only
  // the reader's own, whose runs check the horizon they read under. The run
  // still checks it (`readerBoundary`); this is the first of the two layers,
  // so a file that promised a reader more than a reader may have fails here,
  // at build time, naming itself.
  const readerChats = chats.filter(
    (kind) => kind === "alpha-reader" || kind === "beta-reader",
  );
  if (readerChats.length > 0) {
    if (readerChats.length !== chats.length)
      throw new Error(
        `${path}: a reader's command is offered to readers alone`,
      );
    if (task !== undefined) throw new Error(`${path}: a reader runs no review`);
    if (argument !== undefined || scopes.length > 0)
      throw new Error(
        `${path}: a reader's command takes no words and no scope`,
      );
    if (
      workflow !== undefined &&
      !(READER_WORKFLOWS as readonly string[]).includes(workflow)
    )
      throw new Error(`${path}: workflow "${workflow}" is not a reader's`);
  }
  const needs = parsed.fields.has("needs")
    ? readsField(path, parsed, "needs")
    : [];
  // A reader can only be refused for, or read, what it could ever see: a
  // need past its room's extras would refuse it forever, since the horizon
  // hides the very document the refusal asks the writer to write, and a read
  // past them would be dropped by the boundary, a silent promise.
  for (const kind of readerChats)
    for (const need of [...needs, ...reads])
      if (!ROOMS[kind].readerExtras.some((one) => sameRef(one, need)))
        throw new Error(
          `${path}: a ${kind} cannot see "${need.group}${need.sectionId ? `:${need.sectionId}` : ""}"`,
        );
  const evidence = parsed.fields.get("evidence");
  if (evidence !== undefined) {
    if (evidence !== "rooms")
      throw new Error(`${path}: evidence must be "rooms"`);
    if (chats.length !== 1 || chats[0] !== "editorial")
      throw new Error(
        `${path}: only an Editorial command reads the other chats`,
      );
  }
  const guide = Object.fromEntries(
    GUIDE_LANGUAGES.map((language) => [
      language,
      Object.fromEntries(
        GUIDE_PARTS.map((part) => [
          part,
          requireField(path, parsed, `guide.${language}.${part}`),
        ]),
      ) as unknown as CommandGuide,
    ]),
  ) as Record<GuideLanguage, CommandGuide>;
  const target = parsed.fields.get("target");
  if (target !== undefined && target !== "opening")
    throw new Error(`${path}: target must be "opening"`);
  // Both change what a question's one turn reads; a review and a workflow
  // build their own requests and would read neither, a silent promise.
  if (
    (evidence !== undefined || target !== undefined) &&
    (task !== undefined || workflow !== undefined)
  )
    throw new Error(`${path}: only a question reads evidence or a target`);
  if (target !== undefined && readerChats.length > 0)
    throw new Error(`${path}: a reader reads where its horizon says`);
  const printsWords =
    workflow !== undefined
      ? WORKFLOWS[workflow as Workflow].words
      : task !== undefined &&
        task !== "line" &&
        scopes.some((one) => one === "part" || one === "structure");
  if (words !== undefined && !printsWords)
    throw new Error(`${path}: this command prints no word counts`);
  const lenses = (parsed.fields.get("lenses") ?? "")
    .split(",")
    .map((one) => one.trim())
    .filter(Boolean);
  for (const lens of lenses)
    if (!LENS.test(lens))
      throw new Error(`${path}: "${lens}" is not an obsession domain letter`);
  // A workflow is never a method the model uses (`autonomousSkills`), so a
  // lens on one would lead a persona to a skill it cannot pick up.
  if (lenses.length > 0 && workflow !== undefined)
    throw new Error(`${path}: a workflow serves no lens`);
  return {
    command: path
      .slice(path.lastIndexOf("/") + 1)
      .replace(/\.md$/, "")
      .replace(/^\d+-/, ""),
    instruction: parsed.body,
    ...(task ? { reviewTask: task as ReviewTask } : {}),
    ...(workflow ? { workflow: workflow as Workflow } : {}),
    chats,
    ...(argument ? { argument: argument as Argument } : {}),
    scopes,
    reads: task ? [EDITING_BRIEF, ...reads] : reads,
    ...(words ? { words } : {}),
    needs,
    ...(evidence ? { evidence: "rooms" as const } : {}),
    ...(target ? { target: "opening" as const } : {}),
    lenses,
    guide,
  };
}

/**
 * The skills a persona may pick up on its own in a chat of this kind:
 * the kind's commands whose method is an instruction and nothing else, a
 * review's rubric or a question. A workflow is never one: `/where`, `/map`,
 * `/summarise`, `/verify`, `/read-on` and `/predict` each run a pipeline of
 * their own, and some write (a summary, a journal, a prediction) or ask the
 * writer first (a search), which is the writer's to start. Commands still
 * follow the kind: a persona never reaches a skill its chat does not offer,
 * and points to the chat that has one instead.
 */
export function autonomousSkills(kind: ChatKind): AiSkill[] {
  return skillsFor(kind).filter((skill) => skill.workflow === undefined);
}

/**
 * The commands a chat of this kind offers, in menu order: alphabetical by
 * command, because with many commands a writer looks a word up rather than
 * reading down a list. The command words are the same in every interface
 * language, so one fixed comparison serves them all; a locale's collation
 * could move a command about under a writer switching language.
 */
export function skillsFor(
  kind: ChatKind,
  skills: readonly AiSkill[] = aiSkills,
): AiSkill[] {
  return skills
    .filter((skill) => skill.chats.includes(kind))
    .sort((a, b) =>
      a.command < b.command ? -1 : a.command > b.command ? 1 : 0,
    );
}

/** The skill a typed command names exactly, or null; a prefix never matches. */
export function skillFor(
  command: string,
  skills: readonly AiSkill[] = aiSkills,
): AiSkill | null {
  const wanted = command.replace(/^\//, "");
  return skills.find((skill) => skill.command === wanted) ?? null;
}

/**
 * The one skill that runs `workflow`, which must ship: `/where`'s body is the
 * question each passage is judged by and `/map`'s the one each row is placed
 * by, so a missing or doubled file fails here, at build time, rather than as
 * a model answering nothing.
 */
export function workflowSkill(
  workflow: Workflow,
  skills: readonly AiSkill[] = aiSkills,
): AiSkill {
  const found = skills.filter((skill) => skill.workflow === workflow);
  if (found.length !== 1)
    throw new Error(
      `skills/: ${found.length} files run workflow "${workflow}"`,
    );
  return found[0];
}

export const whereSkill: AiSkill = workflowSkill("locate");
export const mapSkill: AiSkill = workflowSkill("map");
export const summariseSkill: AiSkill = workflowSkill("summarise");
export const verifySkill: AiSkill = workflowSkill("verify");
export const readOnSkill: AiSkill = workflowSkill("journal");
export const predictSkill: AiSkill = workflowSkill("predict");

/** Whether a chat of this kind offers the command that runs `workflow`. */
export function offersWorkflow(
  kind: ChatKind,
  workflow: Workflow,
  skills: readonly AiSkill[] = aiSkills,
): boolean {
  return skillsFor(kind, skills).some((skill) => skill.workflow === workflow);
}

/**
 * What typing a command runs: the one question every dispatch site asks, as
 * a switch with a `never` default, so a new workflow is a compile
 * error at each site rather than a silent fall-through into "a question".
 */
export function actionOf(skill: AiSkill): "review" | "question" | Workflow {
  return skill.reviewTask ? "review" : (skill.workflow ?? "question");
}

/**
 * Whether an attached quote may stand for the words this command takes, so
 * the command runs bare over one: a question command's quote
 * is its argument (`/how-to-say` over a quote asks for other
 * ways to put it), and `/verify`'s is the claim to check. `/where`'s words
 * are a description of a moment, which a quote is not.
 */
export function quoteIsArgument(skill: AiSkill): boolean {
  const action = actionOf(skill);
  return action === "question" || action === "verify";
}

/**
 * Whether typing `skill` at `scope` asks a question (the rubric sent as the
 * writer's words) rather than running its review or workflow. A
 * question command asks at every scope; a workflow at
 * the scopes its `WORKFLOWS` entry lists as `asks` (`/summarise` of the quote
 * or the open Section). The one reader of that data, so a stored
 * `/summarise` keeps its command wherever it is read.
 */
export function asksAt(skill: AiSkill, scope: ReviewScope): boolean {
  if (actionOf(skill) === "question") return true;
  const needs = skill.workflow ? WORKFLOWS[skill.workflow] : undefined;
  return (
    needs !== undefined &&
    "asks" in needs &&
    (needs.asks as readonly string[]).includes(scope.kind)
  );
}

/**
 * The command a lone `/word` that names none most likely meant, and the chat
 * kind that offers it: this chat's own first, then the others in their
 * order. "Near" is one name starting with the other, then containing it. A
 * line that names no skill is a question (`parseCommand`), but a lone
 * slash-word is never one, and the writer is owed the command they were
 * reaching for.
 */
export function nearestCommand(
  typed: string,
  kind: ChatKind,
  skills: readonly AiSkill[] = aiSkills,
): { skill: AiSkill; kind: ChatKind } | null {
  const word = typed.trim().replace(/^\//, "").toLocaleLowerCase();
  if (!word) return null;
  const rooms = [kind, ...CHAT_KINDS.filter((one) => one !== kind)];
  const tests = [
    (name: string) => name.startsWith(word) || word.startsWith(name),
    (name: string) => name.includes(word),
  ];
  for (const near of tests)
    for (const room of rooms) {
      const skill = skillsFor(room, skills).find((one) => near(one.command));
      if (skill) return { skill, kind: room };
    }
  return null;
}

/**
 * The skill whose file holds the rubric for one review task and also owns
 * its command.
 *
 * Every task has exactly one skill, and `skills.test.ts` fails otherwise: a
 * review with no rubric would run with the persona's voice and no
 * instructions at all, a failure that looks like a bad model rather than a
 * missing file.
 */
export function skillForReviewTask(task: ReviewTask): AiSkill | null {
  return aiSkills.find((skill) => skill.reviewTask === task) ?? null;
}

/**
 * What a review of this task reads besides the prose: its file's `reads`,
 * the Editing brief first. A named reference narrows it in one place,
 * `selectReferences`: to the named set, which must be among these reads, and
 * the brief.
 */
export function readsFor(task: ReviewTask): readonly ReadRef[] {
  return skillForReviewTask(task)?.reads ?? [];
}

/**
 * Whether `task`'s command takes a named reference. What decides
 * whether a stored name is honoured at all: a chat file or a plan that
 * claims one for any other task is claiming what no command typed.
 */
export function namesReference(task: ReviewTask): boolean {
  return skillForReviewTask(task)?.argument === "reference";
}

/**
 * Whether a review answer may be summarised-and-reviewed again: a
 * wide scope its command offers, on a task that maps over summaries. The
 * pair comes from a chat file, where a real task and a real scope can be
 * put together in a way no command would type: `/line-editing` offers no
 * `structure`, and a line sweep reads each Section alone, so a summary
 * written for it is prose sent to the model for nothing. The
 * button and the run both ask this, so neither offers what the other refuses.
 */
export function offersReviewAgain(
  task: ReviewTask,
  scope: ReviewScope,
): boolean {
  if (task === "line" || !wideScope(scope)) return false;
  const word = scope.kind === "structure" ? "structure" : "part";
  return skillForReviewTask(task)?.scopes.includes(word) ?? false;
}

/**
 * A command as the writer typed it, resolved: which skill, and either how much
 * it reads or, for a skill that takes one, the rest of the line.
 *
 * An empty argument is still a command, never a question: `/where` alone is
 * the writer halfway through asking, and sending it as a question would spend
 * a model run on the word "/where". The panel holds it instead.
 */
export type AiCommand =
  | {
      readonly kind: "scoped";
      readonly skill: AiSkill;
      readonly scope: ReviewScope;
      /**
       * The shape the writer typed after the scope, for a workflow that takes
       * one (`/map`); absent means the project's declared shape.
       */
      readonly shape?: MapShapeId;
      /**
       * The documents a reference the writer named stands for: a
       * set, because a character names its sheet and its arc. Absent means
       * every document the review reads, never `[]`, which would read as
       * "none".
       */
      readonly references?: readonly string[];
    }
  | {
      readonly kind: "text";
      readonly skill: AiSkill;
      readonly argument: string;
    }
  | {
      /**
       * A command that takes a reference, with a tail that names none of
       * them: refused before anything is sent, the words given back,
       * never a question, and never every reference instead. The writer
       * plainly meant the command, and a question would run it on nothing
       * they named.
       */
      readonly kind: "unknown-reference";
      readonly skill: AiSkill;
      /** What the writer typed where a name was expected. */
      readonly typed: string;
    };

/**
 * What a question command sends, and what the writer typed: the one
 * composition, so the codec keeps a replayed `command` only while it still
 * composes the stored text. The rubric first; then, on a command that takes
 * text, the writer's words last as `MEANING:`, next to where the model starts
 * writing. They are JSON-quoted, so they arrive as delimited data in the user
 * channel and never read as part of the instruction. An empty argument adds
 * nothing.
 */
export function questionOf(
  skill: AiSkill,
  argument?: string,
): { text: string; command: TurnCommand } {
  const said = skill.argument === "text" ? (argument ?? "").trim() : "";
  return {
    text: said
      ? `${skill.instruction}\n\nMEANING: ${JSON.stringify(said)}`
      : skill.instruction,
    command: { skill: skill.command, ...(said ? { argument: said } : {}) },
  };
}

/**
 * A command as the writer typed it: `/how-to-say …`, `/summarise`, and the
 * stored question of a workflow that takes words (`/where …`, `/verify …`).
 */
export function commandLine(command: TurnCommand): string {
  return command.argument
    ? `/${command.skill} ${command.argument}`
    : `/${command.skill}`;
}

/**
 * The words after a stored `commandLine` of `skill`, or null when the line
 * is not one: `""` for the command alone (a bare `/verify` over a quote).
 * `commandLine`'s other half, for a workflow asked again from its stored
 * question (Retry, "Search again"): a plain prefix read, not `parseCommand`,
 * which needs the book's names, and a stored line does not carry them. The
 * space is part of the prefix, so `/whereabouts` is never `/where`.
 */
export function commandArgument(line: string, skill: AiSkill): string | null {
  const bare = `/${skill.command}`;
  if (line === bare) return "";
  return line.startsWith(`${bare} `) ? line.slice(bare.length + 1) : null;
}

/**
 * Whether a shape word may close this command's line (`/map part hero`),
 * for the composer, which completes one only where the parser would take it.
 */
export function takesShape(skill: AiSkill): boolean {
  return skill.workflow !== undefined && WORKFLOWS[skill.workflow].shapes;
}

/** What the command typed alone reads: its workflow's `bare`, or `current`. */
export function bareScope(skill: AiSkill): ReviewScope {
  const needs = skill.workflow ? WORKFLOWS[skill.workflow] : undefined;
  return needs && "bare" in needs ? needs.bare : { kind: "current" };
}

/** A Part or Section a title can name: its id, and the title as shown. */
export interface NamedNode {
  readonly id: string;
  readonly title: string;
  /** Which it is, for the one command whose completion takes one kind. */
  readonly kind?: "part" | "section";
}

/**
 * Whether the composer completes `node`'s title after this command: any
 * node for a scoped command, but only a Part after `/summarise`.
 * The parse still reads a Section's title there, to refuse it with the one
 * remedy, and the open Section's own title runs as `section`.
 */
export function completesTitle(skill: AiSkill, node: NamedNode): boolean {
  if (skill.scopes.length === 0) return false;
  const needs = skill.workflow ? WORKFLOWS[skill.workflow] : undefined;
  return !(needs && "titles" in needs) || node.kind === needs.titles;
}

/**
 * A reference a command can name: the name as the writer may type
 * it, and the documents it stands for, built by the caller, which
 * knows the labels the writer sees; the parse only matches.
 */
export interface NamedReference {
  readonly name: string;
  readonly ids: readonly string[];
}

/**
 * Everything a typed line may name, built once by the caller from its live
 * catalogue and read by the parse and the completion alike, so the two
 * cannot disagree.
 */
export interface CommandNames {
  readonly nodes: readonly NamedNode[];
  readonly references: readonly NamedReference[];
}

/** Nothing to name: a parse with no catalogue reads scope words only. */
export const NO_NAMES: CommandNames = { nodes: [], references: [] };

/**
 * Read `/continuity`, `/continuity structure`, `/continuity sezione` or
 * `/continuity The Harbour` out of what is in the composer, for
 * `/map` a shape word after any of them (`/map part hero`), and for a
 * command that takes a reference, a name after the scope (`/canon part
 * Marta`).
 *
 * The nearest scope is the default for a review, and it is the one that
 * costs nothing to be wrong about: the quote or the open Section is quick
 * and cheap, and the whole Structure is minutes of the writer's local model.
 * The word is how they ask for the expensive one, so it is never given by
 * accident. A workflow's own bare scope is its `WORKFLOWS` entry's.
 *
 * After the command word, in this order: nothing is the bare scope
 * (`bareScope`: `current`, or the workflow's own); otherwise the typed scope
 * (`scopeOf`). Only when that finds nothing does the tail mean more: for a
 * command that takes a reference, a scope and then a name
 * (`referenceCommand`); for one that takes a shape, a last word that names
 * one is taken off and the scope read again from what is left. So the
 * order is the scope word, then the exact title, then the shape: a line
 * that parses without a shape keeps its meaning, and only one that parses
 * to nothing gains one. A title that ends in a shape's word is still the
 * title: "The Hero" is a Part before it is a scope and a shape. One word is
 * taken off, never two.
 *
 * Returns null for anything it does not recognise: the writer is typing
 * into a field for asking questions, and a question that happens to begin
 * with a slash, or that names no skill, or names nothing after it, is a
 * question. Guessing at it would make the field unpredictable in the one
 * direction that matters, where a sentence silently becomes a run over the
 * whole Structure. The one exception is a command that takes a reference
 * and was handed a name the book does not hold: `unknown-reference`, refused
 * rather than asked.
 *
 * It runs on every keystroke, so every title and name is normalised once
 * per parse (`indexOf`), never once per place the tail might split.
 */
export function parseCommand(
  text: string,
  skills: readonly AiSkill[] = aiSkills,
  names: CommandNames = NO_NAMES,
): AiCommand | null {
  const trimmed = text.trim();
  const word = /^\S+/.exec(trimmed)?.[0] ?? "";
  if (!word.startsWith("/")) return null;
  const skill = skillFor(word, skills);
  if (!skill) return null;
  const rest = trimmed.slice(word.length).trim();
  if (skill.argument === "text") return { kind: "text", skill, argument: rest };
  if (!rest) return { kind: "scoped", skill, scope: bareScope(skill) };
  const titles = indexOf(names.nodes, (node) => node.title);
  const named = scopeOf(skill, rest, titles);
  if (named) return { kind: "scoped", skill, scope: named };
  if (skill.argument === "reference")
    return referenceCommand(skill, rest, titles, names.references);
  if (!takesShape(skill)) return null;
  const last = /\S+$/.exec(rest)?.[0] ?? "";
  const shape = shapeOfWord(last);
  if (!shape) return null;
  const before = rest.slice(0, rest.length - last.length).trim();
  const scope = before ? scopeOf(skill, before, titles) : bareScope(skill);
  return scope ? { kind: "scoped", skill, scope, shape } : null;
}

/**
 * A scope and then a name, for a command that takes a reference,
 * tried only once the whole tail is no scope, so every line that parses as
 * a scope keeps its meaning. In order:
 * 1. the whole tail as a name, at the bare scope;
 * 2. a first scope word the command offers, then a name; the scope word
 *    beats a title, as it does everywhere;
 * 3. a title, then a name, only when exactly one split of the tail makes
 *    both exact, since two readings are a guess. Tried even when the tail
 *    opens with a scope word and (2) found no name, because "Part Two" and
 *    "Parte seconda" are among the commonest titles there are.
 * Anything else names nothing, and is refused with what the writer typed
 * where the name should be: after an offered scope word, what follows it;
 * otherwise the whole tail.
 */
function referenceCommand(
  skill: AiSkill,
  rest: string,
  titles: Index<NamedNode>,
  references: readonly NamedReference[],
): AiCommand {
  const refs = indexOf(references, (one) => one.name);
  const whole = referenceOf(rest, refs);
  if (whole)
    return {
      kind: "scoped",
      skill,
      scope: bareScope(skill),
      references: whole,
    };
  const first = /^\S+/.exec(rest)?.[0] ?? "";
  const kind = scopeKindOf(first);
  const offered = kind !== null && skill.scopes.includes(kind);
  const tail = rest.slice(first.length).trim();
  if (offered) {
    const named = referenceOf(tail, refs);
    if (named)
      return { kind: "scoped", skill, scope: { kind }, references: named };
  }
  // The scope word's own split cannot count twice: (2) already found no
  // name after it.
  const splits: { scope: ReviewScope; references: readonly string[] }[] = [];
  for (const space of rest.matchAll(/\s+/g)) {
    const at = space.index ?? 0;
    const scope = scopeOf(skill, rest.slice(0, at), titles);
    const named = scope && referenceOf(rest.slice(at), refs);
    if (scope && named) splits.push({ scope, references: named });
  }
  if (splits.length === 1) return { kind: "scoped", skill, ...splits[0] };
  return { kind: "unknown-reference", skill, typed: offered ? tail : rest };
}

/** Entries by their normalised name, built once per parse. */
type Index<T> = ReadonlyMap<string, readonly T[]>;

function indexOf<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
): Index<T> {
  const index = new Map<string, T[]>();
  for (const item of items) {
    const key = normaliseTyped(nameOf(item));
    const same = index.get(key);
    if (same) same.push(item);
    else index.set(key, [item]);
  }
  return index;
}

/**
 * The one entry `text` names exactly after `normaliseTyped`, or null; two
 * entries with that name name neither. An empty name is none.
 */
function soleOf<T>(text: string, index: Index<T>): T | null {
  const typed = normaliseTyped(text);
  const named = typed ? index.get(typed) : undefined;
  return named?.length === 1 ? named[0] : null;
}

/** The documents `text` names, or null; a name standing for none is null. */
function referenceOf(
  text: string,
  references: Index<NamedReference>,
): readonly string[] | null {
  const named = soleOf(text, references);
  return named && named.ids.length > 0 ? named.ids : null;
}

/**
 * How much of the book `text` names for `skill`: a scope word the command
 * offers, in either language, or one node by exact title after
 * `normaliseTyped`; two nodes with that title name neither. A scope word it
 * does not offer is nothing, never a title. Resolving here, from the
 * Structure the caller hands in, keeps a typed title out of everything
 * downstream: only the id is held, stored or run. With no titles, no title
 * matches.
 */
function scopeOf(
  skill: AiSkill,
  text: string,
  titles: Index<NamedNode>,
): ReviewScope | null {
  const kind = scopeKindOf(text);
  if (kind) return skill.scopes.includes(kind) ? { kind } : null;
  if (skill.scopes.length === 0) return null;
  const named = soleOf(text, titles);
  return named ? { kind: "node", nodeId: named.id } : null;
}
