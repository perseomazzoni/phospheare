// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { BrandMark } from "../../../brand/BrandMark";
import { PRODUCT } from "../../../product";
import { appIcons } from "../../../ui/appIcons";
import { Banner, Button, Icon, OverlayBackgroundProvider } from "../../../ui";
import { LEGAL } from "../../../legal/domain/facts";
import LegalLinks from "../../../legal/LegalLinks";
import LegalNoticeDialog from "../../../legal/LegalNoticeDialog";
import { motionIsStill } from "../../../ui/motion";
import EntryActions from "./EntryActions";
import type { UseLandingEntry } from "./entry";
import { LandingMotionContext } from "./motion";
import Hero, { LivePage } from "./Hero";
import Part from "./Part";
import Shot from "./Shot";
import { Commands, Context, Letter, Team, Templates } from "./Spotlights";
import { ThemePicker } from "./ThemePicker";
import {
  DEMO_PATH,
  FAQ,
  MODEL_PROVIDER,
  PARTS,
  PHONES,
  QUICKSTART_URL,
  SOURCE_URL,
  type PartDef,
} from "./content";
import More from "./More";
import { rich } from "./rich";
import { shown, useInView } from "./useInView";

// ── The landing page ─────────────────────────────────────────────────────────
//
// What a visitor who has not signed in finds at `/`. It uses the theme the
// app gives a writer with no choice stored, so changing the default theme
// changes this page too.
//
// The ways in are the root's (`entry.ts`): the full program signs a writer
// in and sends a signed-in one straight to the Library
// (`accountEntry.tsx`). The hero leads to the demo.
//
// The sequence moves from writing to revision and book-wide editorial work,
// which opens on the continuity check, with the small demonstrations
// carrying each feature, and ends on files, phones, cost, themes and the
// maker. Only the commands, the personas, the smaller features, the FAQ
// answers and the local setup sit in disclosures.
//
// The legal texts are notices to read, never asked to be accepted. The
// disclaimer stands in its own band above the footer, which links all three.

const LICENSE_URL = "https://www.gnu.org/licenses/agpl-3.0.html";

