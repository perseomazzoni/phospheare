// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Icon, Scrim } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import type { AiSkill, GuideLanguage } from "../../ai/domain/skills";

// What a command is for, and where it would send the book. While the writer
// types a command, the space above the composer holds its guide: what it
// does, when it is for, how to type it. The text comes from the command's own
// file (`guide.*` in `skills/*.md`), so a command and its explanation cannot
// drift apart.
//
// The transit notice must stay: whenever a run would reach a vendor, it is
// said before Enter. One line names the destination every
// time, so nothing travels unannounced; the full list of what leaves is one
// press away in a dialog.

/** The guide of the command being typed, in the interface's language. */
export function AiCommandGuide({
  skill,
  language,
}: {
  skill: AiSkill;
  language: GuideLanguage;
}) {
  const { t } = useTranslation();
  const guide = skill.guide[language];
  return (
    <div className="dock-hint ai-guide">
      <p>
        <span className="ai-guide-command">/{skill.command}</span> {guide.what}
      </p>
      <p>
        <span className="ai-guide-label">{t("dock.guide.when")}</span>{" "}
        {guide.when}
      </p>
      <p>
        <span className="ai-guide-label">{t("dock.guide.how")}</span>{" "}
        {guide.how}
      </p>
    </div>
  );
}

/**
 * The transit notice as one line naming the destination, with the full
 * notice behind it. `detail` is the notice, already worded for the command
 * being typed; this component only decides how much of it is on the surface.
 */
export function AiTransitLine({
  host,
  detail,
}: {
  host: string;
  detail: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const bodyId = useId();
  const describedId = useId();
  const done = useRef<HTMLButtonElement>(null);
  return (
    <>
      <p className="dock-hint ai-transit">
        <button
          type="button"
          className="ui-text-link ai-transit-line"
          aria-haspopup="dialog"
          aria-describedby={describedId}
          onClick={() => setOpen(true)}
        >
          <Icon name={appIcons.words} size={13} />
          {t("dock.transitLine", { provider: host })}
        </button>
        {/* The whole notice stays in the document as the line's description,
            so a screen reader hears it on focus and it is never absent from
            the page while it applies. */}
        <span id={describedId} className="ui-visually-hidden">
          {detail}
        </span>
      </p>
      {open ? (
        <Scrim
          open
          dismissible
          onClose={() => setOpen(false)}
          labelledBy={titleId}
          describedBy={bodyId}
          initialFocus={() => done.current}
          className="ui-dialog"
        >
          <header className="ui-dialog-head">
            <h2 id={titleId} className="ui-dialog-title">
              {t("dock.transitTitle", { provider: host })}
            </h2>
          </header>
          <div className="ui-dialog-body">
            <p id={bodyId} className="ui-alert-body">
              {detail}
            </p>
          </div>
          <footer className="ui-dialog-foot">
            <Button ref={done} variant="soft" onClick={() => setOpen(false)}>
              {t("dock.transitAgree")}
            </Button>
          </footer>
        </Scrim>
      ) : null}
    </>
  );
}
