// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DEMOS } from "./Demos";
import Sequence from "./Sequence";
import Shot from "./Shot";
import { COMMANDS, PERSONA_FRAMES, PERSONAS, type Persona } from "./content";
import More from "./More";
import { rich } from "./rich";
import { shown, useInView } from "./useInView";

// ── The blocks only one place on the page has ────────────────────────────────
//
// The continuity check opens the page after the hero; the reference sheets
// lead into the editorial voices and the revision plan. Each heading reads
// `landing.<id>.eyebrow/title/lede`.

/** A block's heading; a block standing between Parts takes h2. */
function Head({ id, level = 3 }: { id: string; level?: 2 | 3 }) {
  const { t } = useTranslation();
  const [ref, seen] = useInView<HTMLElement>();
  const Title = level === 2 ? "h2" : "h3";
  return (
    <header ref={ref} className="landing-section-head" {...shown(seen)}>
      <p className="landing-eyebrow">{t(`landing.${id}.eyebrow`)}</p>
      <Title id={`${id}-title`} className="landing-h2">
        {rich(t(`landing.${id}.title`))}
      </Title>
      <p className="landing-section-lede">{rich(t(`landing.${id}.lede`))}</p>
    </header>
  );
}

/**
 * A block's words beside its picture, the two sides trading places from one
 * block to the next (`flip`) so the page runs as a zig-zag, not a column.
 */
function Spread({
  flip,
  picture,
  children,
}: {
  flip?: boolean;
  picture: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="landing-spread" data-flip={flip ? "" : undefined}>
      <div className="landing-spread-text">{children}</div>
      <div className="landing-spread-picture">{picture}</div>
    </div>
  );
}

const avatar = (persona: Persona) => `/landing/personas/${persona.id}.webp`;

/** The reference templates, and how the assistant reads them. */
export function Templates() {
  const { t } = useTranslation();
  const [ref, seen] = useInView<HTMLParagraphElement>();
  const Field = DEMOS.template;
  return (
    <section
      id="templates"
      className="landing-section landing-templates"
      aria-labelledby="templates-title"
    >
      <Spread picture={<Field />}>
        <Head id="templates" level={2} />
        <p className="landing-card-body">
          {rich(t("landing.templates.details"))}
        </p>
        <p
          ref={ref}
          className="landing-card-body landing-reveal"
          {...shown(seen)}
        >
          {t("landing.templates.switch")}
        </p>
      </Spread>
    </section>
  );
}

/** An example answer, rendered by the real assistant panel. */
export function Context() {
  const { t } = useTranslation();
  return (
    <div id="continuity" className="landing-block">
      <Spread
        flip
        picture={
          <Shot id="continuity" alt={t("landing.captures.continuity")} />
        }
      >
        <Head id="context" />
      </Spread>
    </div>
  );
}

/** The four personas, and one passage handed to each in turn. */
export function Team() {
  const { t } = useTranslation();
  return (
    <div className="landing-block">
      <Spread flip picture={<Voices />}>
        <Head id="team" />
      </Spread>
      <More label={rich(t("landing.team.explore"))}>
        <ul className="landing-team">
          {PERSONAS.map((persona) => (
            <li key={persona.id} className="landing-persona">
              <div className="landing-persona-head">
                <img
                  src={avatar(persona)}
                  width={96}
                  height={96}
                  alt=""
                  loading="lazy"
                />
                <div>
                  <p className="landing-persona-name">{rich(persona.name)}</p>
                  <p className="landing-persona-role">
                    {t(`landing.team.${persona.id}.role`)}
                  </p>
                </div>
              </div>
              <p className="landing-persona-line">
                {t(`landing.team.${persona.id}.line`)}
              </p>
              <ul
                className="landing-chips"
                aria-label={t("landing.team.attitudes")}
              >
                {persona.presets.map((preset) => (
                  <li key={preset}>{t(`dock.preset.${preset}.name`)}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </More>
    </div>
  );
}

/** The app’s persona and reading-approach dialog. */
function Voices() {
  const { t } = useTranslation();
  return (
    <div className="landing-voices">
      <Sequence frames={PERSONA_FRAMES} alt={t("landing.captures.personas")} />
    </div>
  );
}

/** The 24 commands as a set, grouped as the "/" menu groups them. */
export function Commands() {
  const { t } = useTranslation();
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <More label={t("landing.commands.explore")}>
      <Head id="commands" />
      <div
        ref={ref}
        className="landing-palette landing-reveal"
        {...shown(seen)}
      >
        {COMMANDS.map((group) => (
          <div key={group.chats} className="landing-palette-group">
            <h4>
              {group.chats === "shared"
                ? t("landing.commands.shared")
                : t(`dock.chatKind.${group.chats}`)}
            </h4>
            <ul>
              {group.commands.map((command) => (
                <li key={command} className="landing-command">
                  <code className="landing-feature">/{command}</code>
                  <span>{t(`dock.commandNote.${command}`)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </More>
  );
}

/** `/letter`, the most complete answer the assistant writes, in depth. */
export function Letter() {
  const { t } = useTranslation();
  const [ref, seen] = useInView<HTMLOListElement>();
  return (
    <div id="letter" className="landing-block landing-climax">
      <Spread picture={<Shot id="letter" alt={t("landing.letter.planAlt")} />}>
        <Head id="letter" />
        <div className="landing-letter-steps">
          <ol ref={ref} className="landing-reveal" {...shown(seen)}>
            {(["letter", "plan", "draft"] as const).map((id) => (
              <li key={id}>
                <span>
                  <strong>{t(`landing.letter.${id}.title`)}</strong>{" "}
                  {t(`landing.letter.${id}.body`)}
                </span>
              </li>
            ))}
          </ol>
        </div>
        <p className="landing-letter-followup">
          <strong>{t("landing.letter.followup.title")}</strong>{" "}
          {t("landing.letter.followup.body")}
        </p>
      </Spread>
    </div>
  );
}
