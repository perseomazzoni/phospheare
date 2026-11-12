// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { trustedHtml } from "../../security/trustedHtml";
import { slotted } from "../components/slotted";
import { Banner, Button, Icon } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import { useTimeWords } from "../../ui/useTimeWords";
import { answerEnv, markdown } from "../components/safeMarkdown";
import { mendTables } from "../../ai/domain/answerForm";
import AiWebSources from "./AiWebSources";
import type { WebCitations } from "../../ai/domain/webCitations";
import AiTrace from "./AiTrace";
import { RunLine } from "./runStatus";
import { traceFacts } from "../../ai/domain/trace";
import { citableTitles } from "../../ai/domain/citations";
import { titleOf, turnAsText } from "./turnText";
import Widen, {
  blockedOf,
  summariseTransit,
  widenState,
} from "../components/Widen";
import AiMapAnswer from "./AiMapAnswer";
import AiVerifyAnswer from "./AiVerifyAnswer";
import { AiJournalEntry } from "./AiReading";
import { settledVerdict } from "./verifyAnswer";
import type { LiveStructure } from "./mapAnswer";
import { formatWhen } from "../components/datetime";
import { keyRemedy, type KeyVerdict } from "./keyVerdict";
import type { AssistantSnapshot } from "../../ai/application/assistant";
import {
  isCoverageSkipReason,
  type ChatTurn,
  type EvidenceAnchor,
  type Finding,
  type ChatRoute,
  type JournalEntry,
  type Prediction,
  type LocateOutcome,
  type MapShapeId,
  type ModelRef,
  type ReviewScope,
} from "../../ai/domain/types";
import { offerableRows, summaryBlockLifted } from "../../ai/domain/sourceView";
import { commandLine, offersReviewAgain } from "../../ai/domain/skills";

// ── One message ──────────────────────────────────────────────────────────────
//
// No eyebrow over a message: the layout already says which bubble is the
// writer's and which is the answer. Who answered is in the receipts line,
// with the turn's other facts. It is resolved by id against the installed
// personas rather than read off the turn: a chat file stores `personaId` and
// never a name, so renaming a persona reaches every message it ever wrote.
//
// ── The footer ───────────────────────────────────────────────────────────────
//
// One line of facts and one caret, because what a writer wants to know is
// "where did this come from", once. The facts come in the order they answer
// it: who spoke, what it cost, what it read, what it could not reach, and
// when. One caret opens all of it. What the run did is the trace's, above
// the answer, in the order it ran. A question has no footer: its only
// fact is the time, which the answer's footer states a line below.
//
// The line is revealed on hover, and its space is held at rest, because a
// transcript that reflows as the pointer crosses it moves while it is read,
// and this scroller follows a streaming answer, so the motion compounds. It
// is revealed on `:focus-within` as well as `:hover`, and always where there
// is no pointer, as every hover-revealed control here is, so a keyboard or a
// phone can see it.
//
// The time is stored whole and shown short: the file keeps the full ISO
// stamp, the line reads "2 hours ago", and the exact instant is the tooltip
// over it. Forty messages each with a full date read as a log file, and a
// relative reading alone cannot be compared with anything outside this app.
//
// ── The one HTML seam ────────────────────────────────────────────────────────
//
// An answer is Markdown, rendered through the shared hardened renderer
// (`safeMarkdown.ts`) that the reference reader uses, written for input a
// model can be steered into producing.
//
// A question is not Markdown. The writer's typed text stays a text node:
// `*maybe*` in a question is emphasis by typing, rendering it as italics
// would edit what they said, and `# ` at the start of a line would become a
// heading. It also keeps the HTML seam to one role, which halves the surface
// that has to hold.
//
// `html: false` is what makes this safe; `safeMarkdown.ts` carries the
// reasoning. The quotation is never rendered: it is the writer's own prose
// shown back to them, and it stays a sibling of the rendered body.

