// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The Library's greeting, from one of two pools. A writer on the welcome page
// has never been here, so nothing in that pool says "back" or "again".

const FIRST_KEYS = [
  "library.greetingFirstWelcome",
  "library.greetingFirstHello",
  "library.greetingFirstBegin",
] as const;

const RETURNING_KEYS = [
  "library.greetingHey",
  "library.greetingWelcome",
  "library.greetingGoodToSeeYou",
  "library.greetingReady",
  "library.greetingNice",
] as const;

export type GreetingPool = "first" | "returning";

export function greetingKeys(pool: GreetingPool): readonly string[] {
  return pool === "first" ? FIRST_KEYS : RETURNING_KEYS;
}

export function randomGreetingKey(
  pool: GreetingPool,
  random: () => number = Math.random,
): string {
  const keys = greetingKeys(pool);
  return keys[Math.floor(random() * keys.length)];
}
