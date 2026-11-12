// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import EntryActions from "./EntryActions";
import Shot from "./Shot";

// ── The hero ─────────────────────────────────────────────────────────────────
//
// The product's identity, the way into the demo, and the editor itself. The
// header carries the account's ways in. The closing theme reveal shows the
// same picture again, so the page fetches it once.

export default function Hero({ withGoogle }: { withGoogle: boolean }) {
  const { t } = useTranslation();
  return (
    <section className="landing-hero" aria-labelledby="landing-title">
      <div className="landing-hero-copy">
        <p className="landing-eyebrow">{t("landing.hero.category")}</p>
        <h1 id="landing-title" className="landing-title">
          {t("landing.hero.title")}
        </h1>
        <p className="landing-lede">{t("landing.hero.lede")}</p>
        <EntryActions withGoogle={withGoogle} />
      </div>
      <Shot
        id="section"
        className="landing-hero-shot"
        alt={t("landing.hero.shotAlt")}
        priority
      />
    </section>
  );
}

/** The whole editor, in the theme chosen for the landing page. */
export function LivePage() {
  const { t } = useTranslation();
  return <Shot id="section" alt={t("landing.live.label")} />;
}