export interface AiTurnProps {
  turn: ChatTurn;
  /**
   * The persona's current name, resolved from `turn.personaId`, or `null`
   * when the id names nothing installed. The panel resolves it, because the
   * lookup belongs to the assistant and not to a message.
   */
  agentName: string | null;
  running: boolean;
  /**
   * This is the turn being written right now. An answer is stored as
   * `interrupted` from the moment its run begins, so without this the turn
   * still streaming would already say it was cut off.
   */
  live?: boolean;
  pendingReview: AssistantSnapshot["pendingReview"];
  onFindingStatus: (
    turnId: string,
    findingId: string,
    status: "open" | "dismissed" | "resolved",
  ) => void;
  onShowEvidence: (anchor: EvidenceAnchor) => void;
  /**
   * Open a source the turn cited or read, with no passage to land on: a
   * citation in the answer, a read in the trace. The panel re-checks
   * the id against the live catalogue before anything opens.
   */
  onOpenSource: (sourceId: string) => void;
  /**
   * The live catalogue's titles by source id: what every id on this surface
   * is shown as, so a raw id never reaches the writer. Refreshed by the
   * panel, not per render, because listing the catalogue reads the reference
   * shelf.
   */
  titles: ReadonlyMap<string, string>;
  /**
   * This turn's entry from its chat's one `webCitations` walk:
   * whether its model links are inert, which web ids it resolved, and their
   * numbers. The same object while nothing about it changes, so a settled
   * answer does not re-render as another streams.
   */
  web: WebCitations;
  /**
   * The title of the Part a `/summarise part` answer was composed from, as
   * the panel resolves it (`partTitleOf`); absent on every other turn.
   */
  summarisedFrom?: string;
  /**
   * A `/read-on` answer's entry from the chat's reading, and the ledger it
   * draws its settled and new predictions from. Absent on every other turn,
   * and on a read whose entry the file does not hold.
   */
  journal?: {
    entry: JournalEntry;
    predictions: readonly Prediction[];
  };
  /**
   * The run's words, on the one turn that hosts the run's live line:
   * the chat turn being written. Absent everywhere else, including on the
   * turn a review is running beside.
   */
  status?: {
    shown: string | null;
    /** The writer's share of the run's time so far, left off the clock. */
    waitedMs?: number;
    /** A web search waiting on the writer, drawn in the line's place. */
    ask?: ReactNode;
  };
  onResumeReview: (runId: string) => void;
  /**
   * Ask this turn again. Absent while a run is going, because the panel owns
   * that fact and a button that cannot work should not be drawn.
   */
  onRetry?: (turnId: string) => void;
  /**
   * Mint a fresh key for the provider that answered, in a popup.
   *
   * Offered for `key-expired` ("Renew") and `limit-reached` ("Get a new
   * key"), the two failures the app's own flow can put right. Nothing here
   * can add credit to an account at a vendor, so `credit-exhausted` gets a
   * sentence and no button: a button that cannot do what its label promises
   * is worse than none.
   */
  onRenew?: (providerId: string) => void;
  /**
   * The key's verdict for the provider that answered, on the
   * last turn only, because it is about the key as it is now. Read by
   * `keyRemedy` beside this turn's `errorCode`; never a date or a figure for
   * this component to judge (`keyVerdict.ts`).
   */
  keyVerdict?: KeyVerdict;
  /**
   * Change this question and ask it again, dropping everything after it.
   * Offered on the writer's own turns only, and absent while anything runs
   * or waits, as `onRetry` is. Returns whether the line was taken: `false`
   * keeps the edit open, for a line the composer would hold too.
   */
  onEdit?: (turnId: string, text: string) => boolean;
  /**
   * Finish a `/where` answer in its own place: summarise what it
   * could not see, if anything is still missing, then search again and
   * replace it. Absent while anything runs, as `onRetry` is.
   */
  onCompleteSearch?: () => void;
  /**
   * Finish a wide review's answer in its own place: summarise the
   * Sections its map had no summary for, then run the same review again and
   * replace it. Absent while anything runs, as `onRetry` is.
   */
  onCompleteReview?: () => void;
  /**
   * Finish a `/map` answer in its own place: summarise the Sections
   * it had no summary for, then map again and replace it, or map again once
   * the Structure or the summaries have moved past it. Absent while anything
   * runs, as `onRetry` is.
   */
  onCompleteMap?: () => void;
  /**
   * Map the same scope on the shape a `/map` answer's fit note names: a new
   * turn, never this one replaced. Absent while anything runs.
   */
  onMapWith?: (shape: MapShapeId) => void;
  /**
   * Open the chat this answer pointed to (`ChatTurn.route`): a new chat of
   * that kind, a reader already set to read through the Section named.
   * Absent while anything runs.
   */
  onOpenRoute?: (route: ChatRoute) => void;
  /**
   * The live Structure (its fingerprint and its Parts' and Sections' ids)
   * once the panel has read it: what a `/map` answer is stale against, and
   * which of its nodes are gone. Undefined while it is read, and then the
   * answer says nothing either way.
   */
  liveStructure?: LiveStructure;
  /**
   * Whether this chat offers `/map`, and so draws a map answer at all: a
   * reader chat never does, whatever its file carries.
   */
  offersMap?: boolean;
  /**
   * The vendor a button's click would send the book to, when the chat's model
   * is remote now, since the model may have changed since the answer
   * was written. Absent on a local model: nothing leaves.
   */
  transitProvider?: string;
  /**
   * The host behind a provider id, for the failure strip's sentences that
   * name where the writer's credit lives. The provider is named by its live
   * host, never by a word in the copy. Absent, the id itself is said.
   */
  hostOf?: (providerId: string) => string | undefined;
  /**
   * Which of an answer's "no summary" rows (a `/where`'s, or a wide
   * review's, with the review's scope) a click would summarise now:
   * `unsummarised` over the live catalogue, inside a Part review's Part. The
   * rows are a record of that run; this is the book today. Absent until the
   * catalogue has been read, and then the record stands on its own.
   */
  stillMissing?: (
    sourceIds: readonly string[],
    scope?: ReviewScope,
  ) => readonly string[];
  /**
   * The model the chat asks now. A `/where` answer's `unsummarisable`
   * rows are offered again only once it is not the one that answered
   * (`summaryBlockLifted`).
   */
  chatModel?: ModelRef | null;
  /**
   * The command that takes a reference (`/canon`), when this is the latest
   * answer of a bare review by it: a reference its coverage left out
   * for want of room can be checked by naming it. The panel knows the chat's
   * review; the answer knows its coverage.
   */
  nameHint?: string;
  /**
   * Whether a reference this review was named against has stopped being
   * nameable: its Resume would only be refused, so none is offered.
   * The panel knows which names the book still holds.
   */
  referenceGone?: boolean;
}

