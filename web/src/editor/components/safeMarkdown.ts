// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import MarkdownIt from "markdown-it";
import type { Env } from "markdown-it";
import { citationSegments } from "../../ai/domain/citations";
import {
  groupLabel,
  webNumbers,
  type WebCitations,
} from "../../ai/domain/webCitations";

// ── The one hardened Markdown renderer ───────────────────────────────────────
//
// A reference file, a generated summary and a chat answer are all untrusted
// input: the first because the writer's folder is not a trust boundary, the
// other two because a model can be steered by anything it read. Raw HTML
// stays off; an image is rendered as its alt text instead of an `<img>` (a
// remote image is an automatic network request the writer never asked for,
// and a generated summary that carries one leaks a reading event); and links
// allow only http/https/mailto, so `javascript:` and `data:` render inert.
// `linkify` stays off: a bare URL in a note is a note, not a link.
//
// This file is the primary control, and `html: false` above all. The
// Content-Security-Policy the build carries (`security/csp.ts`)
// is the second layer behind it, not a reason to relax it: an escape here is
// still an escape into the app's own origin wherever the policy is weaker
// than it looks (it is a `<meta>` tag, with what that cannot carry). Each
// setting in this file is part of the control; a request to let a model emit
// a table with `colspan`, or a note carry a `<details>`, is a request to
// remove the whole control. Nothing outside this file configures `markdown`.

const SAFE_LINK = /^(https?:|mailto:)/i;

export const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: false,
});

markdown.renderer.rules.image = (tokens, index) => {
  const token = tokens[index];
  return token ? markdown.utils.escapeHtml(token.content) : "";
};

const defaultValidateLink = markdown.validateLink.bind(markdown);
markdown.validateLink = (url: string) =>
  SAFE_LINK.test(url.trim()) && defaultValidateLink(url);

// Every link leaves in a new tab, disowned and unendorsed.
//
// The scheme allow-list above decides whether a link may exist; this decides
// what it can do once it does. It matters most for a chat answer, where the
// model chose both the words and the destination: `noopener` denies the
// opened page a handle on this one
// (`window.opener.location = …` is a one-line phishing redirect), `noreferrer`
// keeps the writer's current URL out of the request, and `nofollow` refuses
// the endorsement a link otherwise carries. `_blank` keeps the writer's work
// where it is: a click that navigates away from a half-written chapter is a
// cost no answer is worth.
//
// What this cannot solve: the href itself can carry text in its query
// string. That is inherent to a clickable link, so this hardening is the
// floor; the inline pass below drops the links of a chat that has searched.
const defaultLinkOpen =
  markdown.renderer.rules.link_open ??
  ((tokens, index, options, _env, self) =>
    self.renderToken(tokens, index, options));
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  if (token) {
    token.attrSet("rel", "noopener noreferrer nofollow");
    token.attrSet("target", "_blank");
  }
  return defaultLinkOpen(tokens, index, options, env, self);
};

// ── Citations ────────────────────────────────────────────────────────────────
//
// An id the model wrote, drawn as the title it stands for. The model cites a
// source by its id; the writer reads its title, as a quiet control
// that opens the source. This is the one place in the app where model output
// becomes a clickable element that is not a link, so every choice below is a
// security rule, not a style preference:
//
// - A core rule over `text` tokens, never a replace over the rendered HTML.
//   A string replace would also hit an id inside an `href` or a code span and
//   splice markup into it. Code spans and fences are never `text` tokens, so
//   they are skipped for free; a text token inside a link is skipped by
//   depth, so a model-written `[node:S1](https://…)` cannot dress an external
//   link as a citation.
// - Its own token type with its own renderer, never `html_inline`. `html:
//   false` governs parsing; the renderer prints an `html_inline` token raw,
//   and one produced here would make "no raw HTML" false in the one file that
//   promises it.
// - It does nothing without `env.citations` or `env.inertLinks`. This
//   instance is shared with the Reference reader and summaries, which pass
//   neither and get plain Markdown.
//   The map is the turn's allowlist and its titles (`citableTitles`): an id
//   the turn did not use, or one missing from the live catalogue, stays as
//   the model wrote it.
// - A `<button>` with a data attribute and no href: it moves within the app,
//   through a listener the answer's container owns, which checks the id
//   against the live catalogue again at click time. It never follows a URL.
// - The title comes from the catalogue, the label from the locale, and both
//   are escaped here: i18next runs with `escapeValue: false`, so a title that
//   passed through `t()` into this string would arrive unescaped.

/** What a chat answer passes to `markdown.render` to resolve its citations. */
export interface CitationEnv extends Env {
  citations: ReadonlyMap<string, string>;
  /** The accessible name of a citation, from its title. */
  citationLabel: (title: string) => string;
  /** False while the answer streams: see `citationSegments`. */
  final?: boolean;
  /** The chat has searched: the model's links render as their words. */
  inertLinks?: boolean;
  /** Each cited `web:N`'s number in this turn; nothing else resolves. */
  webNumbers?: ReadonlyMap<string, number>;
}

