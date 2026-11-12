// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

/**
 * Device names Windows reserves. Windows reads the part before the first dot,
 * so `nul.tar` and `CON.backup` are the device as much as `con` is, and an
 * extension added after does not change that. The superscript digits are
 * reserved too.
 */
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\.|$)/i;

/** Whether Windows takes `name` for a device, so no such file can exist. */
export function isWindowsDeviceName(name: string): boolean {
  return DEVICE_NAME.test(name);
}