export default function AiTurn({
  turn,
  agentName,
  running,
  live = false,
  pendingReview,
  onFindingStatus,
  onShowEvidence,
  onOpenSource,
  titles,
  web,
  summarisedFrom,
  journal,
  status,
  onResumeReview,
  onRetry,
  onRenew,
  keyVerdict,
  onEdit,
  onCompleteSearch,
  onCompleteReview,
  onCompleteMap,
  onMapWith,
  onOpenRoute,
  liveStructure,
  offersMap = false,
  transitProvider,
  hostOf,
  stillMissing,
  chatModel,
  nameHint,
  referenceGone = false,
}: AiTurnProps) {
  const { t, i18n } = useTranslation();
  const count = (n: number) => n.toLocaleString(i18n.language);
  // The question being rewritten in place, or `null`. In the bubble rather
  // than the composer, because the composer may hold a half-written next
  // question, and taking it over would lose that.
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null && turn.role === "user";
  // What the writer asked, as they typed it: a command's question was sent
  // as its rubric, which they never wrote, so the bubble and Edit show the
  // command line instead. `text` stays what the model was sent.
  const asked = turn.command ? commandLine(turn.command) : turn.text;
  const sendEdit = () => {
    const text = (draft ?? "").trim();
    if (!text || !onEdit) return;
    // Closed only once the line is taken: one the composer would hold (a
    // command that still needs its words) stays in the box, as it stays in
    // the composer, rather than being thrown away.
    if (onEdit(turn.id, text)) setDraft(null);
  };

  // Copying an answer copies what the screen shows, in plain words
  // (`turnText.ts`): the prose as the renderer parsed it, its citations read
  // as titles, since a raw id is the app's address and not the writer's,
  // and a `/map` or `/verify` answer as what its rows say. Only once
  // the answer has stopped moving: a copy taken mid-stream is half an answer
  // that looks whole once pasted. The tick is the only receipt, and it lasts
  // as long as it takes to see it.
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  // Memoized on what it reads: it parses the answer, and a settled answer
  // re-rendering for another one's stream must not parse it again.
  const copyable = useMemo(
    () =>
      live
        ? null
        : turnAsText(turn, {
            titles,
            web,
            t,
            live: liveStructure,
            offersMap,
          }),
    [live, turn, titles, web, t, liveStructure, offersMap],
  );
  const copy = () => {
    if (!copyable) return;
    // No clipboard (an insecure origin) or a refused write leaves the icon
    // as it was: a tick must never claim a copy that did not happen.
    void navigator.clipboard?.writeText(copyable).then(
      () => setCopied(true),
      () => undefined,
    );
  };
  const { relative, exact } = useTimeWords();
  const reviewRunId = turn.review?.runId;
  // Citations resolve against what this turn used and the catalogue still
  // lists (`citableTitles`), and a trailing id is held back while the answer
  // streams in case it is half an id. Keyed on the titles and the
  // live flag as well as the turn: a title renamed since, or the stream
  // ending on an id, must re-render the answer. The web entry decides the
  // inert links and the markers' numbers, and `answerEnv` builds a
  // new env object for every render.
  const html = useMemo(() => {
    if (turn.role !== "assistant") return "";
    // A finished review's line is said in the writer's language: the file
    // keeps the app's English receipt, which would otherwise head an Italian
    // review. The findings render below. A review whose coverage is short
    // says it stopped short, never that it is complete: the coverage row
    // says what it did not reach.
    const short = turn.coverage?.complete === false;
    const text =
      turn.review && turn.outcome === "complete" && turn.findings
        ? turn.findings.length === 0
          ? turn.commented?.length
            ? t(short ? "dock.reviewShortMargin" : "dock.reviewDoneMargin")
            : t(short ? "dock.reviewShortNone" : "dock.reviewDoneNone")
          : t(short ? "dock.reviewShort" : "dock.reviewDone", {
              count: turn.findings.length,
            })
        : turn.text;
    // A table the model broke is mended for the eye (`mendTables`); the
    // stored answer stays what it wrote.
    return markdown.render(
      mendTables(text),
      answerEnv({
        web,
        titles: citableTitles(turn, titles),
        final: !live,
        citationLabel: (title) => t("dock.citation", { title }),
      }),
    );
  }, [turn, titles, web, live, t]);

  // A turn can carry a persona with no token count (an interrupted run) or a
  // token count with no persona (a turn whose persona never resolved), so
  // the line appears for either and names whichever it has. The fallback is
  // the generic word rather than a blank: a persona whose file is gone still
  // answered, and an empty gap where a name belongs reads as a bug.
  const labels: [string, string | null][] = [
    ["agent", turn.personaId ? (agentName ?? t("dock.assistant")) : null],
    [
      "usage",
      // The cached part named when the provider reported it: a tool loop
      // re-sends its context each step, and the plain sum would read as
      // that many new books.
      turn.usage?.totalTokens
        ? t(
            turn.usage.cachedInputTokens
              ? "dock.tokenUsageCached"
              : "dock.tokenUsage",
            {
              total: count(turn.usage.totalTokens),
              input: count(turn.usage.inputTokens ?? 0),
              output: count(turn.usage.outputTokens ?? 0),
              cached: count(turn.usage.cachedInputTokens ?? 0),
            },
          )
        : null,
    ],
    [
      "sources",
      turn.sources?.length
        ? t("dock.sourcesUsed", { count: turn.sources.length })
        : null,
    ],
    // No "N tool calls" fact: the trace above the answer names every read
    // and search in order.
    //
    // Coverage is a warning, so it stays on the line rather than inside the
    // disclosure: a shortfall behind a disclosure nobody has a reason to open
    // is one nobody learns about.
    [
      "coverage",
      turn.coverage
        ? t("dock.coverage", {
            inspected: turn.coverage.inspected,
            intended: turn.coverage.intended,
            count: turn.coverage.intended,
          })
        : null,
    ],
    // A provenance fact, beside the warning: the model proposed searching
    // the web and nothing was searched, so this answer stands on what it
    // already knew. Never said where a query may have left, and never
    // on a stopped or failed turn; derived, not stored.
    [
      "noWeb",
      turn.role === "assistant" && traceFacts(turn).answeredWithoutWeb
        ? t("dock.answeredWithoutWeb")
        : null,
    ],
  ];
  // Read once and narrowed here, so the strip below has a plain string rather
  // than an assertion inside JSX: `turn.model` is optional, and a turn that
  // failed before a model was resolved has none to renew.
  const failedProvider =
    turn.outcome === "failed" ? turn.model?.providerId : undefined;

  // The reason and the remedy, in the app's one form for "recoverable and
  // blocking": the Library's attention banner, its remedy the shared ember
  // button. One button, the one that works: a Try again beside a Renew fails
  // every time until the Renew is done, so a failure over the key offers the
  // remedy until the verdict says the cause is gone, and Try again after.
  // Every other failure offers Try again.
  const failureStrip = () => {
    const remedy = keyRemedy(turn, keyVerdict);
    // Who holds the credit, by host (openrouter.ai), as the transit notes
    // name it. A turn that failed before a model resolved has no provider,
    // and no credit sentence either.
    const provider =
      (failedProvider && hostOf?.(failedProvider)) ?? failedProvider ?? "";
    // A lapsed key and a spent limit have the same remedy, a new key minted
    // through the same popup, and different words for it: "Renew" says the
    // key ran out of time, "Get a new key" that it ran out of its limit.
    const action =
      (remedy === "renew" || remedy === "new-key") &&
      onRenew &&
      failedProvider ? (
        <Button
          variant="attention"
          className="ui-btn-sm"
          onClick={() => onRenew(failedProvider)}
        >
          {t(remedy === "new-key" ? "dock.retry.newKey" : "dock.retry.renew")}
        </Button>
      ) : (remedy === null || remedy === "retry") && onRetry ? (
        <Button
          // Soft once the key is ready: the happy path's colour, where the
          // ember one said something still had to be fixed.
          variant={remedy === "retry" ? "soft" : "attention"}
          className="ui-btn-sm"
          onClick={() => onRetry(turn.id)}
        >
          {t("dock.retry.again")}
        </Button>
      ) : null;
    const actions = action ? (
      <span className="ai-turn-failed">{action}</span>
    ) : undefined;
    // The reason, always in the writer's language and always from the code:
    // the turn's text holds only prose that arrived. A turn with no code says
    // the generic reason. Spent credit adds the one thing only the writer can
    // do about it, since no button can. A spent limit that resets while the
    // key still lives adds waiting for the reset, when the verdict says
    // waiting is real. For a failure over the key, the reason is what the key
    // is now, so it always matches the button beside it.
    const reason = t(
      `dock.modelError.${
        remedy === "renew"
          ? "key-expired"
          : remedy === "new-key"
            ? "limit-reached"
            : (turn.errorCode ?? "unknown")
      }`,
      { provider },
    );
    const said =
      remedy === "retry"
        ? t("dock.retry.keyReady")
        : turn.errorCode === "credit-exhausted"
          ? `${reason} ${t("dock.retry.creditExhausted", { provider })}`
          : remedy === "new-key" && keyVerdict?.waitUntil
            ? `${reason} ${t("dock.retry.waitForReset", {
                date: formatWhen(keyVerdict.waitUntil, i18n.language),
              })}`
            : reason;
    // Once the key is ready nothing blocks, and a strip in the warning's
    // colour would make the writer read it to learn they can go ahead. The
    // strip turns quiet in place: the ember goes, the box and the button stay
    // where they were, and the green button is the one colour left.
    return (
      <Banner
        tone={remedy === "retry" ? "quiet" : "attention"}
        action={actions}
      >
        {said}
      </Banner>
    );
  };

  const when = relative(turn.createdAt);
  const facts: { id: string; node: ReactNode }[] = [
    ...labels
      .filter(([, label]) => label)
      .map(([id, label]) => ({ id, node: label as ReactNode })),
    // Dropped entirely rather than rendered blank when the stamp is
    // unreadable: a hand-edited file can carry anything, and an empty slot on
    // a dot-separated line reads as a missing fact rather than a bad one.
    ...(when
      ? [
          {
            id: "at",
            node: (
              <time dateTime={turn.createdAt} title={exact(turn.createdAt)}>
                {when}
              </time>
            ),
          },
        ]
      : []),
  ];

  // What the caret would open. A user's own question has none of it, and a
  // disclosure triangle with nothing behind it misdescribes the surface, so
  // that turn gets the same line without the disclosure.
  const expandable = Boolean(turn.coverage || turn.sources?.length);
  // What the fact check held and did not judge: the facts it could not
  // answer for, and how many it never asked about at all.
  const judgement = turn.coverage?.judgement;
  // What the check held and did not reach: the ones it names (`deferred`),
  // each a row below, and the count of what it could not name.
  const deferred = judgement?.deferred ?? [];
  const unasked = judgement
    ? judgement.candidates -
      judgement.judged -
      judgement.unjudged.length -
      deferred.length
    : 0;
  const run = (
    <span className="ai-turn-facts">
      {facts.map((fact, index) => (
        <Fragment key={fact.id}>
          {index > 0 ? " · " : null}
          {fact.node}
        </Fragment>
      ))}
    </span>
  );

  // A `/verify` answer's verdict, only once its check settled.
  const settled = settledVerdict(turn);
  // The model's answer, through a parser with HTML off; `safeMarkdown.ts`
  // says what each of its settings guards. A chat answer's body and a
  // `/verify` answer's reasoning.
  const reading = (
    <div
      className="dock-read"
      dangerouslySetInnerHTML={{ __html: trustedHtml(html) }}
      // One listener for every citation in the answer: the buttons are
      // markup the renderer wrote, so they cannot carry their own handlers.
      // `closest` is bounded by this container, and the id it finds is only
      // a request: the panel checks it against the live catalogue before
      // anything opens.
      onClick={(event) => {
        const cite = (event.target as Element).closest?.("[data-cite]");
        const id = cite?.getAttribute("data-cite");
        if (cite && id && event.currentTarget.contains(cite)) onOpenSource(id);
      }}
    />
  );

  return (
    <article
      className={`msg msg-${turn.role === "user" ? "you" : "assistant"}`}
      data-turn-id={turn.id}
    >
      {/* How the answer was reached, folded above it, and,
          on the turn being written, the run's one live line. */}
      {turn.role === "assistant" ? (
        <AiTrace
          turn={turn}
          titles={titles}
          live={Boolean(status)}
          onOpenSource={onOpenSource}
        />
      ) : null}
      {/* A failed turn that never said anything draws no body: the banner
          under it states the reason, and an empty bubble above it reads as an
          answer that failed to render. */}
      {editing ? (
        <form
          className="msg-edit"
          onSubmit={(event) => {
            event.preventDefault();
            sendEdit();
          }}
        >
          {turn.quote ? <span className="msg-quote">{turn.quote}</span> : null}
          <textarea
            className="ui-input"
            value={draft ?? ""}
            aria-label={t("dock.editQuestion")}
            autoFocus
            rows={3}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // The composer's keys, so an edit asks the way a question does:
              // Enter sends, Shift+Enter breaks the line, and an IME's own
              // Enter (composing) is left to the IME.
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                sendEdit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setDraft(null);
              }
            }}
          />
          <span className="msg-edit-actions">
            <Button variant="quiet" onClick={() => setDraft(null)}>
              {t("confirm.cancel")}
            </Button>
            <Button
              variant="soft"
              type="submit"
              disabled={!(draft ?? "").trim()}
            >
              {t("dock.editSend")}
            </Button>
          </span>
        </form>
      ) : (turn.role === "assistant" &&
          (turn.outcome === "failed" ||
            (turn.outcome === "interrupted" && !live)) &&
          !turn.text.trim()) ||
        // A `/where` answer draws its rows instead: the text is the line
        // kept for the model's history, and no chat prose goes with the
        // passages. A `/map` answer too, and in a chat that does not
        // offer `/map` it draws nothing at all, not even the headline its
        // file keeps.
        turn.located ||
        turn.mapped ? null : turn.verifies ? (
        // A `/verify` answer draws its verdict instead of chat prose, and
        // only once settled: while it runs the trace's live line
        // speaks for it, and one that never settled has no verdict to draw,
        // so its banner says why. An unjudged check's text is the line kept
        // for the model; its screen line is the writer's own.
        settled && !live ? (
          <div className="msg-body">
            <AiVerifyAnswer
              verified={settled}
              records={turn.web ?? []}
              cited={web.cited}
              reading={reading}
            />
          </div>
        ) : null
      ) : (
        <div className="msg-body">
          {turn.quote ? <span className="msg-quote">{turn.quote}</span> : null}
          {turn.role === "assistant" ? reading : asked}
          {/* The web results the answer cited, after its prose and inside
              its body: a row per number, arriving with its marker
              while the answer streams, kept when it stops. */}
          {turn.role === "assistant" ? (
            <AiWebSources cited={web.cited} />
          ) : null}
        </div>
      )}
      {turn.role === "assistant" && journal && !live ? (
        <AiJournalEntry
          entry={journal.entry}
          predictions={journal.predictions}
        />
      ) : null}
      {/* The answer's quotations whose words are in nothing the run read
          (`quoteCheck.ts`). Said under the answer rather than on each quote:
          an inline one has no element of its own to mark, and a writer about
          to copy a line into their manuscript should meet the warning before
          they look for it. */}
      {turn.role === "assistant" && turn.unfoundQuotes?.length && !live ? (
        <p className="dock-hint ai-unfound">
          <span>
            {t("dock.unfoundQuotes", { count: turn.unfoundQuotes.length })}
          </span>{" "}
          {turn.unfoundQuotes.map((quote, at) => (
            <Fragment key={at}>
              {at > 0 ? " · " : null}
              <q>
                <bdi>
                  {Array.from(quote).length > 90
                    ? `${Array.from(quote).slice(0, 89).join("")}…`
                    : quote}
                </bdi>
              </q>
            </Fragment>
          ))}
        </p>
      ) : null}
      {/* Where a Part's account came from: after the prose, quiet,
          with no count, which holds whether the summaries were there already
          or written by this run, and one clause when some of the Part's
          Sections were kept from the assistant, never which. Copy gives the
          prose alone. */}
      {turn.role === "assistant" && turn.summarisedPart && summarisedFrom ? (
        <p className="dock-hint">
          {slotted(
            t,
            turn.summarisedPart.withheld
              ? "dock.summarisePart.fromWithheld"
              : "dock.summarisePart.from",
            { title: <bdi>{summarisedFrom}</bdi> },
          )}
        </p>
      ) : null}
      {/* The question's one row: the pencil, and nothing else. Its
          height is held whether or not the pencil is offered, so a run
          starting, which withdraws it, does not pull the answer up by a row. */}
      {turn.role === "user" && !editing ? (
        <span className="msg-you-actions">
          {onEdit ? (
            <Button
              variant="icon"
              aria-label={t("dock.editQuestion")}
              title={t("dock.editQuestion")}
              onClick={() => setDraft(asked)}
            >
              <Icon name={appIcons.edit} size={13} />
            </Button>
          ) : null}
        </span>
      ) : null}
      {/* What an unfinished answer says: the kit's banner with the fact and
          the remedy beside it, so the writer never has to guess why a Try
          again is there.

          The sentence is the neutral `info` tone and only the button is in
          ember. The failure strip's text is ember because something blocks,
          a key or credit; here nothing does, the fact is a plain account,
          and the attention belongs to the one way forward.

          Which fact is the turn's `errorCode`, never a stored sentence
          : `cancelled` is the writer's own Stop; `interrupted` is the
          placeholder a run writes as it begins, left behind only when the
          editor closed or reloaded before any ending replaced it;
          `output-limit` is the model's output allowance running out
          mid-answer (`turnEnding.ts`); no code is an answer a ceiling ended,
          whose own text says which. Hidden on the turn still being written,
          which is stored as `interrupted` until its run ends. */}
      {turn.role === "assistant" && turn.outcome === "interrupted" && !live ? (
        <Banner
          tone="info"
          action={
            onRetry ? (
              <Button
                variant="attention"
                className="ui-btn-sm"
                onClick={() => onRetry(turn.id)}
              >
                {t("dock.retry.again")}
              </Button>
            ) : undefined
          }
        >
          {t(
            turn.errorCode === "cancelled"
              ? "dock.stopped.cancelled"
              : turn.errorCode === "interrupted"
                ? "dock.stopped.interrupted"
                : turn.errorCode === "output-limit"
                  ? "dock.stopped.output-limit"
                  : "dock.stopped.unfinished",
          )}
          {/* What the button does, only where there is one: an older turn
              keeps its fact and loses Try again. */}
          {onRetry ? ` ${t("dock.stopped.retryHint")}` : null}
        </Banner>
      ) : null}
      {/* What a failed turn offers. The prose above is whatever arrived
          before the run broke, often nothing, and then there is no body. This
          banner is the reason and the action, under the turn it belongs to
          rather than the composer: a writer scrolling back to an old failure
          finds the button beside its question, and a strip under the
          composer would follow them to a chat where it means nothing. */}
      {turn.role === "assistant" && turn.outcome === "failed"
        ? failureStrip()
        : null}
      {turn.findings?.length ? (
        <ol className="ai-findings">
          {turn.findings.map((finding) => (
            <FindingRow
              key={finding.id}
              finding={finding}
              onStatus={(status) =>
                onFindingStatus(turn.id, finding.id, status)
              }
              onShow={onShowEvidence}
              titles={titles}
            />
          ))}
        </ol>
      ) : null}
      {turn.mapped && offersMap ? (
        <AiMapAnswer
          mapped={turn.mapped}
          titles={titles}
          live={liveStructure}
          model={turn.model?.modelId ?? t("dock.assistant")}
          onOpenSource={onOpenSource}
          onShowEvidence={onShowEvidence}
          onComplete={onCompleteMap}
          onMapWith={onMapWith}
          transitProvider={transitProvider}
          stillMissing={
            stillMissing
              ? (ids) => stillMissing(ids, turn.mapped?.scope)
              : undefined
          }
          lifted={summaryBlockLifted(turn.model, chatModel)}
        />
      ) : null}
      {turn.located ? (
        <LocatedAnswer
          located={turn.located}
          titles={titles}
          onShow={onShowEvidence}
          onCompleteSearch={onCompleteSearch}
          transitProvider={transitProvider}
          stillMissing={stillMissing}
          lifted={summaryBlockLifted(turn.model, chatModel)}
        />
      ) : null}
      {turn.review &&
      !status &&
      !referenceGone &&
      offersReviewAgain(turn.review.task, turn.review.scope) ? (
        <ReviewWiden
          skipped={turn.coverage?.skipped ?? []}
          lifted={summaryBlockLifted(turn.model, chatModel)}
          // One button per answer: while this answer's Resume, or the Resume of
          // a review-again already started from it, is on offer, that is the
          // cheaper way to finish.
          onComplete={
            reviewRunId &&
            (pendingReview?.runId === reviewRunId ||
              pendingReview?.replaces === reviewRunId)
              ? undefined
              : onCompleteReview
          }
          transitProvider={transitProvider}
          stillMissing={
            stillMissing
              ? (ids) => stillMissing(ids, turn.review?.scope)
              : undefined
          }
        />
      ) : null}
      {/* After any Widen, before the foot: no button, no count, no list. The
          rows above name the references; this names the move. Only where a
          reference had no room, and only on a review that named none. */}
      {nameHint &&
      !status &&
      !turn.sources?.some((use) => use.reason === "named") &&
      turn.coverage?.skipped.some(
        (row) =>
          row.reason === "not-in-budget" &&
          row.sourceId.startsWith("reference:"),
      ) ? (
        <p className="dock-hint">
          {slotted(t, "dock.canon.namedHint", {
            command: <span className="ui-keyword">{nameHint}</span>,
          })}
        </p>
      ) : null}
      {/* The route to the chat the answer pointed to: a link on its own row
          under the answer, naming the chat as the writer's interface does
          and, for a reader, where it will read to. It opens the chat and
          never runs its job. */}
      {turn.route && onOpenRoute && !status ? (
        <p className="ai-route-row">
          <button
            type="button"
            className="ui-text-link"
            onClick={() => turn.route && onOpenRoute(turn.route)}
          >
            {turn.route.through && titles.has(`node:${turn.route.through}`)
              ? t("dock.route.openThrough", {
                  chat: t(`dock.chatKind.${turn.route.kind}`),
                  title: titles.get(`node:${turn.route.through}`),
                })
              : t("dock.route.open", {
                  chat: t(`dock.chatKind.${turn.route.kind}`),
                })}
          </button>
        </p>
      ) : null}
      {/* What the answer left in the margin instead of here: one button per
          chapter, which opens it where the ghost comments wait beside the
          words they are about. A chapter gone from the book has no button. */}
      {turn.role === "assistant" && turn.commented && !status
        ? turn.commented.map((one) => {
            const title = titles.get(`node:${one.nodeId}`);
            return title ? (
              <p key={one.nodeId} className="ai-route-row">
                <button
                  type="button"
                  className="ui-text-link"
                  onClick={() => onOpenSource(`node:${one.nodeId}`)}
                >
                  {t("dock.commented", { count: one.count, title })}
                </button>
              </p>
            ) : null;
          })
        : null}
      {/* The answer's foot: Copy, then the facts, one row.

          While the run lasts, the same row is the run's one live line (dots,
          words, clock) at the end of the conversation, right above
          the composer while the transcript follows, where the eye waits. Same
          row, same held height: when the run ends the line becomes Copy and
          the facts without moving anything. */}
      {turn.role === "user" ? null : status ? (
        <div className="ai-turn-foot">
          {/* A web search waiting on the writer takes the line's place
              : no dots and no clock while the run waits on them, not
              on the machine. The ask is the panel's; this turn only holds
              the slot. */}
          {status.ask ?? (
            <RunLine
              className="is-inline"
              shown={status.shown}
              createdAt={turn.createdAt}
              waitedMs={status.waitedMs}
            />
          )}
        </div>
      ) : (
        <div className="ai-turn-foot">
          {copyable ? (
            <Button
              variant="icon"
              className="ai-turn-copy"
              aria-label={t(copied ? "dock.copied" : "dock.copyAnswer")}
              title={t(copied ? "dock.copied" : "dock.copyAnswer")}
              onClick={copy}
            >
              <Icon
                name={copied ? appIcons.confirm : appIcons.copy}
                size={16}
              />
            </Button>
          ) : null}
          {facts.length === 0 ? null : expandable ? (
            <details className="ai-turn-meta">
              <summary>
                {run}
                <Icon
                  className="ai-turn-caret"
                  name={appIcons.expand}
                  size={11}
                  aria-hidden="true"
                />
              </summary>
              <div className="ai-turn-detail">
                {turn.sources?.length ? (
                  <>
                    <p className="ai-turn-detail-head">
                      {t("dock.sourcesUsed", { count: turn.sources.length })}
                    </p>
                    {turn.sources.map((source) => (
                      <span key={source.id}>
                        {/* The live title, so one source has one name across
                            the turn; the captured one only for a source the
                            project has lost. */}
                        {titles.get(source.id) ?? textOf(source.title)} ·{" "}
                        {textOf(source.authority)} · {textOf(source.coverage)}
                        {isSourceOrigin(source.origin)
                          ? ` · ${t(`dock.origin.${source.origin}`)}`
                          : ""}
                      </span>
                    ))}
                  </>
                ) : null}
                {turn.coverage?.skipped.length ||
                judgement?.unjudged.length ||
                deferred.length ||
                unasked > 0 ? (
                  <>
                    <p className="ai-turn-detail-head">
                      {t("dock.coverage", {
                        inspected: turn.coverage?.inspected,
                        intended: turn.coverage?.intended,
                        count: turn.coverage?.intended,
                      })}
                    </p>
                    {/* A fact the judge could not answer for, by name and
                        by the places it stands in: the review's reading may
                        be whole while its judging is not, and a writer told
                        only "not judged" cannot go and read it. */}
                    {judgement?.unjudged.map((fact) => (
                      <span key={fact.key}>
                        {fact.entity} · {fact.attribute} ·{" "}
                        {fact.sourceIds
                          .map((id) => titleOf(id, titles, t))
                          .join(", ")}{" "}
                        · {t("dock.coverageUnjudged")}
                      </span>
                    ))}
                    {/* A fact the check held and did not reach this time, by
                        name and place, told apart from one the judge could
                        not answer: the next check continues from it, and the
                        writer can read it meanwhile. */}
                    {deferred.map((fact) => (
                      <span key={fact.key}>
                        {fact.entity} · {fact.attribute} ·{" "}
                        {fact.sourceIds
                          .map((id) => titleOf(id, titles, t))
                          .join(", ")}{" "}
                        · {t("dock.coverageDeferred")}
                      </span>
                    ))}
                    {unasked > 0 ? (
                      <span>
                        {t("dock.coverageUnasked", { count: unasked })}
                      </span>
                    ) : null}
                    {turn.coverage?.skipped.map((row) => (
                      <span key={row.sourceId}>
                        {titleOf(row.sourceId, titles, t)} ·{" "}
                        {/* The reason is untrusted: a chat file in a shared
                            folder is replayed unvalidated below the turn
                            array, and an object rendered raw crashes the
                            dock. An unknown one reads as "not inspected"
                            rather than dropping the row, which would make the
                            coverage look more complete than it was. */}
                        {t(
                          `dock.coverageSkip.${isCoverageSkipReason(row.reason) ? row.reason : "unknown"}`,
                        )}
                      </span>
                    ))}
                  </>
                ) : null}
              </div>
            </details>
          ) : (
            <div className="ai-turn-meta">{run}</div>
          )}
        </div>
      )}
      {turn.review ? (
        <span className="ai-review-link">
          {t(`dock.review.${turn.review.task}`)}
          {reviewRunId &&
          pendingReview?.runId === reviewRunId &&
          !referenceGone ? (
            <button
              type="button"
              className="ai-text-button"
              disabled={running}
              onClick={() => onResumeReview(reviewRunId)}
            >
              {t("dock.resumeReview", {
                complete: pendingReview?.complete ?? 0,
                total: pendingReview?.total ?? 0,
              })}
            </button>
          ) : null}
        </span>
      ) : null}
    </article>
  );
}

