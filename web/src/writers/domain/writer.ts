// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { DriveGrant, GoogleIdentity } from "../../platform/types";

// An account of this browser: one record per Google account that signed in
// here, and at most one without Google. Its id is the key every local store
// files its records under (`currentUser.ts`), so the same Google account
// finds its library again at the next sign-in, and two accounts never share
// one. The Google identity is matched on `sub` only; its name, email and
// picture are labels refreshed at each sign-in. An account without Google
// never gains one, and a Remote Storage grant must be the account's own Google
// account's (`docs/architecture.md`).

export interface WriterDrive extends DriveGrant {
  connectedAt: string;
}

export interface WriterRecord {
  id: string;
  createdAt: string;
  /** The Google account, or `null` for the account without one. */
  google: GoogleIdentity | null;
  drive: WriterDrive | null;
  /**
   * When the account first entered this browser with the login splash, or
   * `null` until it has. The splash plays once per account.
   */
  welcomedAt: string | null;
  /**
   * Remote Storage was disconnected leaving the account's settings and
   * Library there; false when they were removed, or it was never connected.
   */
  remoteCopiesKept: boolean;
}

const ID = /^[A-Za-z0-9_-]{16,64}$/;

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** An account id: 128 random bits, base64url, inside every store's id rule. */
export function newWriterId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** A new account for `google`, or without Google for `null`, under `id`. */
export function newWriter(
  id: string,
  google: GoogleIdentity | null,
  now: Date,
): WriterRecord {
  return {
    id,
    createdAt: now.toISOString(),
    google,
    drive: null,
    welcomedAt: null,
    remoteCopiesKept: false,
  };
}

export function asIdentity(value: unknown): GoogleIdentity | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.sub !== "string" || v.sub === "" || typeof v.iss !== "string")
    return null;
  return {
    iss: v.iss,
    sub: v.sub,
    email: typeof v.email === "string" ? v.email : "",
    emailVerified: v.emailVerified === true,
    name: typeof v.name === "string" ? v.name : "",
    picture: typeof v.picture === "string" ? v.picture : null,
  };
}

function asDrive(value: unknown): WriterDrive | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.connectionId !== "string" || typeof v.sub !== "string")
    return null;
  return {
    connectionId: v.connectionId,
    sub: v.sub,
    email: typeof v.email === "string" ? v.email : "",
    scopes: Array.isArray(v.scopes)
      ? v.scopes.filter((s): s is string => typeof s === "string")
      : [],
    connectedAt: typeof v.connectedAt === "string" ? v.connectedAt : "",
  };
}

/** A stored record, or `null` when it is not an account. */
export function asWriter(value: unknown): WriterRecord | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || !ID.test(v.id)) return null;
  const google = v.google === null ? null : asIdentity(v.google);
  if (v.google !== null && !google) return null;
  return {
    id: v.id,
    createdAt: typeof v.createdAt === "string" ? v.createdAt : "",
    google,
    drive: asDrive(v.drive),
    welcomedAt: typeof v.welcomedAt === "string" ? v.welcomedAt : null,
    remoteCopiesKept: v.remoteCopiesKept === true,
  };
}

/**
 * Why `next` may not replace `current`, or `null` when it may: the id and
 * the Google account stay, and a Remote Storage grant is the account's own.
 */
export function changeRefusal(
  current: WriterRecord,
  next: WriterRecord,
): string | null {
  if (next.id !== current.id) return "An account's id cannot change.";
  if ((next.google?.sub ?? null) !== (current.google?.sub ?? null))
    return "An account's Google identity cannot change.";
  if (next.drive && next.drive.sub !== next.google?.sub)
    return "The Drive account must be the account's own.";
  return null;
}

/** The accounts this browser keeps, as the writer use cases read and change them. */
export interface WriterRegistry {
  findWriter(id: string): WriterRecord | null;
  /** The account Google knows by `sub`, or `null` when this browser has none. */
  findWriterBySub(sub: string): WriterRecord | null;
  /** The one account without Google, or `null` before anyone entered without it. */
  accountWithoutGoogle(): WriterRecord | null;
  saveWriter(writer: WriterRecord): void;
  /**
   * Applies `change` to the account `id` and answers the stored record. A
   * change the domain refuses, or an account not stored, throws and stores
   * nothing.
   */
  updateWriter(
    id: string,
    change: (writer: WriterRecord) => WriterRecord,
  ): WriterRecord;
}
