// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

//go:build !windows && !darwin && !linux

package autostart

import "errors"

var errUnsupported = errors.New("starting at login is not supported on this operating system")

func enable(string, []string) error { return errUnsupported }
func disable() error                { return errUnsupported }
func enabled() (bool, error)        { return false, nil }