// A chat file is the writer's to edit, so a turn's source rows are read as
// checked values: a field that is not text shows as nothing, never as
// "[object Object]" and never as a throw out of the render.

/** `value` when it is text, else the empty string. */
function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const SOURCE_ORIGINS = ["live-buffer", "project-file"] as const;

/** Whether `value` is an origin the dock has a word for. */
function isSourceOrigin(
  value: unknown,
): value is (typeof SOURCE_ORIGINS)[number] {
  return SOURCE_ORIGINS.includes(value as (typeof SOURCE_ORIGINS)[number]);
}

/**
 * Under a review of a Part or the Structure that took the map route: the
 * Sections it had no summary to route by, and the button that summarises them
 * and reviews again, in `widenState`'s three states, which `Widen.tsx`
 * explains.
 */
function ReviewWiden({
  skipped,
  onComplete,
  transitProvider,
  stillMissing,
  lifted,
}: {
  skipped: readonly { sourceId: string; reason: unknown }[];
  onComplete?: () => void;
  transitProvider?: string;
  stillMissing?: (sourceIds: readonly string[]) => readonly string[];
  /** Whether the chat now asks another model than the one that answered. */
  lifted: boolean;
}) {
  const { t } = useTranslation();
  // The run's own list (`offerableRows`): Sections this model could not
  // summarise are said, and join the button's count only under another model.
  const unmapped = offerableRows(skipped, lifted);
  const count = blockedOf(skipped, lifted);
  const blocked =
    count > 0 ? t("dock.reviewFollowUp.unsummarisable", { count }) : undefined;
  const missing = stillMissing ? stillMissing(unmapped) : unmapped;
  const state = widenState(unmapped, missing);
  if (!state) return blocked ? <Widen blocked={blocked} /> : null;
  // Both buttons run the review again, which sends summaries and whole
  // Sections; the summarise button first sends what a summary request sends,
  // and says so first.
  const review = (provider: string) =>
    t("dock.reviewTransit.withSummaries", { provider });
  return state === "summarise" ? (
    <Widen
      blocked={blocked}
      note={t("dock.reviewFollowUp.noSummary", { count: unmapped.length })}
      transit={
        transitProvider
          ? summariseTransit(transitProvider, review(transitProvider), t)
          : undefined
      }
      action={t("dock.reviewFollowUp.summariseMissing", {
        count: missing.length,
      })}
      onOpen={onComplete}
    />
  ) : (
    <Widen
      blocked={blocked}
      note={t("dock.reviewFollowUp.answerOutOfDate")}
      transit={transitProvider ? review(transitProvider) : undefined}
      action={t("dock.reviewFollowUp.reviewAgain")}
      onOpen={onComplete}
    />
  );
}

