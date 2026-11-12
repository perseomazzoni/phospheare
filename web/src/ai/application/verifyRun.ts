// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// `/verify`: a claim checked against the web, with the writer's word before
// each search. The question and its answer are written ahead of the run
// (`checkClaim`) and kept whatever the ending. Every refusal comes first
// (`verifyTarget`), and the run takes the aggregate's entry point through
// `WorkflowHost`.

import type { WorkflowHost } from "./workflowRun";
import { now, webOf, workflowPair } from "./runRecords";
import { newId } from "./ids";
import { DEFAULT_CONTEXT_TOKENS } from "./budgets";
import { withTurn } from "./chatWrites";
import { ModelRunError } from "./runStep";
import type { SearchPause, SearchPauseDependencies } from "./searchAsk";
import { verifyClaim } from "./verifyClaim";
import { runElapsedMs } from "../domain/runClock";
import { commandLine, offersWorkflow, verifySkill } from "../domain/skills";
import { lastWebIndexOf } from "../domain/webCitations";
import { searchesWeb } from "../domain/webEngine";
import type { ChatRecord, ModelDescriptor, ModelRef } from "../domain/types";

/** A check every refusal let through, and the account it runs under. */
interface VerifyTarget {
  chat: ChatRecord;
  model: ModelRef;
  descriptor: ModelDescriptor;
  webSearch: SearchPauseDependencies["webSearch"];
  account: string;
}

/**
 * `/verify <claim>`, or a bare `/verify` over a quote, in place of
 * `replacing` when a Retry asks it again. Resolves `rejected` for a
 * refusal, so the panel can give the words back, and `started` once a check
 * that began has ended, whatever its ending.
 */
export async function startVerify(
  host: WorkflowHost,
  claim: string,
  quote: string | undefined,
  /** The pair a Retry asks again in place of. */
  replacing?: string,
): Promise<"started" | "rejected"> {
  const said = claim.trim();
  return host.runWorkflow({
    prepare: async () => {
      const chat = host.activeChat();
      return chat ? verifyTarget(host, chat, said, quote) : null;
    },
    failure: "The check could not be started.",
    chatId: ({ chat }) => chat.id,
    start: () => ({ activity: { kind: "preparing" }, runWaitedMs: 0 }),
    run: (prepared, signal) =>
      checkClaim(host, prepared, said, quote, replacing, signal),
    stopped: ({ chat }, error) =>
      host.endWorkflowRun(chat.id, error, [
        "Check stopped.",
        "The check was interrupted.",
      ]),
    end: {
      preparing: false,
      activity: null,
      pendingSearch: null,
      runWaitedMs: 0,
    },
  });
}

/**
 * The check itself, its pair written ahead and kept whatever the ending.
 * The caller owns the run and reports how one that did not finish ended.
 */
