// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useState, type CSSProperties } from "react";
import { Icon } from "./icons";
import { appIcons } from "./appIcons";
import { avatarColor } from "./avatarColor";
import { firstName } from "./firstName";

// Who is signed in, drawn as one of three faces in a fixed order: the
// account's Google picture if there is one and it loads, the initial on a
// colour derived from the name if not, and the account glyph when there is no
// name. None is empty, because an avatar slot that renders nothing reads as a
// broken image, not as an anonymous session.
//
// `onError` makes the middle face reachable: Google's avatar URLs expire and
// 404 long before the session does, so trusting the URL would show a broken
// image to the writers signed in longest.
//
// Presentation only: no menu, no sign-out, no auth call. What pressing it
// does belongs to the callers.

export interface AvatarProps {
  /** The display name; the initial and its colour come from it. */
  name: string | null | undefined;
  /** Their picture, if the account has one. `null` is a user with none. */
  avatarUrl: string | null | undefined;
  /** Edge length in px. */
  size?: number;
}

export default function Avatar({ name, avatarUrl, size = 18 }: AvatarProps) {
  // The URL that failed, not a flag: a new URL on the same mounted avatar,
  // after a refresh or an account switch, gets its own try.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const first = firstName(name ?? undefined);

  if (avatarUrl && avatarUrl !== failedUrl)
    return (
      <img
        className="app-avatar"
        src={avatarUrl}
        alt=""
        width={size}
        height={size}
        // Google's CDN answers 403 to a request carrying the app's referrer.
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(avatarUrl)}
      />
    );

  if (first)
    return (
      <span
        className="app-avatar app-avatar-initial"
        style={{ "--name-colour": avatarColor(first) } as CSSProperties}
      >
        {first[0].toUpperCase()}
      </span>
    );

  return <Icon name={appIcons.account} size={size} />;
}
