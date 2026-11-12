// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, Dots, Icon } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import type { Assistant } from "../../ai";
import type { ReadRef } from "../../ai/domain/types";
import { offersWorkflow, skillsFor } from "../../ai/domain/skills";
import AiModeBar from "./AiModeBar";
import { AiCommandGuide, AiTransitLine } from "./AiCommandGuide";
import { chatFilePath } from "../../project/naming";
import type { DocumentStructure } from "../../project/types";
import { openConnectPopup } from "../../ai/connectPath";
import { AiReadingSoFar, journalOf } from "./AiReading";
import { AiNeedQuestion } from "./AiDrafting";
import AiPlan from "./AiPlan";
import { NEED_COMMANDS } from "../../ai/domain/drafting";
import AiComposer from "./AiComposer";
import { useModelNameShort } from "./modelNameShort";
import AiSearchAsk from "./AiSearchAsk";
import AiTurn from "./AiTurn";
import { ContextReading, CreditReading } from "./AiReadings";
import { activityWords, progressWords, RunLine } from "./runStatus";
import { usePanelDrafts } from "./usePanelDrafts";
import { useTranscriptScroll } from "./useTranscriptScroll";
import { useAskingHeight } from "./useAskingHeight";
import { usePanelCatalogue } from "./usePanelCatalogue";
import AiChatHead from "./AiChatHead";
import AiRefusal from "./AiRefusal";
import AiKeyBanner from "./AiKeyBanner";
import AiMissingLine from "./AiMissingLine";
import AiSaveFoot from "./AiSaveFoot";
import AiModelButton from "./AiModelButton";
import { sendLine } from "./panelSend";
import { partTitleOf } from "./summarisePart";
import { useChatProvider, type RemoteProvider } from "./useChatProvider";
import { useQuestion } from "./useQuestion";
import { useSearchAsk, waitingAsk } from "./useSearchAsk";
import { usePersonaChoice } from "./usePersonaChoice";
import { useTurnActions } from "./useTurnActions";
import AiPanelDialogs, { usePanelDialogs } from "./AiPanelDialogs";

// ── The assistant surface ────────────────────────────────────────────────────
//
// The message is the answer; the dock holds facts and buttons, never a
// dashboard. Findings are a plain list in the message, with severity as a
// mono eyebrow word and never a colour. Refusals live in the composer strip,
// and the foot carries nothing permanent: only a failed or still-queued save
// gets a transient row. The surface uses the shared tokens and the shared
// `Button`, `Select` and `Dots`, with no look of its own.

export interface AiPanelProps {
  /**
   * Whether the dock is open. A shut dock keeps this face mounted, so its
   * opening is a reveal the search ask's arming must hear.
   */
  open?: boolean;
  assistant?: Assistant | null;
  quote: string | null;
  /**
   * Set the quote riding on the next question, or clear it with `null`. A
   * setter, because a send the assistant refuses puts the question back in
   * the field, and its passage must come back with it.
   */
  onQuote: (quote: string | null) => void;
  /** Paths waiting to reach the remote; the foot never says "saved" for one. */
  queuedPaths?: ReadonlySet<string>;
  /**
   * Per-chat composer drafts. The shell mirrors them in refs, not state, so
   * checking the Reference face does not cost the writer a half-typed
   * question. The panel owns the live copy while it is mounted, and this prop
   * only seeds that mount. The setter carries the whole map, so a prune
   * reaches the shell's mirror.
   */
  drafts?: Record<string, string>;
  onDrafts?: (next: Record<string, string>) => void;
  /**
   * The account's remote providers, keyed by id, as the account layer
   * reports them.
   *
   * The panel reads them to warn before a key lapses rather than after. A
   * popup opens only inside a user gesture, so renewal is never silent, and
   * the warning is what makes renewing possible at all. Without it the first
   * sign is a failed turn.
   *
   * Absent for a writer with no account: the device path needs no key and
   * must keep working with no network.
   */
  remoteProviders?: Record<string, RemoteProvider>;
  /**
   * The editor's shared toast. An edit's Undo is offered through it, because
   * a reversible act happens at once and offers Undo rather than asking
   * first. Absent in harnesses, which then post nothing.
   */
  onNotify?: (text: string, undo?: () => void) => void;
  /**
   * The editor's live tree, read for one thing: when it changes, the sources
   * are listed again. A `/map` answer compares itself with the Structure the
   * panel last listed, so without this a Part renamed in the tree leaves the
   * map silent about it, its figure undimmed and its button still offering to
   * summarise. The tree is replaced on a rename, a move or a new node, never
   * on typing, so this re-lists only when the Structure can have moved.
   */
  structure?: DocumentStructure | null;
  /**
   * Open a reference document the chat relies on, creating a catalogue
   * section from its template when it does not exist yet. A missing document
   * is offered through it, so the writer can compile it and come back. Absent
   * where there is no project to write into (a harness, the demo), and the
   * offer is then named without a button.
   */
  onWriteReference?: (reference: ReadRef) => void;
}

