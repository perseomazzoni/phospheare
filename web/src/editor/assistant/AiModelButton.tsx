// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Menu, useMenuAnchor, type IconName, type MenuItem } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import type { Assistant } from "../../ai";
import {
  sameModel,
  type ModelDescriptor,
  type ModelRef,
  type ProviderKind,
} from "../../ai/domain/types";
import { compareModelIds } from "./modelOrder";

/**
 * How the model button divides its list.
 *
 * Two of the three are `ProviderKind` itself: where the bytes go, the only
 * axis anything above the port branches on. The third is not a kind. It is a
 * model a chat names that nothing on offer described, so its kind is unknown,
 * and the button says so instead of guessing.
 */
type ModelGroup = ProviderKind | "unavailable";

const MODEL_GROUP_ORDER: Record<ModelGroup, number> = {
  // The writer's own machine first: it is free, private and needs no
  // account. The composite provider hands them over in the same order.
  device: 0,
  remote: 1,
  // Last, because it is the one row that cannot answer. It carries the tick,
  // so the writer looking for it still finds it.
  unavailable: 2,
};

const MODEL_GROUP_ICON: Record<ModelGroup, IconName> = {
  device: appIcons.local,
  remote: appIcons.remote,
  unavailable: appIcons.alarm,
};

/**
 * The model button on the chat bar: the model this chat answers with, and
 * the menu of models that can answer, listed when the button opens it.
 */
export default function AiModelButton({
  assistant,
  model,
}: {
  assistant: Assistant;
  /** The chat's model: the one place that fact is stored. */
  model: ModelRef | null;
}) {
  const { t } = useTranslation();
  const modelMenu = useMenuAnchor();
  // Addresses, not names. A bare id cannot be selected into a chat: two
  // providers may both offer `llama3.1`, and which one answered is a fact the
  // transcript records.
  const [models, setModels] = useState<ModelDescriptor[] | null>(null);
  // The installed models, fetched when the menu opens and not before: one
  // request (`GET /api/tags` behind the port) under the adapter's own 5s
  // budget. A menu button on a bar has to open immediately, so the menu
  // paints with what it already knows and fills in when the list lands.
  //
  // Not cached across opens: a writer who pulls a model in another window
  // and comes back would otherwise be told it does not exist. Being right
  // costs one request per press of a rarely pressed button.
  useEffect(() => {
    if (!assistant || !modelMenu.open) return;
    const controller = new AbortController();
    let live = true;
    void assistant
      .listModels(controller.signal)
      // The descriptors whole, not the addresses alone: the button groups by
      // `kind`, the one a writer needs when choosing where their words go.
      .then((found) => {
        if (live) setModels(found);
      })
      // A provider that is not running needs no dialog. The menu offers what
      // it can, and the settings row at the bottom is the way to fix it.
      .catch(() => {
        if (live) setModels([]);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [assistant, modelMenu.open]);
  // The model this chat answers with, from the one store
  // (`ChatPreferences.model`). The conversation is the grain: a model that
  // changes between two questions in one chat makes the answers
  // incomparable. A new chat inherits the most recent chat's model, so there
  // is no ambient selection and no "Default" row.
  const resolvedModel = model;
  // A model the chat names but nothing offers still appears, marked: the
  // writer must see what their conversation is set to before being asked to
  // change it. It gets its own group because its kind is unknown: nothing
  // offers it, so nothing described it, and guessing from the provider id
  // would be branching on `providerId === "ollama"`.
  const modelRows: Array<{ ref: ModelRef; group: ModelGroup }> = (
    models ?? []
  ).map((model) => ({
    ref: {
      providerId: model.providerId,
      modelId: model.id,
      modelRevision: model.revision,
    },
    group: model.kind,
  }));
  if (
    resolvedModel &&
    !modelRows.some((row) => sameModel(row.ref, resolvedModel))
  )
    modelRows.push({ ref: resolvedModel, group: "unavailable" });
  // Contiguous by group, or the same heading draws twice, and alphabetical
  // inside each group (`modelOrder.ts`, shared with the summary dialog).
  modelRows.sort(
    (a, b) =>
      MODEL_GROUP_ORDER[a.group] - MODEL_GROUP_ORDER[b.group] ||
      compareModelIds(a.ref.modelId, b.ref.modelId),
  );
  // Headings only where there is something to divide. One group under one
  // heading labels a list that is plainly one thing, which it always is
  // until a writer connects a remote provider.
  const grouped = new Set(modelRows.map((row) => row.group)).size > 1;
  const modelChoices: MenuItem[] = modelRows.map(({ ref, group }) => ({
    id: `model:${ref.providerId}:${ref.modelId}`,
    label: ref.modelId,
    icon:
      resolvedModel && sameModel(ref, resolvedModel)
        ? appIcons.confirm
        : undefined,
    group: grouped ? t(`dock.modelGroup.${group}`) : undefined,
    groupIcon: grouped ? MODEL_GROUP_ICON[group] : undefined,
    onSelect: () => void assistant.chats.updatePreferences({ model: ref }),
  }));
  // An empty list is a fact, not an empty popover. It says what it is and
  // does nothing when pressed: the remedy is in the app's settings, which
  // this row does not open.
  if (modelChoices.length === 0)
    modelChoices.push({
      id: "none",
      label: t("dock.noModelsInstalled"),
      onSelect: () => {},
    });

  return (
    <>
      {/* One button, one job: it opens the list of models that can
          answer, whether or not this chat has chosen one yet. Setting up a
          connection belongs to the app's settings. A control that becomes a
          different control by state is two controls in one button, so the
          label carries the state instead. */}
      <button
        type="button"
        className="ai-model-button"
        aria-label={t("dock.model")}
        title={resolvedModel?.modelId}
        data-short={t("dock.modelShort")}
        aria-haspopup="menu"
        aria-expanded={modelMenu.open}
        onClick={(event) => modelMenu.toggle(event.currentTarget)}
      >
        {/* Two spellings of one button: the model's name in full,
            and, on a bar too narrow to hold it, the word "model"
            (`data-short`, drawn by the stylesheet) with the name
            kept in the title. Never an ellipsis: the tail of a
            model id is where its size lives. `data-name-short`
            on the bar picks one, with the bar's container query
            in `editor.css` as the floor. */}
        <span className="ai-model-name">
          {resolvedModel ? resolvedModel.modelId : t("dock.chooseModel")}
        </span>
      </button>
      {/* Always upwards. The button is the last thing on the bar and the bar is
          10px off the bottom of the window, so a downward menu would be
          clamped against the viewport and rest over the button, hiding the
          current model while the writer chooses, with the pointer already on
          an item nobody picked. */}
      <Menu
        open={modelMenu.open}
        onClose={modelMenu.close}
        anchor={modelMenu.anchor}
        placement="above-end"
        label={t("dock.model")}
        items={modelChoices}
      />
    </>
  );
}
