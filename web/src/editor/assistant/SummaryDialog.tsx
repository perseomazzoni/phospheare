// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, Dots, Select } from "../../ui";
import {
  ModelRunError,
  SummarySourceChangedError,
  SummarySourceMissingError,
  sameModel,
  type Assistant,
  type ModelDescriptor,
  type ModelRef,
} from "../../ai";
import { compareModelIds } from "./modelOrder";
import { openConnectPopup } from "../../ai/connectPath";

// Creating or updating a node's summary, from a Section's or a Part's row
// menu in the structure tree. The chat is not involved at any point: the
// model is chosen here, the run is held here, and a failure is said here.
//
// Three states in one dialog, so the writer never loses the place they asked
// from: choose (which model writes it), working (the three dots, with the
// page held under the scrim and Escape and the backdrop inert: a summary
// half-written and abandoned by a stray keypress is one they have to start
// again without knowing why), and failed (what went wrong, and Try again).
// Stopping is a decision, so Stop stays a real button throughout.

/**
 * The last model a summary was written with, for this session. In memory and
 * not in storage: a stored pick would be one more thing keyed by account and
 * purged on sign-out, for a convenience worth one extra choice per reload.
 */
let lastModel: ModelRef | null = null;

type Phase =
  | { kind: "choose" }
  | { kind: "working" }
  | {
      kind: "failed";
      message: string;
      /**
       * A key the writer can mend from here (expired, or its limit spent),
       * and whose. The same popup renews either; the dialog stays open, and
       * Try again runs once the popup has done its work.
       */
      remedy?: { providerId: string; label: string };
    };

export interface SummaryDialogProps {
  assistant: Assistant;
  nodeId: string;
  /** The node's title, said under the heading so the writer sees which. */
  title: string;
  /** Whether a summary already exists, which is Update rather than Create. */
  update: boolean;
  onClose: () => void;
  /** The summary is written; the caller opens it. */
  onDone: (nodeId: string) => void;
  /** The host behind a provider id, for the failure sentences. */
  hostOf?: (providerId: string) => string | undefined;
}

/** A model's id as the `<select>` carries it: both halves of the address. */
function keyOf(ref: ModelRef): string {
  return `${ref.providerId}\u0000${ref.modelId}`;
}

function refOf(model: ModelDescriptor): ModelRef {
  return {
    providerId: model.providerId,
    modelId: model.id,
    modelRevision: model.revision,
  };
}

