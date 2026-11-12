// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import { Dialog, DialogText, JobProgress } from "../../ui";

// The window over a search of a storage: settings and Library brought back
// when Remote Storage connects, or projects found in a storage. Without it
// the shelf and the settings change some seconds after the click, with
// nothing to say why.
//
// While the search runs, Escape and the backdrop do nothing, and the one
// button leaves the search running behind the window: nothing is lost by
// not waiting, because what arrives is merged with what the writer does
// meanwhile. The result stays until it is read, and names what arrived.

/** What the window shows, already translated. */
export type StorageSearchView =
  | {
      kind: "working";
      title: string;
      /** One line under the title on what the search is for. */
      lede?: string;
      steps: readonly string[];
      /** The step running now, from 0. */
      current: number;
      /** A counter for the running step ("7 di 12"). */
      detail?: string;
    }
  | {
      kind: "result";
      title: string;
      lead: string;
      items?: readonly string[];
      after?: readonly string[];
      /** Offered when the search failed and asking again may work. */
      retry?: () => void;
    };

export default function StorageSearchDialog({
  view,
  onClose,
}: {
  view: StorageSearchView | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const working = view?.kind === "working";
  const retry = view?.kind === "result" ? view.retry : undefined;

  return (
    <Dialog
      open={view !== null}
      title={view?.title}
      lede={view?.kind === "working" ? view.lede : undefined}
      dismissible={!working}
      cancelHidden={!retry}
      cancelLabel={t("library.search.close")}
      onCancel={onClose}
      confirmLabel={
        working
          ? t("library.search.background")
          : retry
            ? t("library.search.retry")
            : t("confirm.done")
      }
      confirmTone={working ? "quiet" : "primary"}
      onConfirm={retry ?? onClose}
    >
      {view?.kind === "working" && (
        <JobProgress
          steps={view.steps}
          current={view.current}
          detail={view.detail}
        />
      )}
      {view?.kind === "result" && (
        <DialogText lead={view.lead} items={view.items} after={view.after} />
      )}
    </Dialog>
  );
}
