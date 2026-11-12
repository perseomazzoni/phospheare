// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Banner, Icon } from "../../../ui";
import Sequence from "./Sequence";
import Shot from "./Shot";
import { DEMOS, DemoScope, TRY } from "./Demos";
import { DEMO_PATH, type CardDef, type PartDef } from "./content";
import { rich } from "./rich";
import { shown, useInView } from "./useInView";

// ── A Part of the page ───────────────────────────────────────────────────────
//
// Sections share a heading and their small demonstrations, all in view.
// Copy is at `landing.parts.<id>` and `landing.cards.<id>`.

export default function Part({
  part,
  children,
}: {
  part: PartDef;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const key = `landing.parts.${part.id}`;
  const [ref, seen] = useInView<HTMLElement>();
  // The sides alternate over the cards that have a picture; a plain card
  // pairs with its neighbour instead and takes no turn.
  const sides = new Map(
    part.cards
      .filter(pictured)
      .map((card, index) => [card, index % 2 ? "left" : "right"] as const),
  );
  return (
    <section
      id={part.id}
      className="landing-part"
      aria-labelledby={`${part.id}-title`}
    >
      <header ref={ref} className="landing-part-head" {...shown(seen)}>
        <p className="landing-eyebrow">{t(`${key}.eyebrow`)}</p>
        <h2 id={`${part.id}-title`} className="landing-part-title">
          {t(`${key}.title`)}
        </h2>
        <p className="landing-part-problem">{t(`${key}.problem`)}</p>
        <p className="landing-part-answer">{t(`${key}.answer`)}</p>
      </header>
      {part.id === "keep" && (
        <p className="landing-storage-note">{t("landing.storage.browsers")}</p>
      )}
      {children}
      {part.cards.length > 0 && (
        <div
          className="landing-bento"
          data-single={part.cards.length === 1 ? "" : undefined}
        >
          {part.cards.map((card) => (
            <Fragment key={card.id}>
              {card.group && (
                <h3 className="landing-h2 landing-group">
                  {t(`landing.groups.${card.group}`)}
                </h3>
              )}
              <Card
                card={card}
                side={card.side ?? sides.get(card) ?? "right"}
              />
            </Fragment>
          ))}
        </div>
      )}
    </section>
  );
}

/** Whether a card shows something beside its words. */
const pictured = (card: CardDef) =>
  Boolean(card.demo || card.shot || card.frames);

/** One feature: what it shows, its name, and the problem it answers. */
function Card({ card, side }: { card: CardDef; side: "left" | "right" }) {
  const { t } = useTranslation();
  const [ref, seen] = useInView<HTMLElement>();
  const key = `landing.cards.${card.id}`;
  const Demo = card.demo ? DEMOS[card.demo] : null;
  const tryIt = card.demo ? TRY[card.demo] : undefined;
  return (
    <DemoScope>
      <article
        ref={ref}
        id={card.anchor}
        className="landing-card"
        data-wide={card.wide ? "" : undefined}
        data-side={side}
        data-plain={pictured(card) ? undefined : ""}
        {...shown(seen)}
      >
        <div className="landing-card-text">
          {card.icon && (
            <Icon name={card.icon} size={24} className="landing-card-mark" />
          )}
          <h3 className="landing-card-title">{rich(t(`${key}.title`))}</h3>
          <p className="landing-card-body">{rich(t(`${key}.body`))}</p>
          {tryIt && (
            <Banner
              tone="attention"
              action={tryIt.Control && <tryIt.Control />}
            >
              <strong>{t("landing.tryIt")}</strong> {t(tryIt.hint)}
            </Banner>
          )}
          {tryIt && (
            <Link className="ui-text-link landing-try-full" to={DEMO_PATH}>
              {t("landing.tryFull")}
            </Link>
          )}
        </div>
        {pictured(card) && (
          <div className="landing-card-visual">
            {Demo && <Demo />}
            {card.frames && (
              <Sequence
                frames={card.frames}
                pace={card.pace}
                alt={t(`${key}.alt`)}
              />
            )}
            {card.shot && <Shot id={card.shot} alt={t(`${key}.alt`)} />}
          </div>
        )}
      </article>
    </DemoScope>
  );
}
