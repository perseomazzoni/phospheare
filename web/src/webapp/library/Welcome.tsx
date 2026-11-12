// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { appIcons } from "../../ui/appIcons";
import { Button, Icon } from "../../ui";

// The welcome: the places, then the first project. Reading order is the
// hierarchy: a place first, because a project needs somewhere to live.
//
// New project and Import are locked until a place is ready. Locked, not
// disabled: both stay in the tab order, a note tied by `aria-describedby`
// says why to a screen reader, and a press flashes the places, which is how
// the reason is shown. The example project needs no place, so
// its way in is never locked.
//
// One way on leads: New project, or Show my projects once a place already
// holds some. Import stands beside it at the same height. The example is a
// link after them, since it goes to another page rather than acting on this
// one.
//
// A place may already hold projects. The welcome then stays, so the other
// place can still be set, and offers the library itself as the way on.

export default function Welcome({
  setup,
  createLocked,
  busy,
  found,
  onLockedPress,
  onShow,
  onNew,
  onImport,
  exploreTo,
}: {
  /** The places, already wired. */
  setup: ReactNode;
  /** No place to put a project yet. */
  createLocked: boolean;
  /** A project is being made or brought in: both actions wait for it. */
  busy: boolean;
  /** The projects already on the shelf. */
  found: number;
  /** A press on a locked action: point at the places. */
  onLockedPress: () => void;
  onShow: () => void;
  onNew: () => void;
  onImport: () => void;
  /** The example project's address. */
  exploreTo: string;
}) {
  const { t } = useTranslation();
  const id = useId();

  const guard = (run: () => void) => () => {
    if (createLocked) onLockedPress();
    else run();
  };
  const locked = createLocked
    ? { "aria-disabled": true, "aria-describedby": `${id}-lock` }
    : { disabled: busy };

  return (
    <div className="welcome">
      {setup}
      <section className="welcome-start" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>
          {found > 0
            ? t("library.welcome.foundTitle", { count: found })
            : t("library.welcome.startTitle")}
        </h2>
        <p>
          {found > 0
            ? t("library.welcome.foundBody")
            : t("library.welcome.startBody")}
        </p>
        {found > 0 && (
          <Button variant="primary" onClick={onShow}>
            {t("library.welcome.show")}
          </Button>
        )}
        <div className="welcome-actions">
          <Button
            variant={found > 0 ? "outline" : "primary"}
            {...locked}
            onClick={guard(onNew)}
          >
            <Icon name={appIcons.add} size={15} />
            {t("library.newProject")}
          </Button>
          <Button variant="outline" {...locked} onClick={guard(onImport)}>
            <Icon name={appIcons.importFile} size={15} />
            {t("import.heading")}
          </Button>
          <Link
            to={exploreTo}
            className="ui-text-link ui-text-link-ink ui-text-link-row"
          >
            {t("library.welcome.explore")}
          </Link>
        </div>
        {createLocked && (
          <p id={`${id}-lock`} className="ui-visually-hidden">
            {t("library.welcome.lockNote")}
          </p>
        )}
      </section>
    </div>
  );
}