export default function AiPanel({
  open: dockOpen = true,
  remoteProviders,
  onNotify,
  assistant,
  quote,
  onQuote,
  queuedPaths,
  drafts: ownedDrafts,
  onDrafts,
  structure,
  onWriteReference,
}: AiPanelProps) {
  const { t, i18n } = useTranslation();
  const scopeLanguage = i18n.language?.startsWith("it") ? "it" : "en";
  const empty = useMemo(
    () => ({
      chats: [],
      unreadable: [],
      activeChatId: null,
      running: false,
      preparing: false,
      error: null,
      queued: 0,
      saveFailedChatId: null,
    }),
    [],
  );
  const snapshot = useSyncExternalStore(
    assistant?.subscribe ?? (() => () => undefined),
    assistant?.getSnapshot ?? (() => empty),
    () => empty,
  );
  const active =
    snapshot.chats.find((chat) => chat.id === snapshot.activeChatId) ?? null;
  const { pending, askElsewhere } = waitingAsk(snapshot, active?.id);
  const { drafts, writeDraft, giveBack, fieldEmpty } = usePanelDrafts({
    owned: ownedDrafts,
    onDrafts,
    chats: snapshot.chats,
    returned: snapshot.returned,
    activeChatId: active?.id,
    onQuote,
  });
  const dialogs = usePanelDialogs();
  const { newChatMenu } = dialogs;
  const { scrollRef, following, setFollowing, onScroll } = useTranscriptScroll({
    assistant,
    chats: snapshot.chats,
    activeChatId: active?.id,
    pendingAskId: pending?.askId,
    revealTurnId: snapshot.revealTurnId,
  });
  const { stageRef, askingRef } = useAskingHeight(assistant);
  const { spoken, askProps, jump } = useSearchAsk({
    assistant,
    pending,
    askElsewhere,
    dockOpen,
    scrollRef,
    stageRef,
    setFollowing,
  });
  // The declaration is read at render, not with the listing: a change to the
  // project's properties re-renders the panel without re-listing, and a map
  // on the project's own structure must go stale on it.
  const declared = assistant?.declaredShape();
  const {
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
    relistNow,
  } = usePanelCatalogue({
    assistant,
    active,
    running: snapshot.running,
    structure,
    declared,
    scopeLanguage,
  });
  const lastTurn = active?.turns[active.turns.length - 1];
  // A run that failed says so in the transcript: the assistant turn carries
  // `outcome: "failed"` and the provider's own sentence, so the strip under
  // it does not say it again in the app's words, which would read as two
  // failures. The strip still carries what never became a turn, such
  // as a stopped review, whose turn's outcome is not "failed".
  const failedInTranscript =
    lastTurn?.role === "assistant" && lastTurn.outcome === "failed";
  const { chatModel, chatProvider, chatKey, remoteHost, hostOf, keySaidAbove } =
    useChatProvider({
      assistant,
      model: active?.preferences.model,
      remoteProviders,
      lastTurn,
      failedInTranscript,
    });
  // The open node, read at render as the declaration is, because it moves
  // without a re-list.
  const open = assistant?.currentNode() ?? null;
  const {
    question,
    setQuestion,
    refused,
    setRefused,
    unknownCommand,
    setUnknownCommand,
    asksNeed,
    stopped,
    openWord,
    bareNamingReview,
    transit,
    guided,
  } = useQuestion({
    assistant,
    active,
    running: snapshot.running,
    drafts,
    writeDraft,
    catalogue,
    catalogueRead,
    open,
    commandNames,
    remoteHost,
  });
  // A popup on the app's own origin, opened straight out of the click. No
  // await before it: Safari and Firefox check the gesture chain, and the
  // editor must not navigate away from a book with unsaved prose to renew a
  // key. A new key is minted the same way whether the old one lapsed or was
  // spent, and the panel never learns it happened: the account layer
  // re-reads the verdict when the popup reports back, and this re-renders.
  const openConnect = openConnectPopup;
  const { liveTurnId, evidenceNotice, propsFor } = useTurnActions({
    assistant,
    active,
    snapshot,
    lastTurn,
    commandNames,
    open,
    onNotify,
    setFollowing,
    writeDraft,
    relistNow,
    remoteProviders,
    bareNamingReview,
    renew: openConnect,
  });

  const persona = usePersonaChoice({ assistant, active });
  const { selectedPersona, focus } = persona;

  /**
   * What the run is doing, for the one live line and the one live region.
   *
   * A review keeps its count: "reviewing 4 of 31 sources" answers how long
   * this will take, which the name of the current source does not.
   * Everything else says what it is doing (`runStatus.tsx`).
   */
  const words = snapshot.runProgress
    ? (() => {
        const said = progressWords(t, snapshot.runProgress);
        return { shown: said, spoken: said };
      })()
    : activityWords(t, snapshot.activity, snapshot.preparing);
  const send = async (text: string) => {
    if (!assistant || !active) return;
    await sendLine(
      {
        assistant,
        chat: active,
        names: commandNames,
        quote,
        onQuote,
        writeDraft,
        giveBack,
        fieldEmpty,
        follow: () => setFollowing(true),
        refuseUnknownCommand: setUnknownCommand,
        refuseReference: setRefused,
      },
      text,
    );
  };

  const failedChat =
    snapshot.chats.find((chat) => chat.id === snapshot.saveFailedChatId) ??
    null;

  // The chat bar, held as state: it mounts only with a chat, after the hooks
  // have run, and the measure has to start when it does.
  const [chatBar, setChatBar] = useState<HTMLDivElement | null>(null);
  const nameShort = useModelNameShort(
    chatBar,
    active?.preferences.model?.modelId ?? "",
  );
  if (!assistant)
    return (
      <div className="dock-face dock-face-empty">
        <p>{t("dock.assistantUnavailable")}</p>
      </div>
    );

  const chatQueued = active
    ? (queuedPaths?.has(chatFilePath(active.id)) ?? false)
    : false;
  // `failedChat`, the chat whose save failed, is resolved against the live
  // list, so a deleted chat's stale id cannot put a row under the writer.
  const pendingReview = snapshot.pendingReview;
  const personaMissing =
    snapshot.problem?.kind === "persona-missing" ? snapshot.problem : null;

  return (
    <div className="dock-face ai-workspace">
      {/* Which conversation, in whose voice, and the button for a new one, on
          one line above the transcript they describe. The bar below the
          composer keeps only what changes an answer. */}
      <AiChatHead
        active={active}
        persona={selectedPersona}
        focus={focus}
        askElsewhere={askElsewhere}
        chatsOpen={dialogs.chatsOpen}
        newChatMenu={newChatMenu}
        onPersona={dialogs.openPersona}
        onChats={dialogs.openChats}
      />

      {/* The conversation keeps the whole height of the panel and everything
          else floats over it, as the command bar floats over the prose.
          `.ai-stage` is only the positioning parent. It cannot be the
          workspace itself: the foot is a sibling of the stage, and an
          absolute child of the workspace would lie over that too. */}
      <div className="ai-stage" ref={stageRef}>
        {/* The run's one live region. Always mounted, because a region
            that appears with its first message announces nothing, and outside
            every turn, because a turn remounts. The visible lines are hidden
            from assistive tech so nothing is heard twice. This is also the
            only place the streaming answer is announced, since the line shows
            no words for it. */}
        <p className="ui-visually-hidden" role="status">
          {!snapshot.running ? "" : spoken(words.spoken)}
        </p>
        {active ? (
          <div
            className="dock-scroll ai-messages"
            ref={scrollRef}
            onScroll={onScroll}
          >
            {active.turns.length === 0 ? (
              <p className="dock-hint">{t("dock.askHint")}</p>
            ) : null}
            {active.kind === "editorial" && active.plan ? (
              <AiPlan
                plan={active.plan}
                onMark={(id, state) =>
                  void assistant.room.setPlanItem(id, state)
                }
                onDraft={(item) => {
                  // Editorial to Drafting: the item becomes a new drafting
                  // chat's first words, for the writer to send or change,
                  // never sent on their behalf.
                  void assistant.chats
                    .create("drafting")
                    .then((chat) => writeDraft(chat.id, item.text));
                }}
              />
            ) : null}
            {active.kind === "beta-reader" && active.reading ? (
              <AiReadingSoFar reading={active.reading} titleOf={nodeTitleOf} />
            ) : null}
            {active.turns.map((turn, at) => (
              <AiTurn
                key={turn.id}
                turn={turn}
                hostOf={hostOf}
                journal={journalOf(active, turn)}
                {...propsFor(turn, at)}
                running={snapshot.running}
                status={
                  turn.id === liveTurnId
                    ? {
                        shown: words.shown,
                        waitedMs: snapshot.runWaitedMs,
                        ask: askProps ? (
                          <AiSearchAsk key={askProps.ask.askId} {...askProps} />
                        ) : undefined,
                      }
                    : undefined
                }
                titles={titles}
                summarisedFrom={partTitleOf(turn, active.turns, titles)}
                referenceGone={referenceGone(turn.review?.references)}
                pendingReview={pendingReview ?? null}
                liveStructure={live}
                offersMap={offersWorkflow(active.kind, "map")}
                transitProvider={remoteHost ?? undefined}
                stillMissing={stillMissing}
                chatModel={active.preferences.model}
              />
            ))}
            {/* The wait, said in words and only once. A chat
                run says it in the line of the turn it is writing; this line is
                for a run with no turn to hold it, such as a full review or a
                continuation, so the words are never on screen twice. */}
            {snapshot.running && !liveTurnId ? (
              <p className="ai-activity-row">
                <RunLine shown={words.shown} waitedMs={snapshot.runWaitedMs} />
              </p>
            ) : null}
            {!following && active.turns.length > 0 ? (
              <button
                type="button"
                /* Ember while a search waits on the writer at the bottom
                   : the one route to it from up the transcript. A
                   press here is a reveal the ask's arming restarts on, so a
                   double-click cannot land on Search. */
                className={
                  pending && !askElsewhere ? "ai-jump is-attention" : "ai-jump"
                }
                /* The sentence is the accessible name; a round button in a
                   transcript reads as "back to the bottom" without a visible
                   caption over the conversation. */
                aria-label={t(
                  pending && !askElsewhere
                    ? "dock.jumpToAsk"
                    : "dock.jumpLatest",
                )}
                onClick={jump}
              >
                <Icon name={appIcons.expand} size={14} />
              </button>
            ) : null}
            {snapshot.queued > 0 ? (
              <p className="dock-hint">
                {t("dock.queued", { count: snapshot.queued })}{" "}
                <button
                  type="button"
                  className="ai-text-button"
                  onClick={() => assistant.cancelQueued()}
                >
                  {t("dock.cancelQueued")}
                </button>
              </p>
            ) : null}
          </div>
        ) : (
          <div className="dock-face dock-face-empty ai-empty">
            <p>{t("dock.noChatsHint")}</p>
            {/* The same menu of chat kinds the head's button offers, beside
                the sentence explaining the empty panel: this is where the eye
                lands on an empty face, and the head's is at the far corner.
                It opens the menu rather than making one kind of chat, because
                a button for one room is not a button for the others. */}
            <button
              type="button"
              className="chip"
              aria-haspopup="menu"
              aria-expanded={newChatMenu.open}
              onClick={(event) => newChatMenu.toggle(event.currentTarget)}
            >
              {t("dock.newChat")}
            </button>
          </div>
        )}

        {/* Everything that is not the conversation, in one floating block: a
            refusal, the composer and the bar under it. They are all about the
            act of asking, and one block is one measured height rather than
            several the scroller would account for separately. */}
        {active ? (
          <div className="ai-asking" ref={askingRef}>
            {/* A missing persona is remedied at the one persona picker, the
                dialog the chat head opens, so the panel never has two pickers
                for one choice. Said as the dock says every blocking fact: the
                attention banner with one ember remedy. */}
            <AiRefusal
              personaMissing={!!personaMissing}
              onChoosePersona={dialogs.openPersona}
              unknownCommand={unknownCommand}
              activeKind={active.kind}
              refused={refused}
              references={references}
              catalogue={catalogue}
              problem={snapshot.problem}
              onCleanChat={() => void assistant.chats.startClean()}
              onWriteReference={onWriteReference}
              modelError={
                snapshot.error &&
                snapshot.saveFailedChatId !== (active?.id ?? null) &&
                !failedInTranscript
                  ? {
                      code: snapshot.errorCode,
                      provider: remoteHost ?? chatProvider ?? "",
                    }
                  : null
              }
            />
            {evidenceNotice ? (
              <p className="dock-hint">{evidenceNotice}</p>
            ) : null}
            {chatProvider && chatKey?.connected && !keySaidAbove ? (
              <AiKeyBanner
                provider={chatProvider}
                verdict={chatKey}
                onRenew={openConnect}
              />
            ) : null}
            {/* A review that stopped part way is offered back here, with the
                other offers, rather than in a dialog: it is
                transient, it is about the act of asking, and this block puts
                it inside the measured height. The label carries the count, so
                it is the attention remedy alone rather than a banner. */}
            {pendingReview &&
            !snapshot.running &&
            // A plan named against a reference the book does not hold is not
            // offered back to be refused. The plan's own set, or
            // its answer's when the plan's is not known here.
            !referenceGone(
              pendingReview.references ??
                active?.turns.find(
                  (one) => one.review?.runId === pendingReview.runId,
                )?.review?.references,
            ) ? (
              <div className="ai-remedy-row">
                <Button
                  variant="attention"
                  className="ui-btn-sm"
                  onClick={() =>
                    void assistant.reviews.resume(pendingReview.runId)
                  }
                >
                  {t("dock.resumeReview", {
                    complete: pendingReview.complete,
                    total: pendingReview.total,
                  })}
                </Button>
              </div>
            ) : null}
            {snapshot.continuationOffered ? (
              // The chat has outgrown its context and nothing more can be
              // asked here usefully, so it gets the lapsed key's attention
              // banner: a fact that blocks, and the one way on.
              <Banner
                tone="attention"
                action={
                  <Button
                    variant="attention"
                    className="ui-btn-sm"
                    onClick={() => void assistant.continueInNewChat()}
                  >
                    {t("dock.continueChat")}
                  </Button>
                }
              >
                {t("dock.continuationHint")}
              </Banner>
            ) : null}

            {/* The drafting room's first question, until the writer answers
                it for the Section open now. */}
            {asksNeed ? (
              <AiNeedQuestion
                stoppedAt={stopped}
                onPick={(need) => {
                  void assistant.room.setDraftingNeed(need);
                  const command = NEED_COMMANDS[need];
                  if (command) setQuestion(`/${command} `);
                }}
              />
            ) : null}
            {/* What this chat relies on that the writer has not written, as
                one quiet line rather than a banner: the persona asks for it
                in its own words, once, and this is where the answer is a
                click away. Said only between runs, and never over a refusal
                that already names its own. */}
            {missing.length > 0 &&
            !snapshot.running &&
            snapshot.problem?.kind !== "reference-needed" ? (
              <AiMissingLine
                missing={missing}
                onWriteReference={onWriteReference}
              />
            ) : null}
            {guided ? (
              <AiCommandGuide skill={guided} language={scopeLanguage} />
            ) : null}
            {/* A command bound for a remote model, said before it is
                sent: `/where` sends summaries and passages of the
                book to a vendor, which a question with nothing attached does
                not. A provider in `remoteProviders` is a vendor's API on
                another host, which `providerKind.ts` reads as remote, so
                this reads where the bytes go, never a provider's word for
                itself. The host is the one the Settings pane names. */}
            {transit && remoteHost ? (
              <AiTransitLine
                host={remoteHost}
                detail={t(transit.key, {
                  provider: remoteHost,
                  ...transit.options,
                })}
              />
            ) : null}

            {/* The field, and nothing else, so the question has the panel's
              full width at the 340px dock floor. */}
            <div className="ai-composer-row">
              <AiComposer
                value={question}
                chatId={active.id}
                quote={quote}
                pinned={pinned}
                disabled={Boolean(personaMissing)}
                running={snapshot.running}
                waiting={!!pending}
                onOpenContext={dialogs.openContext}
                commands={skillsFor(active.kind)}
                names={commandNames}
                openWord={openWord}
                onPickCommand={(skill) => setQuestion(`/${skill.command} `)}
                onChange={setQuestion}
                onSubmit={() => void send(question)}
                onDropQuote={() => onQuote(null)}
                onUnpin={(id) =>
                  void assistant.chats.updatePreferences({
                    pinnedSourceIds: active.preferences.pinnedSourceIds.filter(
                      (one) => one !== id,
                    ),
                  })
                }
                onStop={() => assistant.stop()}
              />
            </div>

            {/* Under the composer, not over the transcript. Everything on
              this bar changes an answer, while what names the conversation
              sits in the head, so a writer reading down the panel meets the
              chat's identity first and its controls last. The editorial
              readings are commands typed behind `/` in the field, not chips
              on a permanent row.

              `data-syncing`: while the chat file is queued for the remote,
              the bar says so in place of its controls, because a row
              arriving and leaving would push the composer up and down under
              the writer. The controls stay laid out and only go invisible,
              so the bar keeps its height at every width. A failed save keeps
              the foot: it carries actions, and outranks a queue. */}
            <div
              ref={setChatBar}
              className="ai-chatbar"
              data-syncing={chatQueued && !failedChat ? "" : undefined}
              data-name-short={nameShort ? "" : undefined}
            >
              {/* One line at every width: as the dock narrows, the readings
                drop their words for their meters, the Mode's track shrinks,
                and the model's name becomes "model", measured
                (`modelNameShort.ts`). The bar is a size container for the
                rest.

                The readings sit on the leading end: facts about where this
                chat stands, each a meter and a number that opens its own
                small panel with the reading drawn large. */}
              <div className="ai-chatbar-facts">
                <ContextReading
                  turns={active?.turns ?? []}
                  model={active?.preferences.model ?? null}
                />
                <CreditReading verdict={chatKey} />
              </div>
              <div className="ai-chatbar-end">
                {/* The trailing end holds the Mode and the model, the two
                    choices that decide how this conversation is answered.
                    The Mode sets how adventurous the wording is and how hard
                    the model thinks (`AiModeBar.tsx`). Keyed on the chat, so
                    a thumb held in one conversation is never drawn in the
                    next. */}
                <AiModeBar
                  key={active.id}
                  preferences={active.preferences}
                  model={chatModel}
                  onCommit={(mode) =>
                    void assistant.chats.updatePreferences({ mode })
                  }
                />
                <AiModelButton
                  assistant={assistant}
                  model={active.preferences.model ?? null}
                />
              </div>
              {chatQueued && !failedChat ? (
                /* One live region, the words; the dots are decoration. */
                <p className="ai-chatbar-status" role="status">
                  <span>{t("dock.syncing")}</span>
                  <Dots />
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* No permanent foot. Only a failed save gets a row, because it needs
          action; a save still queued for the remote is said on the chat bar.
          A failed save is shown whichever chat it belongs to, and names the
          chat when it is not the one being read: the app never holds work
          only in memory without saying so. */}
      {failedChat ? (
        <AiSaveFoot
          failedChat={failedChat}
          activeChatId={active?.id}
          titles={titles}
          live={live}
          onRetry={() => void assistant.retrySave(failedChat.id)}
        />
      ) : null}

      <AiPanelDialogs
        dialogs={dialogs}
        assistant={assistant}
        active={active}
        snapshot={snapshot}
        waiting={!!pending}
        persona={persona}
      />
    </div>
  );
}