async function checkClaim(
  host: WorkflowHost,
  prepared: VerifyTarget,
  said: string,
  quote: string | undefined,
  replacing: string | undefined,
  signal: AbortSignal,
): Promise<void> {
  const { chat, model, descriptor, webSearch, account } = prepared;
  // Written ahead, unlike `/where`'s pair: a search is about to be asked
  // for, and a reload mid-check must still say a query may have left. The
  // answer turn carries its marker from this moment, so however the run
  // ends it is never edited into a question.
  const placed = workflowPair(
    chat,
    {
      text: commandLine({
        skill: verifySkill.command,
        ...(said ? { argument: said } : {}),
      }),
      ...(quote ? { quote } : {}),
    },
    {
      text: "",
      verifies: true,
      model,
      outcome: "interrupted",
      errorCode: "interrupted",
    },
    replacing,
  );
  let working = placed.chat;
  const answerId = placed.answerId;
  const startedAt =
    working.turns.find((turn) => turn.id === answerId)?.createdAt ?? now();
  let pause: SearchPause | null = null;
  const elapsed = () => runElapsedMs(startedAt, pause?.waitedMs ?? 0, now());
  host.writes.previewRun(chat, working);
  try {
    await host.writes.persistRun(chat, working);
    pause = host.searchPauseFor(webSearch, {
      model,
      account,
      signal,
      lastWebIndex: lastWebIndexOf(working.turns),
      // The writer's words this check holds: the quote, and only it. The
      // claim is theirs too, but it is what is being searched for; a
      // query that repeats it is the point, not a leak.
      bookTexts: () => (quote ? [quote] : []),
      onRecords: async (records) => {
        working = withTurn(working, answerId, { web: [...records] });
        host.writes.previewRun(chat, working);
        await host.writes.persistRun(chat, working);
      },
    });
    const result = await verifyClaim(
      {
        model: host.dependencies.model,
        descriptor,
        modelRef: model,
        pause,
        rubric: verifySkill.instruction,
        newId,
        stillSigned: () => {
          if (webSearch.accountId() !== account)
            throw new ModelRunError({
              code: "cancelled",
              message: "The account changed.",
              retryable: false,
            });
        },
        onActivity: (activity) => host.publish({ activity }),
      },
      { claim: said, ...(quote ? { quote } : {}) },
      signal,
    );
    working = withTurn({ ...working, updatedAt: now() }, answerId, {
      text: result.text,
      verified: result.verified,
      outcome: "complete",
      // Set to undefined: the placeholder's code must not survive the merge.
      errorCode: undefined,
      elapsedMs: elapsed(),
      web: webOf(pause),
      usage: {
        ...result.usage,
        contextWindow: descriptor.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
      },
    });
    await host.writes.persistRun(chat, working);
  } catch (error) {
    if (host.isDisposed()) throw error;
    const cancelled =
      error instanceof ModelRunError && error.failure.code === "cancelled";
    const failureCode =
      error instanceof ModelRunError ? error.failure.code : null;
    // Every search the check was asked about is kept, whatever the ending:
    // a Stop while an ask waited leaves its rows declined.
    working = withTurn({ ...working, updatedAt: now() }, answerId, {
      outcome: cancelled ? "interrupted" : "failed",
      errorCode: cancelled ? "cancelled" : (failureCode ?? undefined),
      elapsedMs: elapsed(),
      web: webOf(pause),
    });
    await host.writes.persistRun(chat, working);
    throw error;
  } finally {
    host.releasePause(pause);
  }
}

/**
 * Every `/verify` refusal, before anything is written, asked or sent, in
 * the order a writer can act on them. Two layers for a reader chat, as
 * `/where` has: the menu offers `/verify` only where its file says, and a
 * chat whose horizon the web breaks is refused here whatever the file says.
 */
async function verifyTarget(
  host: WorkflowHost,
  chat: ChatRecord,
  claim: string,
  quote: string | undefined,
): Promise<VerifyTarget | null> {
  if (!offersWorkflow(chat.kind, "verify") || !searchesWeb(chat.kind))
    return null;
  // Nothing to check: the panel keeps a bare line in the field, so this
  // is a backstop for any other caller.
  if (!claim && !quote) return null;
  if (
    host.refusesArgument(
      { skill: verifySkill.command, argument: claim },
      "verify-too-long",
    )
  )
    return null;
  const model = chat.preferences.model;
  if (!model) {
    host.publish({ errorCode: "not-configured", error: null });
    return null;
  }
  const descriptor = await host.dependencies.model.describeModel(
    model,
    new AbortController().signal,
  );
  if (!descriptor.capabilities.tools) {
    host.publish({
      problem: { kind: "verify-needs-tools", model: descriptor.label },
    });
    return null;
  }
  // Search needs an account, and the one the check begins under is the
  // one every send and every request must still be.
  const webSearch = host.dependencies.webSearch;
  const account = webSearch?.accountId() ?? null;
  if (!webSearch || account === null) {
    // Said, never a silent refusal: the words go back to the field, and
    // without this the writer is left to guess why.
    host.publish({ problem: { kind: "verify-needs-account" } });
    return null;
  }
  if (host.isDeleted(chat.id)) return null;
  return { chat, model, descriptor, webSearch, account };
}

/** `/verify`, bound to the aggregate. */
export function bind(host: WorkflowHost) {
  return {
    run: (claim: string, quote?: string) => startVerify(host, claim, quote),
  };
}
