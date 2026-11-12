// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The session proof the identity service answers when a writer session
// opens, and asks for on every call that uses the session. A browser sends
// localhost cookies to every port of the host, so another program on the
// computer can receive the session cookie; this origin's storage is the one
// place no other port reads, and the proof never leaves it but in that
// header.
//
// It lives in localStorage, not sessionStorage, so it survives a reload and
// every tab of the origin sends the same one. Storage that throws keeps it in
// this tab's memory instead. None of these functions throws.

/** Every proof's key starts so: `identity.proof.<writerId>`. */
export const IDENTITY_PROOF_PREFIX = "identity.proof.";

const memory = new Map<string, string>();

function proofKey(writerId: string): string {
  return `${IDENTITY_PROOF_PREFIX}${writerId}`;
}

/** The proof kept for `writerId`, or `null`. */
export function readIdentityProof(writerId: string): string | null {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(proofKey(writerId));
  } catch {
    // Unreadable storage: the memory copy, if any, answers.
  }
  return stored ?? memory.get(writerId) ?? null;
}

export function keepIdentityProof(writerId: string, proof: string): void {
  try {
    localStorage.setItem(proofKey(writerId), proof);
    memory.delete(writerId);
  } catch {
    memory.set(writerId, proof);
    try {
      localStorage.removeItem(proofKey(writerId));
    } catch {
      // A stale stored proof only earns one refusal and a new session.
    }
  }
}

/** Removes the proof of `writerId`, stored or in memory. */
export function forgetIdentityProof(writerId: string): void {
  memory.delete(writerId);
  try {
    localStorage.removeItem(proofKey(writerId));
  } catch {
    // A proof left behind opens nothing once its session cookie is gone.
  }
}
