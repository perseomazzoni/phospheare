// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  asWriter,
  changeRefusal,
  type WriterRecord,
  type WriterRegistry,
} from "./domain/writer";

// The accounts of this browser and which one is signed in, in this site's
// localStorage and nowhere else. When localStorage refuses writes they live
// in memory for the life of the tab.

const ACCOUNTS = "accounts";
const SIGNED_IN = "signedIn";

type Listener = () => void;
const listeners = new Set<Listener>();

interface Stored {
  accounts: WriterRecord[];
  signedIn: string | null;
}

let memory: Stored | null = null;
let cachedRaw: string | null = null;
let cachedAccounts: WriterRecord[] = [];

function parse(raw: string | null): WriterRecord[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.map(asWriter).filter((w): w is WriterRecord => w !== null);
  } catch {
    return [];
  }
}

function read(): Stored {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(ACCOUNTS);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedAccounts = parse(raw);
    }
    return {
      accounts: cachedAccounts,
      signedIn: localStorage.getItem(SIGNED_IN),
    };
  } catch {
    memory = { accounts: [], signedIn: null };
    return memory;
  }
}

function write(next: Stored): void {
  if (!memory) {
    try {
      const raw = JSON.stringify(next.accounts);
      localStorage.setItem(ACCOUNTS, raw);
      if (next.signedIn) localStorage.setItem(SIGNED_IN, next.signedIn);
      else localStorage.removeItem(SIGNED_IN);
      cachedRaw = raw;
      cachedAccounts = next.accounts;
    } catch {
      memory = next;
    }
  } else {
    memory = next;
  }
  for (const listen of [...listeners]) listen();
}

export function findWriter(id: string): WriterRecord | null {
  return read().accounts.find((w) => w.id === id) ?? null;
}

/** The account of the Google identity `sub`. */
export function findWriterBySub(sub: string): WriterRecord | null {
  return read().accounts.find((w) => w.google?.sub === sub) ?? null;
}

/**
 * The id of every account with a record here: the one signed in and those
 * that signed out leaving their things.
 */
export function accountIds(): string[] {
  return read().accounts.map((w) => w.id);
}

/** The account without Google, or `null` when this browser has none. */
export function accountWithoutGoogle(): WriterRecord | null {
  return read().accounts.find((w) => w.google === null) ?? null;
}

/** The signed-in account, or `null` when no one is signed in. */
export function signedInWriter(): WriterRecord | null {
  const { signedIn } = read();
  return signedIn ? findWriter(signedIn) : null;
}

/** Adds `writer`, or replaces the account with its id. */
export function saveWriter(writer: WriterRecord): void {
  const stored = read();
  const others = stored.accounts.filter((w) => w.id !== writer.id);
  write({ ...stored, accounts: [...others, writer] });
}

/** Removes the account whose id is `id`, signing it out if it is in. */
export function removeWriter(id: string): void {
  const stored = read();
  write({
    accounts: stored.accounts.filter((w) => w.id !== id),
    signedIn: stored.signedIn === id ? null : stored.signedIn,
  });
}

/** Marks `id` as signed in, or no one with `null`. */
export function setSignedIn(id: string | null): void {
  write({ ...read(), signedIn: id });
}

/**
 * Applies `change` to the account whose id is `id`. A change the domain
 * refuses (`changeRefusal`) throws and stores nothing.
 */
export function updateWriter(
  id: string,
  change: (writer: WriterRecord) => WriterRecord,
): WriterRecord {
  const current = findWriter(id);
  if (!current) throw new Error("No such account.");
  const next = asWriter(change({ ...current }));
  if (!next) throw new Error("The account change is invalid.");
  const refusal = changeRefusal(current, next);
  if (refusal) throw new Error(refusal);
  saveWriter(next);
  return next;
}

/**
 * Calls `listen` when an account or the signed-in mark changes, in this tab
 * or another; returns the unsubscribe.
 */
export function subscribeWriters(listen: Listener): () => void {
  listeners.add(listen);
  const onStorage = (event: StorageEvent) => {
    if (event.key === ACCOUNTS || event.key === SIGNED_IN || event.key === null)
      listen();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listen);
    window.removeEventListener("storage", onStorage);
  };
}

/** Resets the in-memory fallback; tests only. */
export function resetRegistryForTests(): void {
  memory = null;
  cachedRaw = null;
  cachedAccounts = [];
}

/** The registry as the writer use cases take it. */
export const writerRegistry: WriterRegistry = {
  findWriter,
  findWriterBySub,
  accountWithoutGoogle,
  saveWriter,
  updateWriter,
};