/**
 * What a `/where` found: the passages as rows, in book order, each
 * its quote and its Section, and a click lands the editor on it through the
 * same entry point a finding's evidence uses, revalidated at click time.
 * Nothing found says so, with what the search could and could not cover, and
 * the one action that widens it.
 */
function LocatedAnswer({
  located,
  titles,
  onShow,
  onCompleteSearch,
  transitProvider,
  stillMissing,
  lifted,
}: {
  located: LocateOutcome;
  titles: ReadonlyMap<string, string>;
  onShow: (anchor: EvidenceAnchor) => void;
  onCompleteSearch?: () => void;
  transitProvider?: string;
  stillMissing?: (sourceIds: readonly string[]) => readonly string[];
  /** Whether the chat now asks another model than the one that answered. */
  lifted: boolean;
}) {
  const { t } = useTranslation();
  // `widenState`'s three states; out of date offers to search again in
  // place. The rows a click may take are `offerableRows`'s, as in
  // `ReviewWiden`.
  const unmapped = offerableRows(located.coverage.skipped, lifted);
  const blockedCount = blockedOf(located.coverage.skipped, lifted);
  const blocked =
    blockedCount > 0
      ? t("dock.where.unsummarisable", { count: blockedCount })
      : undefined;
  const missing = stillMissing ? stillMissing(unmapped) : unmapped;
  const state = widenState(unmapped, missing);
  const widen =
    state === null ? (
      blocked ? (
        <Widen blocked={blocked} />
      ) : null
    ) : state === "summarise" ? (
      <Widen
        blocked={blocked}
        note={t("dock.where.noSummary", { count: unmapped.length })}
        // The click sends what a summary request sends, then searches:
        // more than a search alone sends, and the line says so.
        transit={
          transitProvider
            ? summariseTransit(
                transitProvider,
                t("dock.where.remoteTransit", { provider: transitProvider }),
                t,
              )
            : undefined
        }
        action={t("dock.where.summariseMissing", { count: missing.length })}
        onOpen={onCompleteSearch}
      />
    ) : (
      <Widen
        blocked={blocked}
        note={t("dock.where.searchIncomplete")}
        transit={
          transitProvider
            ? t("dock.where.remoteTransit", { provider: transitProvider })
            : undefined
        }
        action={t("dock.where.searchAgain")}
        onOpen={onCompleteSearch}
      />
    );
  if (located.matches.length === 0)
    return (
      <div className="ai-located">
        <p className="ai-lede">{t("dock.where.notFound")}</p>
        <p className="dock-hint">
          {t("dock.where.checked", {
            count: located.coverage.inspected,
            total: located.coverage.intended,
          })}
        </p>
        {widen}
      </div>
    );
  return (
    <div className="ai-located">
      <ol
        className="ai-located-list"
        aria-label={t("dock.where.found", { count: located.matches.length })}
      >
        {located.matches.map((anchor) => (
          <li key={`${anchor.sourceId}|${anchor.quote}`}>
            <button
              type="button"
              className="ai-evidence"
              onClick={() => onShow(anchor)}
            >
              <span>{anchor.quote}</span>
              {/* No glyph: a row that opens in the app is the plain evidence
                  row, and the arrow-out is kept for the web's sources, which
                  leave it. */}
              <small>{titleOf(anchor.sourceId, titles, t)}</small>
            </button>
          </li>
        ))}
      </ol>
      {widen}
    </div>
  );
}

