// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The publisher's facts the notices state: who publishes the program, the
// repository, the version shown on this installation, and the demo site's
// host and where it states what it does with the visits it records. They live once, in `LEGAL`.
// The words are the locale files' (`legal.*`); a fact reaches them only as an
// interpolation variable, so a release changes a fact in one place and both
// languages follow.
//
// The vendors the privacy notice names are facts too. The copy never spells
// a vendor, so each recipient's name is a variable here.

export interface LegalFacts {
  /** When the texts last changed: an ISO date, or a placeholder while unset. */
  updated: string;
  publisher: { name: string; repository: string; privacyContact: string };
  /**
   * The demo site: its host, and the host's own privacy statement, which
   * says how it keeps the visits it records. The host states no fixed period.
   */
  site: { host: string; hostPrivacy: string };
}

export const LEGAL: LegalFacts = {
  updated: "2026-11-12",
  publisher: {
    name: "Perseo Mazzoni",
    repository: "https://github.com/perseomazzoni/phospheare",
    privacyContact: "contact@oncedark.studio",
  },
  site: {
    host: "GitHub",
    hostPrivacy:
      "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement",
  },
};

/**
 * The services the texts name, each contacted from the writer's device. The
 * sign-in identity and the remote storage are one vendor; the search engines
 * are two; the home network's name and certificate are the desktop app's.
 * The mail vendor carries the publisher's mailbox, not the program's data.
 */
export const VENDORS = {
  identity: "Google",
  ai: "OpenRouter",
  encyclopedia: "Wikipedia",
  webSearch: "Exa",
  homeDns: "deSEC",
  certificates: "Let's Encrypt",
  updates: "GitHub",
  mail: "Infomaniak",
  supervisor: "garanteprivacy.it",
} as const;

/**
 * Where the certificate vendor states how long it keeps the addresses that
 * requests come from. The privacy notice links it and names no period.
 */
const CERTIFICATES_PRIVACY = "https://letsencrypt.org/privacy/";

export const LICENSE_URL = "https://www.gnu.org/licenses/agpl-3.0.html";
const SITE_LICENSE = "/LICENSE.txt";

/** Where a build serves the third-party licences (`tools/generate-notices.mjs`). */
export const THIRD_PARTY_NOTICES = "/third-party-notices.txt";

/**
 * Every fact as an interpolation variable. `updated` is set as a date in the
 * reader's language once it is one; a placeholder shows as written, so an
 * unfilled fact is visible on the page.
 */
export function legalVariables(language: string): Record<string, string> {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(LEGAL.updated)
    ? new Intl.DateTimeFormat(language, { dateStyle: "long" }).format(
        new Date(`${LEGAL.updated}T12:00:00Z`),
      )
    : LEGAL.updated;
  return {
    updated: date,
    publisherName: LEGAL.publisher.name,
    publisherRepository: LEGAL.publisher.repository,
    privacyContact: LEGAL.publisher.privacyContact,
    licenseText: LICENSE_URL,
    siteLicense: SITE_LICENSE,
    siteSource: __RELEASE_TAG__
      ? `${LEGAL.publisher.repository}/archive/refs/tags/${encodeURIComponent(__RELEASE_TAG__)}.tar.gz`
      : LEGAL.publisher.repository,
    sessionCookie: "phospheare_session",
    flowCookie: "phospheare_flow_<flow>",
    connectionCookie: "phospheare_g_<connection>",
    keyCookie: "phospheare_k_<slot>",
    host: LEGAL.site.host,
    hostPrivacy: LEGAL.site.hostPrivacy,
    certificatesPrivacy: CERTIFICATES_PRIVACY,
    thirdPartyNotices: THIRD_PARTY_NOTICES,
    ...VENDORS,
  };
}

/**
 * A legal text cut at its addresses: the words, and each address to link. An
 * email address is an address too; the page links it with `mailto:`.
 */
export type LegalPart = string | { href: string };

const EMAIL = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;

/** Whether a linked fact is an email address, not a page. */
export const isEmail = (href: string): boolean => EMAIL.test(href);

/**
 * The facts a text shows as links. A fact still holding a placeholder is
 * no address and stays words.
 */
const LINKED = [
  "publisherRepository",
  "privacyContact",
  "licenseText",
  "siteLicense",
  "siteSource",
  "thirdPartyNotices",
  "hostPrivacy",
  "certificatesPrivacy",
] as const;

/** Cuts text at every linked fact it names, in the order they appear. */
export function linkParts(
  text: string,
  values: Record<string, string>,
): LegalPart[] {
  const hrefs = LINKED.map((name) => values[name] ?? "")
    .filter(
      (href) =>
        href.startsWith("https://") || href.startsWith("/") || isEmail(href),
    )
    .sort((a, b) => b.length - a.length);
  const parts: LegalPart[] = [];
  let rest = text;
  for (;;) {
    let at = -1;
    let href = "";
    for (const candidate of hrefs) {
      const found = rest.indexOf(candidate);
      if (found >= 0 && (at < 0 || found < at)) [at, href] = [found, candidate];
    }
    if (at < 0) break;
    if (at > 0) parts.push(rest.slice(0, at));
    parts.push({ href });
    rest = rest.slice(at + href.length);
  }
  if (rest) parts.push(rest);
  return parts;
}
