// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import { Icon } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import type { CitedSource } from "../../ai/domain/webCitations";
import { shownSite } from "../../ai/domain/webText";
import type { SourceQuote } from "./verifyAnswer";

// The web results an answer cited: a numbered row per cited source,
// after the prose, with no heading, since the numbers are the answer's
// markers. Only what the answer cited, never everything the search returned:
// a row for an unused result would put a source under a claim it never
// supported.
//
// Every value is decided once, upstream, in `webCitations`: the number is the
// row's position in `cited`, the title is clipped to what the model was
// shown, and the site is derived from the url the row opens. This file adds
// no ordinal and derives no host. It only cuts a long host at whole labels
// for the eye, keeping the whole host for the ear and the hover.
//
// The link is the writer's own click to a url a search engine returned and
// the codec checked: `href` is the stored url, never text the model wrote,
// so a model cannot plant a link. It opens in `_blank` with no opener,
// referrer or endorsement, and nothing is prefetched (no favicon, no
// preconnect), so the page learns nothing before the click.
//
// A `/verify` row may carry the words its source was quoted for, under the
// link and outside it: a `q` in the host language's marks around a `bdi`
// that alone carries the page's language, so the marks follow the dock and
// the pronunciation follows the page. The quote is a prop, never a field of
// `CitedSource`, because the walk that replays sources to the model must
// never hold a quote. No label: the row it hangs under is its attribution.

export default function AiWebSources({
  cited,
  quotes,
}: {
  cited: readonly CitedSource[];
  /** A `/verify` verdict's quotes, by row id; drawn only under a row. */
  quotes?: ReadonlyMap<string, SourceQuote>;
}) {
  const { t } = useTranslation();
  if (cited.length === 0) return null;
  return (
    <ol className="ai-web-sources" aria-label={t("dock.web.sources")}>
      {cited.map((source) => {
        const shown = shownSite(source.site);
        const site = (
          // Its own left-to-right isolate, so an RTL title cannot reorder the
          // host's dots. The full host is what is heard, and what the hover
          // shows when the eye gets a cut one.
          <small
            className="ai-web-site"
            title={shown === source.site ? undefined : source.site}
          >
            <bdi dir="ltr" aria-hidden="true">
              {shown}
            </bdi>{" "}
            <span className="ui-visually-hidden">{source.site}</span>{" "}
            <span className="ui-visually-hidden">{t("dock.web.newTab")}</span>
            <Icon name={appIcons.external} size={10} />
          </small>
        );
        const quote = quotes?.get(source.id);
        return (
          <li key={source.id}>
            <a
              className="ai-evidence ai-web-source"
              href={source.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              <small className="ai-web-n">{source.n}</small>{" "}
              {/* A result the engine returned without a title is named by
                  its host, in the title's place. */}
              {source.title ? (
                <>
                  <span title={source.title}>{source.title}</span> {site}
                </>
              ) : (
                site
              )}
            </a>
            {quote ? (
              <p className="dock-hint ai-web-quote">
                <q>
                  <bdi lang={quote.lang}>{quote.text}</bdi>
                </q>
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