export default function Landing({ useEntry }: { useEntry: UseLandingEntry }) {
  const { t } = useTranslation();
  const entry = useEntry();
  const page = useRef<HTMLDivElement>(null);
  const [legalNotice, setLegalNotice] = useState(false);
  const [paused, setPaused] = useState(motionIsStill);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = (event: MediaQueryListEvent) => setPaused(event.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  // The header is clear over the page's top and frosted once anything
  // scrolls beneath it.
  const [top, atTop] = useInView<HTMLDivElement>({
    once: false,
    margin: "0px",
    initially: true,
  });

  if (entry.redirect) return entry.redirect;

  const motionLabel = t(
    paused ? "landing.motion.play" : "landing.motion.pause",
  );

  return (
    <LandingMotionContext.Provider value={paused}>
      <OverlayBackgroundProvider value={page}>
        <div
          ref={page}
          className="landing"
          data-paused={paused ? "" : undefined}
        >
          <div ref={top} className="landing-edge" aria-hidden="true" />
          <header
            className="landing-head"
            {...(atTop ? {} : { "data-frosted": "" })}
          >
            <a className="landing-brand" href="/" aria-label={PRODUCT.name}>
              <BrandMark size={26} />
              <span className="landing-wordmark">{PRODUCT.name}</span>
              <span className="landing-beta">{t("landing.head.beta")}</span>
            </a>
            <div className="landing-head-actions">
              <Button
                variant="icon"
                aria-label={motionLabel}
                title={motionLabel}
                onClick={() => setPaused(!paused)}
              >
                <Icon
                  name={paused ? appIcons.playMotion : appIcons.pauseMotion}
                  size={16}
                />
              </Button>
              <nav
                className="landing-head-actions"
                aria-label={t("landing.head.nav")}
              >
                {entry.head}
              </nav>
            </div>
          </header>
          <main>
            <Hero withGoogle={entry.withGoogle} />
            <Part part={PARTS.write} />
            <Part part={PARTS.organise} />
            <Foundation />
            <TryTheDemo />
            <Part part={PARTS.revise} />
            <Templates />
            <Part part={PARTS.help}>
              <Context />
              <Letter />
              <Team />
              <Commands />
            </Part>
            <Part part={PARTS.keep} />
            <Phones />
            <Free />
            <Everything />
            <ThemesSection />
            <Questions />
            <Maker />
            <Close
              withGoogle={entry.withGoogle}
              onStart={entry.onStart}
              onWithoutAccount={entry.onWithoutAccount}
              downloadUrl={entry.downloadUrl}
            />
            <NoWarranty onRead={() => setLegalNotice(true)} />
          </main>
          <footer className="landing-foot">
            <span className="landing-foot-brand">
              <BrandMark size={18} spark={false} />
              {PRODUCT.name}
              <span className="landing-beta">{t("landing.head.beta")}</span>
            </span>
            <span>
              {t("landing.foot.by", { author: LEGAL.publisher.name })}
            </span>
            <span>{t("landing.hero.price")}</span>
            <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
              {t("settings.aboutSourceLink")}
            </a>
            <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer">
              {t("settings.aboutLicenseLink")}
            </a>
            <LegalLinks onNotice={() => setLegalNotice(true)} />
          </footer>
        </div>
        {entry.dialogs}
        <LegalNoticeDialog
          open={legalNotice}
          onClose={() => setLegalNotice(false)}
        />
      </OverlayBackgroundProvider>
    </LandingMotionContext.Provider>
  );
}

/** A block's heading: what it is about, and the line under it. */
function Head({
  id,
  eyebrow = true,
  lede = true,
}: {
  id: string;
  eyebrow?: boolean;
  lede?: boolean;
}) {
  const { t } = useTranslation();
  const [ref, seen] = useInView<HTMLElement>();
  return (
    <header ref={ref} className="landing-section-head" {...shown(seen)}>
      {eyebrow && (
        <p className="landing-eyebrow">{t(`landing.${id}.eyebrow`)}</p>
      )}
      <h2 id={`${id}-title`} className="landing-h2">
        {t(`landing.${id}.title`)}
      </h2>
      {lede && (
        <p className="landing-section-lede">
          {rich(t(`landing.${id}.lede`, { provider: MODEL_PROVIDER }))}
        </p>
      )}
    </header>
  );
}

/**
 * The block further down that shows each promise at length. The promise
 * states it once and links there, so the page does not say it twice.
 */
const PROOF = { files: "keep", cost: "free", mobile: "mobile" } as const;

/** Ownership, cost and compatibility, before the editorial reveals. */
function Foundation() {
  const { t } = useTranslation();
  const [ref, seen] = useInView<HTMLUListElement>();
  return (
    <section
      id="foundation"
      className="landing-section"
      aria-labelledby="foundation-title"
    >
      <Head id="foundation" eyebrow={false} lede={false} />
      <ul
        ref={ref}
        className="landing-promises landing-reveal"
        {...shown(seen)}
      >
        {(["files", "cost", "mobile"] as const).map((id) => (
          <li key={id} className="landing-promise">
            <h3>
              <a className="landing-promise-link" href={`#${PROOF[id]}`}>
                {t(`landing.foundation.${id}.title`)}
                <Icon name="chevron" size={16} />
              </a>
            </h3>
            <p>
              {t(`landing.foundation.${id}.body`, { provider: MODEL_PROVIDER })}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The way into the demo, straight after the promises on ownership and cost:
 * the visitor knows the terms, and the whole editor is one click away.
 */
function TryTheDemo() {
  const { t } = useTranslation();
  return (
    <section id="demo" className="landing-section" aria-labelledby="demo-title">
      <div className="landing-try">
        <Head id="demo" eyebrow={false} />
        <Link className="ui-btn ui-btn-attention" to={DEMO_PATH}>
          {t("landing.hero.try")}
        </Link>
      </div>
    </section>
  );
}

/** Every Part's smaller features, together in one disclosure. */
function Everything() {
  const { t } = useTranslation();
  return (
    <section className="landing-section" aria-label={t("landing.more")}>
      <More label={t("landing.more")} className="landing-everything">
        <div className="landing-everything-groups">
          {Object.values(PARTS).map((part) => (
            <MoreOf key={part.id} part={part} />
          ))}
        </div>
      </More>
    </section>
  );
}

/** One Part's smaller features, rising into place when scrolled to. */
function MoreOf({ part }: { part: PartDef }) {
  const { t } = useTranslation();
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className="landing-reveal" {...shown(seen)}>
      <h3 className="landing-eyebrow">
        {t(`landing.parts.${part.id}.eyebrow`)}
      </h3>
      <ul>
        {part.more.map((item) => (
          <li key={item}>
            {rich(
              t(`landing.parts.${part.id}.more.${item}`, {
                provider: MODEL_PROVIDER,
              }),
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Phones() {
  const { t } = useTranslation();
  return (
    <section
      id="mobile"
      className="landing-section"
      aria-labelledby="mobile-title"
    >
      <Head id="mobile" />
      <div className="landing-phones">
        {PHONES.map((id) => (
          <Shot key={id} id={id} alt={t(`landing.mobile.alt.${id}`)} />
        ))}
      </div>
    </section>
  );
}

function Free() {
  const { t } = useTranslation();
  return (
    <section id="free" className="landing-section" aria-labelledby="free-title">
      <div className="landing-free">
        <Head id="free" />
        <div className="landing-free-actions">
          <a
            className="ui-btn ui-btn-outline"
            href={SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("landing.free.source")}
          </a>
          <a
            className="ui-text-link"
            href={QUICKSTART_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("landing.free.guide")}
          </a>
        </div>
      </div>
    </section>
  );
}

function ThemesSection() {
  const { t } = useTranslation();
  return (
    <section
      id="wear"
      className="landing-section landing-finale"
      aria-labelledby="wear-title"
    >
      <p className="landing-h2 landing-lastly">{t("landing.wear.lastly")}</p>
      <Head id="wear" eyebrow={false} />
      <div className="landing-theme-stage">
        <ThemePicker />
        <div className="landing-theme-sample">
          <LivePage />
        </div>
      </div>
    </section>
  );
}

function Maker() {
  const { t } = useTranslation();
  const [ref, seen] = useInView<HTMLQuoteElement>();
  return (
    <section className="landing-section" aria-labelledby="maker-title">
      <h2 id="maker-title" className="landing-eyebrow">
        {t("landing.maker.eyebrow")}
      </h2>
      <blockquote
        ref={ref}
        className="landing-maker landing-reveal"
        {...shown(seen)}
      >
        {(["one", "two", "three", "four", "five"] as const).map((id) => (
          <p key={id}>{t(`landing.maker.${id}`)}</p>
        ))}
        <footer>
          {t("landing.maker.sign")}{" "}
          <a
            className="ui-text-link"
            href={`${SOURCE_URL}#why-this-project`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("landing.maker.more")}
          </a>
        </footer>
      </blockquote>
    </section>
  );
}

function Questions() {
  const { t } = useTranslation();
  return (
    <section id="faq" className="landing-section" aria-labelledby="faq-title">
      <Head id="faq" eyebrow={false} />
      <div className="landing-faq">
        {FAQ.map((id) => (
          <details key={id} id={`faq-${id}`}>
            <summary>{t(`landing.faq.${id}.q`)}</summary>
            <p>
              {rich(
                t(`landing.faq.${id}.a`, {
                  product: PRODUCT.name,
                  provider: MODEL_PROVIDER,
                }),
              )}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}

/**
 * The disclaimer, in short, in a band of its own: no warranty, use at the
 * visitor's own risk, keep a copy. The whole text is one press away.
 */
function NoWarranty({ onRead }: { onRead: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="landing-section" aria-label={t("legal.links.notice")}>
      <Banner
        icon={appIcons.info}
        action={
          <Button variant="ghost" className="ui-btn-sm" onClick={onRead}>
            {t("legal.landing.more")}
          </Button>
        }
      >
        <strong>{t("legal.landing.title")}</strong> {t("legal.landing.body")}
      </Banner>
    </section>
  );
}

function Close({
  withGoogle,
  onStart,
  onWithoutAccount,
  downloadUrl,
}: {
  withGoogle: boolean;
  onStart?: () => void;
  onWithoutAccount?: () => void;
  downloadUrl?: string;
}) {
  const { t } = useTranslation();
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <section className="landing-section" aria-labelledby="close-title">
      <div ref={ref} className="landing-close landing-reveal" {...shown(seen)}>
        <BrandMark size={56} />
        <h2 id="close-title" className="landing-h2">
          {t("landing.close.title")}
        </h2>
        <EntryActions
          withGoogle={withGoogle}
          onStart={onStart}
          onWithoutAccount={onWithoutAccount}
          downloadUrl={downloadUrl}
        />
      </div>
    </section>
  );
}
