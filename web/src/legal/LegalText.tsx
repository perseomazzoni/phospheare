// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import type { LegalBlock, LegalDocument } from "./domain/documents";
import { isEmail, legalVariables, linkParts } from "./domain/facts";

// One legal text's sections, numbered by position, as the popup and the
// public pages both show them. A table is drawn as a list of terms, each row
// a term and its other cells labelled by their column, because three columns
// do not fit a phone and a description list needs no paint of its own.

export default function LegalText({
  document,
  level,
}: {
  document: LegalDocument;
  /** The sections' heading level: under the page's `h1`, or a dialog's `h2`. */
  level: 2 | 3;
}) {
  const { t, i18n } = useTranslation();
  const values = legalVariables(i18n.language);
  const Heading = level === 2 ? "h2" : "h3";
  const base = `legal.${document.text}`;

  return (
    <div className="legal-text">
      {document.sections.map((section, index) => {
        const at = `${base}.${section.id}`;
        const id = `${document.id}-${section.id}`;
        return (
          <section key={section.id} id={id} aria-labelledby={`${id}-title`}>
            <Heading id={`${id}-title`} className="legal-heading">
              {index + 1}. {t(`${at}.title`, values)}
            </Heading>
            {section.blocks.map((block) => (
              <Block
                key={block.key}
                block={block}
                at={`${at}.${block.key}`}
                values={values}
              />
            ))}
          </section>
        );
      })}
      {document.closing && (
        <p>
          <Linked text={t(`${base}.closing`, values)} values={values} />
        </p>
      )}
    </div>
  );
}

function Block({
  block,
  at,
  values,
}: {
  block: LegalBlock;
  at: string;
  values: Record<string, string>;
}) {
  const { t } = useTranslation();
  if (block.kind === "text")
    return (
      <p>
        <Linked text={t(at, values)} values={values} />
      </p>
    );
  if (block.kind === "list") {
    return (
      <ul>
        {block.items.map((item) => (
          <li key={item}>
            <Linked text={t(`${at}.${item}`, values)} values={values} />
          </li>
        ))}
      </ul>
    );
  }
  const [term, ...rest] = block.columns;
  return (
    <dl className="legal-rows">
      {block.rows.map((row) => (
        <div key={row} className="legal-row">
          <dt>{t(`${at}.rows.${row}.${term}`, values)}</dt>
          {rest.map((column) => (
            <dd key={column}>
              {t(`${at}.columns.${column}`)}:{" "}
              <Linked
                text={t(`${at}.rows.${row}.${column}`, values)}
                values={values}
              />
            </dd>
          ))}
        </div>
      ))}
    </dl>
  );
}

/**
 * A text with the repository, the licences and the contact as links. The
 * repository is another site, so it opens beside the text.
 */
function Linked({
  text,
  values,
}: {
  text: string;
  values: Record<string, string>;
}) {
  return (
    <>
      {linkParts(text, values).map((part, index) =>
        typeof part === "string" ? (
          part
        ) : isEmail(part.href) ? (
          <a key={index} href={`mailto:${part.href}`}>
            {part.href}
          </a>
        ) : part.href.startsWith("/") ? (
          <a key={index} href={part.href}>
            {part.href}
          </a>
        ) : (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {part.href}
          </a>
        ),
      )}
    </>
  );
}
