// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useId } from "react";
import { useTranslation } from "react-i18next";
import Scrim from "./Scrim";
import { Kbd } from "../Bits";
import { Icon } from "../icons";
import { appIcons } from "../appIcons";

// The sheet: a whole sub-surface, entered and left, with the context behind it
// preserved. Settings earns it: a writer changes a theme and gets back to work
// without losing their place on the shelf.
//
// The rung above a dialog and below an alert. A dialog asks a question and
// wants an answer; a sheet is a room the writer walks into and out of, so it
// has a close button and a title rather than a confirm and a cancel. It
// arrives from the trailing edge rather than the middle, because it is not
// interrupting: it is beside the thing it belongs to.

export interface SheetProps {
  open: boolean;
  title: string;
  /**
   * Skip the entrance. A sheet reached by deep link, bookmark or reload was
   * never opened: it is where the writer already is, and sliding it in on
   * first paint reads as a glitch, because nothing preceded it to slide over.
   */
  instant?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export default function Sheet({
  open,
  title,
  instant = false,
  onClose,
  children,
}: SheetProps) {
  const { t } = useTranslation();
  const titleId = useId();

  return (
    <Scrim
      open={open}
      place="end"
      onClose={onClose}
      labelledBy={titleId}
      className={`sheet${instant ? " sheet-instant" : ""}`}
    >
      <header className="sheet-head">
        <h2 id={titleId} className="sheet-title">
          {title}
        </h2>
        <span className="sheet-spacer" />
        {/* Printed, because Escape is the fastest way out and nothing else on
            the screen would tell a writer that it works. */}
        <Kbd>Esc</Kbd>
        <button
          type="button"
          className="ui-btn ui-btn-ghost ui-btn-square"
          aria-label={t("settings.close")}
          onClick={onClose}
        >
          <Icon name={appIcons.close} size={17} />
        </button>
      </header>
      {children}
    </Scrim>
  );
}
