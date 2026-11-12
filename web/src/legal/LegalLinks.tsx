// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { Fragment, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { LEGAL_SET } from "./compose";
import { LEGAL_PATHS } from "./domain/paths";

// The build's legal texts as links. The notice opens its popup on a plain
// click and stays a real link to its page, so a middle click or a copied
// address still reaches it. Privacy and terms open their pages in a new tab,
// so leaving a dialog to read them loses nothing; inside a dialog the notice
// does the same, because a popup over a dialog would hide what it explains.

export default function LegalLinks({
  onNotice,
  separated = false,
  className,
}: {
  /** Opens the notice's popup; without it the notice opens in a new tab. */
  onNotice?: () => void;
  /** A middle dot between links, for a footer that runs as one line of text. */
  separated?: boolean;
  /**
   * The kit link class where no surrounding rule paints the links, as in a
   * dialog; a footer paints its own.
   */
  className?: string;
}) {
  const { t } = useTranslation();
  const openNotice = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onNotice) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey)
      return;
    event.preventDefault();
    onNotice();
  };
  const links = LEGAL_SET.map(({ id }) =>
    id === "notice" && onNotice ? (
      <a
        key={id}
        className={className}
        href={LEGAL_PATHS[id]}
        onClick={openNotice}
      >
        {t(`legal.links.${id}`)}
      </a>
    ) : (
      <a
        key={id}
        className={className}
        href={LEGAL_PATHS[id]}
        target="_blank"
        rel="noopener"
      >
        {t(`legal.links.${id}`)}
      </a>
    ),
  );
  return links.map((link, index) => (
    <Fragment key={link.key}>
      {separated && index > 0 && <span aria-hidden="true"> · </span>}
      {link}
    </Fragment>
  ));
}
