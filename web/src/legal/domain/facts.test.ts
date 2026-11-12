// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { linkParts } from "./facts";

const values = {
  publisherRepository: "https://example.org/repo",
  thirdPartyNotices: "/third-party-notices.txt",
  publisherName: "Someone",
};

describe("linkParts", () => {
  it("cuts the text at each address, in order", () => {
    expect(
      linkParts(
        "Source at https://example.org/repo. Licences at /third-party-notices.txt.",
        values,
      ),
    ).toEqual([
      "Source at ",
      { href: "https://example.org/repo" },
      ". Licences at ",
      { href: "/third-party-notices.txt" },
      ".",
    ]);
  });

  it("links the host's privacy statement", () => {
    expect(
      linkParts("Read https://example.org/privacy.", {
        ...values,
        hostPrivacy: "https://example.org/privacy",
      }),
    ).toEqual(["Read ", { href: "https://example.org/privacy" }, "."]);
  });

  it("links the certificate vendor's privacy notice inside brackets", () => {
    expect(
      linkParts("It says for how long (https://example.org/ca/privacy/).", {
        ...values,
        certificatesPrivacy: "https://example.org/ca/privacy/",
      }),
    ).toEqual([
      "It says for how long (",
      { href: "https://example.org/ca/privacy/" },
      ").",
    ]);
  });

  it("links the entire source archive even when it starts with the repository address", () => {
    const siteSource = `${values.publisherRepository}/archive/refs/tags/v1.2.3.tar.gz`;
    expect(
      linkParts(`Source at ${siteSource}.`, { ...values, siteSource }),
    ).toEqual(["Source at ", { href: siteSource }, "."]);
  });

  it("links the contact's email address", () => {
    expect(
      linkParts("Write to someone@example.org.", {
        ...values,
        privacyContact: "someone@example.org",
      }),
    ).toEqual(["Write to ", { href: "someone@example.org" }, "."]);
  });

  it("leaves a text without an address whole", () => {
    expect(linkParts("Nothing to link.", values)).toEqual(["Nothing to link."]);
  });

  it("links no placeholder and no other fact", () => {
    expect(
      linkParts("Ask [contact] or Someone.", {
        ...values,
        publisherRepository: "[contact]",
      }),
    ).toEqual(["Ask [contact] or Someone."]);
  });
});