export default function SummaryDialog({
  assistant,
  nodeId,
  title,
  update,
  onClose,
  onDone,
  hostOf,
}: SummaryDialogProps) {
  const { t } = useTranslation();
  const [models, setModels] = useState<ModelDescriptor[] | null>(null);
  const [chosen, setChosen] = useState<ModelRef | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "choose" });
  const run = useRef<AbortController | null>(null);

  // What can write it, asked once when the dialog opens: local first, then
  // remote, alphabetical inside each, the order of the chat's model button.
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    void assistant
      .listModels(controller.signal)
      .then((found) => {
        if (!live) return;
        const sorted = [...found].sort(
          (a, b) =>
            Number(a.kind === "remote") - Number(b.kind === "remote") ||
            compareModelIds(a.id, b.id),
        );
        setModels(sorted);
        const remembered = lastModel;
        const first =
          (remembered &&
            sorted.find((model) => sameModel(refOf(model), remembered))) ||
          sorted[0];
        setChosen(first ? refOf(first) : null);
      })
      // A provider that is not running is not a second error to report: the
      // list is empty, and the dialog says what that means.
      .catch(() => {
        if (live) setModels([]);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [assistant]);

  // Leaving mid-run (the editor closing under it) stops the run it started.
  useEffect(() => () => run.current?.abort(), []);

  const failureFor = (
    error: unknown,
    model: ModelRef,
  ): Extract<Phase, { kind: "failed" }> => {
    // A refusal about the key says its fact, then offers the mend as a link
    // in the sentence itself: "Renew it to continue" is an instruction the
    // writer can only follow from somewhere else unless it is also the way
    // to do it.
    if (error instanceof ModelRunError && error.failure.code === "key-expired")
      return {
        kind: "failed",
        message: t("summary.keyExpired"),
        remedy: { providerId: model.providerId, label: t("summary.renewKey") },
      };
    if (
      error instanceof ModelRunError &&
      error.failure.code === "limit-reached"
    )
      return {
        kind: "failed",
        message: t("dock.modelError.limit-reached"),
        remedy: { providerId: model.providerId, label: t("summary.newKey") },
      };
    return { kind: "failed", message: messageFor(error, model) };
  };

  const messageFor = (error: unknown, model: ModelRef): string => {
    const provider = hostOf?.(model.providerId) ?? model.providerId;
    if (error instanceof SummarySourceChangedError)
      return t("dock.problem.summary-source-changed");
    if (error instanceof ModelRunError)
      return t(`dock.modelError.${error.failure.code}`, { provider });
    if (error instanceof SummarySourceMissingError)
      return t("dock.problem.summary-source-missing");
    return t("dock.modelError.unknown");
  };

  const create = () => {
    if (!chosen) return;
    const model = chosen;
    lastModel = model;
    const controller = new AbortController();
    run.current = controller;
    setPhase({ kind: "working" });
    assistant.summaries.generate(nodeId, model, controller.signal).then(
      () => {
        run.current = null;
        onDone(nodeId);
      },
      (error: unknown) => {
        run.current = null;
        // Stopped by the writer: the dialog is already closing.
        if (controller.signal.aborted) return;
        setPhase(failureFor(error, model));
      },
    );
  };

  const stop = () => {
    run.current?.abort();
    run.current = null;
    onClose();
  };

  const working = phase.kind === "working";
  const grouped = new Set(models?.map((model) => model.kind)).size > 1;

  return (
    <Dialog
      open
      title={t(update ? "summary.updateTitle" : "summary.createTitle")}
      lede={title}
      // Never closed from behind, not by Escape and not by a click outside,
      // in any state. Mid-run, a close would cancel the summary the writer
      // is waiting for; before it, a stray click would lose the model they
      // just chose. Cancel and Stop are the ways out, and both are decisions.
      dismissible={false}
      confirmLabel={
        phase.kind === "failed"
          ? t("summary.retry")
          : t(update ? "summary.update" : "summary.create")
      }
      cancelLabel={working ? t("summary.stop") : undefined}
      // Off, not busy, while it works: the dots in the body are the waiting,
      // and a second set in the button would be the same fact said twice.
      confirmDisabled={!chosen || working}
      onConfirm={working ? () => undefined : create}
      onCancel={working ? stop : onClose}
      className="summary-dialog"
    >
      {working ? (
        <div className="summary-wait">
          <Dots />
          <p role="status">{t("summary.working")}</p>
        </div>
      ) : models === null ? (
        <div className="summary-wait">
          <Dots label={t("summary.loadingModels")} />
        </div>
      ) : models.length === 0 ? (
        <p className="summary-note">{t("summary.noModels")}</p>
      ) : (
        <>
          <Select
            label={t("summary.model")}
            value={chosen ? keyOf(chosen) : ""}
            options={models.map((model) => ({
              value: keyOf(refOf(model)),
              label: model.id,
              group: grouped ? t(`dock.modelGroup.${model.kind}`) : undefined,
            }))}
            onChange={(value) => {
              const found = models.find(
                (model) => keyOf(refOf(model)) === value,
              );
              if (found) setChosen(refOf(found));
            }}
          />
          {phase.kind === "failed" ? (
            <p className="summary-note is-error" role="alert">
              {phase.message}
              {phase.remedy ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="summary-link"
                    onClick={() =>
                      phase.remedy && openConnectPopup(phase.remedy.providerId)
                    }
                  >
                    {phase.remedy.label}
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
        </>
      )}
    </Dialog>
  );
}
