// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

export function firstName(fullName: string | undefined): string {
  if (!fullName) return "";
  return fullName.split(/\s+/)[0];
}
