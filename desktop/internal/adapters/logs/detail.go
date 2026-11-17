// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package logs

import (
	"log/slog"
	"sync"
	"time"
)

// DetailFor is how long a detailed log lasts once it is turned on. A
// detailed log grows fast, so it ends by itself.
const DetailFor = 24 * time.Hour

// Detail keeps Level at debug until a time, then puts it back to Base.
type Detail struct {
	Level *slog.LevelVar
	// Base is the level outside a detailed time.
	Base slog.Level
	// Log hears each change. It may be nil.
	Log *slog.Logger

	now func() time.Time
	// after runs f once d has passed and answers what stops it; a test
	// sets it to run f itself, at the moment it chooses.
	after func(d time.Duration, f func()) (stop func() bool)
	mu    sync.Mutex
	until time.Time
	stop  func() bool
}

// Until answers when the detailed log ends, or the zero time while it is
// off.
func (d *Detail) Until() time.Time {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.until
}

// Set keeps the detail until until. A zero time, or one already passed,
// turns it off. A time further than DetailFor ahead, as a settings file
// changed by hand can hold, is cut to DetailFor.
func (d *Detail) Set(until time.Time) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.set(until)
}

func (d *Detail) set(until time.Time) {
	if d.stop != nil {
		d.stop()
		d.stop = nil
	}
	now := d.clock()
	was := d.until
	if until.IsZero() || !until.After(now) {
		d.until = time.Time{}
		d.Level.Set(d.Base)
		if !was.IsZero() {
			d.log().Info("The detailed log is off.")
		}
		return
	}
	if until.Sub(now) > DetailFor {
		until = now.Add(DetailFor)
	}
	d.until = until
	d.Level.Set(min(slog.LevelDebug, d.Base))
	if !was.Equal(until) {
		d.log().Info("The detailed log is on.", "until", until.Format(time.RFC3339))
	}
	// A timer that a later Set replaced may still fire; it then finds
	// another end and does nothing.
	d.stop = d.wait(until.Sub(now), func() {
		d.mu.Lock()
		defer d.mu.Unlock()
		if d.until.Equal(until) {
			d.set(time.Time{})
		}
	})
}

func (d *Detail) wait(after time.Duration, f func()) func() bool {
	if d.after != nil {
		return d.after(after, f)
	}
	return time.AfterFunc(after, f).Stop
}

func (d *Detail) clock() time.Time {
	if d.now != nil {
		return d.now()
	}
	return time.Now()
}

func (d *Detail) log() *slog.Logger {
	if d.Log == nil {
		return slog.New(slog.DiscardHandler)
	}
	return d.Log
}
