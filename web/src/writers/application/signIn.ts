// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Platform } from "../../platform";
import {
  newWriter,
  newWriterId,
  type WriterRecord,
  type WriterRegistry,
} from "../domain/writer";

// Signing in with Google, or entering without it. The Google flow runs under
// a fresh id, since Google has not yet said who it is; an account already
// known in this browser then takes its own id back, so its library and its
// Remote Storage connection follow it. Without Google there is one account per
// browser, so entering again finds the shelf it kept.

/**
 * Signs in with Google and answers the account it belongs to, made on the
 * first sign-in. `loginHint` steers Google's account chooser.
 */
export async function signInWithGoogle(
  platform: Pick<Platform, "signInWithGoogle" | "openSession">,
  registry: Pick<
    WriterRegistry,
    "findWriterBySub" | "saveWriter" | "updateWriter"
  >,
  options: { loginHint?: string } = {},
): Promise<WriterRecord> {
  const flowId = newWriterId();
  const identity = await platform.signInWithGoogle({
    writerId: flowId,
    ...(options.loginHint ? { loginHint: options.loginHint } : {}),
  });
  const known = registry.findWriterBySub(identity.sub);
  if (known) {
    await platform.openSession(known.id);
    return registry.updateWriter(known.id, (w) => ({ ...w, google: identity }));
  }
  const writer = newWriter(flowId, identity, new Date());
  registry.saveWriter(writer);
  return writer;
}

/** The account without Google, made the first time anyone enters without it. */
export function enterWithoutGoogle(
  registry: Pick<WriterRegistry, "accountWithoutGoogle" | "saveWriter">,
): WriterRecord {
  const known = registry.accountWithoutGoogle();
  if (known) return known;
  const writer = newWriter(newWriterId(), null, new Date());
  registry.saveWriter(writer);
  return writer;
}