/**
 * The env for one render or one parse of an answer, a new object every call.
 *
 * markdown-it writes `env.references` as it parses, so one env reused across
 * two answers lets the first's `[x]: url` definition arm `[x]` in the second,
 * a turn that may not be inert. The maps inside may be shared; the object may
 * not. The screen and the copy (`plainOf`) both come through here, so they
 * see the same rule with the same inputs.
 */
export function answerEnv({
  web,
  titles,
  final,
  citationLabel,
}: {
  web: WebCitations;
  titles: ReadonlyMap<string, string>;
  final: boolean;
  citationLabel: (title: string) => string;
}): CitationEnv {
  return {
    citations: titles,
    citationLabel,
    final,
    inertLinks: web.searched,
    webNumbers: webNumbers(web),
  };
}

function citationEnv(env: unknown): CitationEnv | null {
  const candidate = env as Partial<CitationEnv> | undefined;
  return candidate?.citations instanceof Map &&
    typeof candidate.citationLabel === "function"
    ? (candidate as CitationEnv)
    : null;
}

const NO_TITLES: ReadonlyMap<string, string> = new Map();
const NO_NUMBERS: ReadonlyMap<string, number> = new Map();

// Two jobs in one pass over every `inline` token (paragraphs, headings,
// table cells, list items, quotes), because both need the same link depth,
// counted on the original children before anything is dropped:
//
// 1. Inert links. In a chat that has searched, a page the model read
//    can have told it which href to write, and the href can carry the
//    writer's prose in its query string. So there, every
//    `link_open`/`link_close` is dropped and its words stay: an inline link,
//    a reference link, an autolink, a link wrapped round an image (whose alt
//    is all that renders anyway). `inertLinks` is read straight off the env,
//    before and apart from the citation env's own checks, so a malformed env
//    fails closed rather than skipping the pass.
// 2. Citations: an id the model wrote, drawn as what it stands for. Never
//    inside a link's text, inert or not: a `[web:1](https://x)` stays as its
//    words.
markdown.core.ruler.push("citations", (state) => {
  const inert = (state.env as { inertLinks?: unknown } | null)?.inertLinks;
  const dropLinks = inert === true;
  const env = citationEnv(state.env);
  if (!env && !dropLinks) return;
  const titles = env?.citations ?? NO_TITLES;
  const numbers = env?.webNumbers ?? NO_NUMBERS;
  // Only the last text of the whole answer can be an id still arriving.
  const inlines = state.tokens.filter((token) => token.type === "inline");
  const last = inlines[inlines.length - 1];
  const lastText = last?.children
    ?.filter((child) => child.type === "text")
    .pop();
  for (const inline of inlines) {
    const children = inline.children ?? [];
    const out: typeof children = [];
    let linkDepth = 0;
    for (const child of children) {
      const opens = child.type === "link_open";
      const closes = child.type === "link_close";
      if (opens) linkDepth += 1;
      if (closes) linkDepth = Math.max(0, linkDepth - 1);
      if ((opens || closes) && dropLinks) continue;
      if (!env || child.type !== "text" || linkDepth > 0) {
        out.push(child);
        continue;
      }
      const segments = citationSegments(
        child.content,
        titles,
        child === lastText ? env.final !== false : true,
        numbers,
      );
      for (const segment of segments) {
        if (segment.kind === "text") {
          const text = new state.Token("text", "", 0);
          text.content = segment.text;
          out.push(text);
        } else if (segment.kind === "cite") {
          const cite = new state.Token("citation", "", 0);
          cite.meta = { id: segment.id, title: segment.title };
          out.push(cite);
        } else {
          const mark = new state.Token("web_cite", "", 0);
          mark.meta = { ids: segment.ids, text: segment.text };
          out.push(mark);
        }
      }
    }
    inline.children = out;
  }
});

markdown.renderer.rules.citation = (tokens, index, _options, env) => {
  const meta = tokens[index]?.meta as { id: string; title: string };
  const label = citationEnv(env)?.citationLabel(meta.title) ?? meta.title;
  const escape = markdown.utils.escapeHtml;
  return `<button type="button" class="ai-cite" data-cite="${escape(meta.id)}" aria-label="${escape(label)}">${escape(meta.title)}</button>`;
};

// A web citation is a number and nothing else: no href, no data attribute,
// no role. It is not a control, so the answer's click listener, which
// matches `[data-cite]` alone, never sees it. The row it points at is the
// sources list's, and that is where the link is.
markdown.renderer.rules.web_cite = (tokens, index, _options, env) => {
  const meta = tokens[index]?.meta as { ids: string[]; text: string };
  const label = groupLabel(
    meta.ids,
    citationEnv(env)?.webNumbers ?? NO_NUMBERS,
  );
  const escape = markdown.utils.escapeHtml;
  return label
    ? `<sup class="ai-web-mark">${escape(label)}</sup>`
    : escape(meta.text);
};
