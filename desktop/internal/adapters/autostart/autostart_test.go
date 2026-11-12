// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package autostart

import (
	"errors"
	"testing"
)

// countingList is a login list that counts its readings.
type countingList struct {
	on    bool
	reads int
}

func (l *countingList) Enable(string, []string) error { l.on = true; return nil }
func (l *countingList) Disable() error                { l.on = false; return nil }
func (l *countingList) Enabled() (bool, error)        { l.reads++; return l.on, nil }

func TestRememberedReadsTheListOnlyAfterAChange(t *testing.T) {
	list := &countingList{}
	r := &Remembered{List: list}
	for range 3 {
		if on, _ := r.Last(); on {
			t.Fatal("on before any change")
		}
	}
	if list.reads != 1 {
		t.Fatalf("%d readings for three asks", list.reads)
	}
	if err := r.Enable("exe", nil); err != nil {
		t.Fatal(err)
	}
	if on, _ := r.Last(); !on || list.reads != 2 {
		t.Fatalf("after Enable: on %v, %d readings", on, list.reads)
	}
	list.on = false
	if on, _ := r.Last(); !on {
		t.Fatal("Last read the list again without a change")
	}
	if on, _ := r.Enabled(); on || list.reads != 3 {
		t.Fatalf("Enabled did not read the list: on %v, %d readings", on, list.reads)
	}
	if on, _ := r.Last(); on {
		t.Fatal("Last did not keep the reading Enabled made")
	}
	if err := r.Disable(); err != nil {
		t.Fatal(err)
	}
	_, _ = r.Last()
	if list.reads != 4 {
		t.Fatalf("after Disable: %d readings", list.reads)
	}
}

// flakyList is a login list whose readings fail while fails is above zero.
type flakyList struct {
	countingList
	fails int
}

func (l *flakyList) Enabled() (bool, error) {
	on, _ := l.countingList.Enabled()
	if l.fails > 0 {
		l.fails--
		return false, errors.New("the login list could not be read")
	}
	return on, nil
}

func TestRememberedReadsAgainAfterAFailedReading(t *testing.T) {
	list := &flakyList{countingList: countingList{on: true}, fails: 1}
	r := &Remembered{List: list}
	if _, err := r.Last(); err == nil {
		t.Fatal("the failed reading was not reported")
	}
	for range 2 {
		if on, err := r.Last(); !on || err != nil {
			t.Fatalf("after the failure: on %v, %v", on, err)
		}
	}
	if list.reads != 2 {
		t.Fatalf("%d readings, want the failed one and one more", list.reads)
	}
}
