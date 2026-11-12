// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

const PALETTE = [
  "#2D6A4F", // forest
  "#7B2D8B", // plum
  "#B45309", // amber
  "#1E5A8A", // ocean
  "#9B2335", // cranberry
  "#5B7553", // sage
  "#8B5E3C", // chestnut
  "#4A6FA5", // steel
  "#6B4C8A", // wisteria
  "#3D7A5F", // jade
];

export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
