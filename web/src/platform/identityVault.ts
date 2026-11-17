// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { isPlatformError, type CredentialVault } from "./types";
import { appLog, describeError } from "../log";

// The identity platform's credential vault. A value lives in this
// tab's memory; a remembered one is also sealed by the identity service in
// its own HttpOnly cookie, which only that service opens, and only for the
// writer's session with its proof. Nothing is kept in the origin's storage,
// so a copied browser profile carries no readable key.

/** The identity service's side of the vault. */
export interface SealedCredentials {
  /** Seals `value` for the open writer. */
  keep(name: string, value: string): Promise<void>;
  /** The open writer's sealed value, or null when none opens. */
  open(name: string): Promise<string | null>;
  /** Clears `writerId`'s sealed value; needs no session. */
  forget(writerId: string, name: string): Promise<void>;
}

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_VALUE = 512;

function checkName(name: string): void {
  if (!NAME.test(name)) throw new Error("A credential name is malformed.");
}

interface Held {
  value: string;
  /** Whether the service holds it sealed too. */
  kept: boolean;
}

/** In-memory entries per writer; the session's end clears its writer's. */
const memory = new Map<string, Map<string, Held>>();

/**
 * Bumped by every `set` and `delete` of a writer's name, so an opening that
 * started before them cannot bring an older value back.
 */
const changes = new Map<string, number>();
const slotOf = (writerId: string, name: string) => `${writerId}/${name}`;
const changed = (slot: string) =>
  changes.set(slot, (changes.get(slot) ?? 0) + 1);

/**
 * Whether `err` says no sealed value can exist: with no Google client the
 * identity service does not run, and the client is gone only after the seal
 * keys were replaced, so no kept value opens until one is sealed again.
 */
const nothingSealed = (err: unknown): boolean =>
  isPlatformError(err, "google-not-configured");

function hold(writerId: string, name: string, held: Held): void {
  const own = memory.get(writerId) ?? new Map<string, Held>();
  own.set(name, held);
  memory.set(writerId, own);
}

export function identityVault(
  writerId: () => string | null,
  sealed: SealedCredentials,
): CredentialVault {
  const owner = (): string => {
    const id = writerId();
    if (id === null) throw new Error("No writer session is open.");
    return id;
  };
  // One opening at a time per writer and name, however many callers ask.
  const opening = new Map<string, Promise<string | null>>();

  return {
    // A kept value is asked of the service each time, so a key another tab
    // replaced or forgot reaches this one; the tab's copy answers only while
    // the service cannot be reached.
    async get(name) {
      checkName(name);
      const id = owner();
      const held = memory.get(id)?.get(name);
      if (held && !held.kept) return held.value;
      const slot = slotOf(id, name);
      const seen = changes.get(slot) ?? 0;
      let pending = opening.get(slot);
      if (!pending) {
        const asked = sealed.open(name);
        opening.set(slot, asked);
        void asked
          .catch(() => null)
          .finally(() => {
            if (opening.get(slot) === asked) opening.delete(slot);
          });
        pending = asked;
      }
      let value: string | null;
      try {
        value = await pending;
      } catch {
        return held?.value ?? null;
      }
      if (writerId() !== id) return value;
      if ((changes.get(slot) ?? 0) !== seen)
        return memory.get(id)?.get(name)?.value ?? null;
      if (value === null) memory.get(id)?.delete(name);
      else hold(id, name, { value, kept: true });
      return value;
    },
    async set(name, value, { remember }) {
      checkName(name);
      if (value.length > MAX_VALUE)
        throw new Error("A credential is too large.");
      const id = owner();
      changed(slotOf(id, name));
      hold(id, name, { value, kept: false });
      if (remember) {
        try {
          await sealed.keep(name, value);
        } catch (err) {
          // Not sealed: the value lives in this tab, and the answer says so.
          appLog.warn("account", "A credential could not be remembered.", {
            slot: name,
            ...describeError(err),
          });
          return { remembered: false };
        }
        hold(id, name, { value, kept: true });
        return { remembered: true };
      }
      // A superseded kept value cannot come back at the next entry. A
      // service that cannot be reached cannot open it either, so only its
      // refusal rejects the call; the caller's choice not to remember keeps
      // it from being asked for once the service answers again.
      await sealed.forget(id, name).catch((err: unknown) => {
        if (!isPlatformError(err, "unavailable") && !nothingSealed(err))
          throw err;
      });
      return { remembered: false };
    },
    async delete(name) {
      checkName(name);
      const id = owner();
      changed(slotOf(id, name));
      memory.get(id)?.delete(name);
      // Rejects when the service does not clear it, so no caller reports a
      // kept key gone that would still open.
      await sealed.forget(id, name).catch((err: unknown) => {
        if (!nothingSealed(err)) throw err;
      });
    },
  };
}

/** Drops the in-memory credentials of `writerId`, as a session ends. */
export function dropSessionCredentials(writerId: string): void {
  memory.delete(writerId);
}