function FindingRow({
  finding,
  onStatus,
  onShow,
  titles,
}: {
  finding: Finding;
  onStatus: (status: "open" | "dismissed" | "resolved") => void;
  onShow: (anchor: EvidenceAnchor) => void;
  titles: ReadonlyMap<string, string>;
}) {
  const { t } = useTranslation();
  const closed =
    finding.status === "dismissed" || finding.status === "resolved";
  if (closed)
    return (
      <li className="ai-finding is-closed">
        <span className="ai-finding-head">
          {finding.title} · {t(`dock.finding.${finding.status}`)}
        </span>
        <button
          type="button"
          className="ai-text-button"
          onClick={() => onStatus("open")}
        >
          {t("dock.finding.restore")}
        </button>
      </li>
    );
  return (
    <li className="ai-finding">
      <span className="ai-finding-head">
        {t(`dock.severity.${finding.severity}`)}
      </span>
      <p className="ai-finding-title">{finding.title}</p>
      <p className="ai-finding-body">{finding.explanation}</p>
      {finding.uncertainty ? (
        <p className="dock-hint">{finding.uncertainty}</p>
      ) : null}
      {finding.unverified ? (
        <p className="dock-hint">
          {t(`dock.finding.unverified.${finding.unverified}`)}
        </p>
      ) : null}
      {finding.evidence.map((anchor, index) => (
        <button
          type="button"
          key={`${anchor.sourceId}-${index}`}
          className="ai-evidence"
          onClick={() => onShow(anchor)}
        >
          <span>{anchor.quote.slice(0, 80)}</span>
          <small>{titleOf(anchor.sourceId, titles, t)}</small>
        </button>
      ))}
      <span className="ai-finding-actions">
        <Button
          variant="soft"
          className="ui-btn-sm"
          onClick={() => onStatus("resolved")}
        >
          {t("dock.finding.resolve")}
        </Button>
        <Button
          variant="link"
          className="ui-btn-sm"
          onClick={() => onStatus("dismissed")}
        >
          {t("dock.finding.dismiss")}
        </Button>
      </span>
    </li>
  );
}
