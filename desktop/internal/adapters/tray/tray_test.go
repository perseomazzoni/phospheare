// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package tray

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/words"
)

func TestMain(m *testing.M) {
	// No refresh on the clock: each test refreshes by its clicks alone.
	every = time.Hour
	os.Exit(m.Run())
}

type fakeItem struct {
	mu       sync.Mutex
	title    string
	disabled bool
	checked  bool
	hidden   bool
	clicks   chan struct{}
	// touches counts the calls that change what the entry shows.
	touches int
}

func (i *fakeItem) set(f func()) { i.mu.Lock(); f(); i.touches++; i.mu.Unlock() }

func (i *fakeItem) SetTitle(s string) { i.set(func() { i.title = s }) }
func (i *fakeItem) Enable()           { i.set(func() { i.disabled = false }) }
func (i *fakeItem) Disable()          { i.set(func() { i.disabled = true }) }
func (i *fakeItem) Check()            { i.set(func() { i.checked = true }) }
func (i *fakeItem) Uncheck()          { i.set(func() { i.checked = false }) }
func (i *fakeItem) Show()             { i.set(func() { i.hidden = false }) }
func (i *fakeItem) Hide()             { i.set(func() { i.hidden = true }) }

func (i *fakeItem) touched() int {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.touches
}

func (i *fakeItem) isHidden() bool {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.hidden
}

func (i *fakeItem) state() (string, bool, bool) {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.title, i.disabled, i.checked
}

// fakeMenu records the entries in order; a separator is a nil entry.
// refreshed hears the end of every refresh of the tray serve built on it.
type fakeMenu struct {
	items     []*fakeItem
	refreshed chan struct{}
}

func (m *fakeMenu) Add(title string) (Item, <-chan struct{}) {
	i := &fakeItem{title: title, clicks: make(chan struct{})}
	m.items = append(m.items, i)
	return i, i.clicks
}

func (m *fakeMenu) AddCheckbox(title string, checked bool) (Item, <-chan struct{}) {
	i, c := m.Add(title)
	i.(*fakeItem).checked = checked
	return i, c
}

func (m *fakeMenu) AddSeparator() { m.items = append(m.items, nil) }

// Entries by position in the menu.
const (
	open = iota
	setup
	phone
	_
	status
	ask
	toggle
	login
	_
	quit
)

// program is the state the actions read and change, with what was called.
type program struct {
	mu       sync.Mutex
	network  Network
	login    bool
	startErr error
	calls    []string
	// lang is the language chosen, "" for the first.
	lang string
}

func (p *program) call(name string) {
	p.mu.Lock()
	p.calls = append(p.calls, name)
	p.mu.Unlock()
}

func (p *program) called() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.calls...)
}

func (p *program) actions() Actions {
	return Actions{
		ProductName: "Phospheare",
		Words: func() Words {
			p.mu.Lock()
			defer p.mu.Unlock()
			return words.For(p.lang, "Phospheare")
		},
		Open:        func() { p.call("open") },
		Setup:       func() { p.call("setup") },
		OpenOnPhone: func() { p.call("phone") },
		Network: func() Network {
			p.mu.Lock()
			defer p.mu.Unlock()
			return p.network
		},
		StartNetwork: func() error {
			p.call("start")
			p.mu.Lock()
			defer p.mu.Unlock()
			if p.startErr != nil {
				return p.startErr
			}
			p.network = Network{State: NetworkOn, URL: "https://studio.example.test"}
			return nil
		},
		StopNetwork: func() error {
			p.call("stop")
			p.mu.Lock()
			p.network = Network{State: NetworkOff}
			p.mu.Unlock()
			return nil
		},
		StartAtLogin: func() (bool, error) {
			p.mu.Lock()
			defer p.mu.Unlock()
			return p.login, nil
		},
		SetStartAtLogin: func(on bool) error {
			p.call("login")
			p.mu.Lock()
			p.login = on
			p.mu.Unlock()
			return nil
		},
		Quit: func() { p.call("quit") },
	}
}

// serve builds the menu and serves it until the test ends.
func serve(t *testing.T, p *program) *fakeMenu {
	t.Helper()
	m := &fakeMenu{refreshed: make(chan struct{}, 1)}
	tr := Build(m, p.actions())
	tr.refreshed = func() {
		select {
		case m.refreshed <- struct{}{}:
		default:
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { tr.Serve(ctx); close(done) }()
	t.Cleanup(func() { cancel(); <-done })
	return m
}

// click clicks entry i, and answers once the menu has refreshed after it.
func click(t *testing.T, m *fakeMenu, i int) {
	t.Helper()
	select {
	case <-m.refreshed:
	default:
	}
	select {
	case m.items[i].clicks <- struct{}{}:
	case <-time.After(5 * time.Second):
		t.Fatalf("entry %d was not listened to", i)
	}
	select {
	case <-m.refreshed:
	case <-time.After(5 * time.Second):
		t.Fatal("the menu did not refresh")
	}
}

func title(m *fakeMenu, i int) string { s, _, _ := m.items[i].state(); return s }

func TestTheMenuListsItsEntriesInOrder(t *testing.T) {
	p := &program{network: Network{State: NetworkOff}}
	m := &fakeMenu{}
	Build(m, p.actions())
	want := []string{"Open Phospheare", "Setup", "Open on a phone or tablet", "", "Home network: off", "-", "Start home network", "Start at login", "", "Quit Phospheare"}
	if len(m.items) != len(want) {
		t.Fatalf("%d entries", len(m.items))
	}
	for i, w := range want {
		if w == "" {
			if m.items[i] != nil {
				t.Fatalf("entry %d is not a separator", i)
			}
			continue
		}
		if w == "-" {
			if !m.items[i].isHidden() {
				t.Fatalf("entry %d shows with nothing to ask", i)
			}
			continue
		}
		if got := title(m, i); got != w {
			t.Fatalf("entry %d: %q, want %q", i, got, w)
		}
	}
	if _, disabled, _ := m.items[status].state(); !disabled {
		t.Fatal("the status line can be clicked")
	}
}

func TestTheStatusLineFollowsTheHomeNetwork(t *testing.T) {
	for _, c := range []struct {
		network        Network
		status, toggle string
	}{
		{Network{State: NetworkUnset}, "Home network: not set up", ""},
		{Network{State: NetworkOff}, "Home network: off", "Start home network"},
		{Network{State: NetworkStarting}, "Home network: starting", "Stop home network"},
		{Network{State: NetworkOn, URL: "https://studio.example.test"}, "Home network: on at https://studio.example.test", "Stop home network"},
		{Network{State: NetworkFailed}, "Home network: stopped by an error", "Start home network"},
	} {
		p := &program{network: c.network}
		m := &fakeMenu{}
		Build(m, p.actions())
		hidden := m.items[toggle].isHidden()
		if title(m, status) != c.status || hidden != (c.toggle == "") || c.toggle != "" && title(m, toggle) != c.toggle {
			t.Errorf("%v: %q / %q, hidden %v", c.network.State, title(m, status), title(m, toggle), hidden)
		}
	}
}

func TestTheToggleStartsAndStopsTheHomeNetwork(t *testing.T) {
	p := &program{network: Network{State: NetworkOff}}
	m := serve(t, p)
	click(t, m, toggle)
	if title(m, status) != "Home network: on at https://studio.example.test" || title(m, toggle) != "Stop home network" {
		t.Fatalf("after start: %q / %q", title(m, status), title(m, toggle))
	}
	click(t, m, toggle)
	if title(m, status) != "Home network: off" {
		t.Fatalf("after stop: %q", title(m, status))
	}
	if got := p.called(); len(got) != 2 || got[0] != "start" || got[1] != "stop" {
		t.Fatalf("calls %v", got)
	}
}

// The way to the code phones scan shows only while phones can use it.
func TestOpenOnAPhoneShowsWhileTheHomeNetworkIsOn(t *testing.T) {
	p := &program{network: Network{State: NetworkOff}}
	m := serve(t, p)
	if !m.items[phone].isHidden() {
		t.Fatal("shown while off")
	}
	click(t, m, toggle)
	if m.items[phone].isHidden() {
		t.Fatal("hidden while on")
	}
	click(t, m, phone)
	if got := p.called(); len(got) != 2 || got[1] != "phone" {
		t.Fatalf("calls %v", got)
	}
}

// A home network not set up has no switch: Setup already opens the page.
func TestTheSwitchShowsOnceTheHomeNetworkIsSetUp(t *testing.T) {
	p := &program{network: Network{State: NetworkUnset}}
	m := &fakeMenu{}
	tr := Build(m, p.actions())
	if !m.items[toggle].isHidden() {
		t.Fatal("the switch shows for a home network not set up")
	}
	p.mu.Lock()
	p.network = Network{State: NetworkOff}
	p.mu.Unlock()
	tr.Refresh()
	if m.items[toggle].isHidden() || title(m, toggle) != "Start home network" {
		t.Fatalf("once set up: %q, hidden %v", title(m, toggle), m.items[toggle].isHidden())
	}
}

func TestAHomeNetworkFailingToStartOpensTheSetupPage(t *testing.T) {
	p := &program{network: Network{State: NetworkOff}, startErr: errors.New("no certificate")}
	m := serve(t, p)
	click(t, m, toggle)
	if got := p.called(); len(got) != 2 || got[0] != "start" || got[1] != "setup" {
		t.Fatalf("calls %v", got)
	}
}

func TestStartAtLoginSwitchesAndShowsItsCheck(t *testing.T) {
	p := &program{network: Network{State: NetworkOff}}
	m := serve(t, p)
	click(t, m, login)
	if _, _, checked := m.items[login].state(); !checked {
		t.Fatal("start at login is not checked once switched on")
	}
	click(t, m, login)
	if _, _, checked := m.items[login].state(); checked {
		t.Fatal("start at login is still checked once switched off")
	}
}

func TestOpenSetupAndQuit(t *testing.T) {
	p := &program{network: Network{State: NetworkOff}}
	m := serve(t, p)
	click(t, m, open)
	click(t, m, setup)
	select {
	case m.items[quit].clicks <- struct{}{}:
	case <-time.After(5 * time.Second):
		t.Fatal("quit was not listened to")
	}
	deadline := time.Now().Add(5 * time.Second)
	for len(p.called()) < 3 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if got := p.called(); len(got) != 3 || got[0] != "open" || got[1] != "setup" || got[2] != "quit" {
		t.Fatalf("calls %v", got)
	}
}

func TestTheMenuReadsAChangeMadeElsewhere(t *testing.T) {
	p := &program{network: Network{State: NetworkOff}}
	m := &fakeMenu{}
	tr := Build(m, p.actions())
	p.mu.Lock()
	p.network = Network{State: NetworkStarting}
	p.login = true
	p.mu.Unlock()
	tr.Refresh()
	if _, _, checked := m.items[login].state(); title(m, status) != "Home network: starting" || !checked {
		t.Fatalf("after a change on the setup page: %q, checked %v", title(m, status), checked)
	}
}

func TestARefreshRedrawsOnlyWhatChanged(t *testing.T) {
	p := &program{network: Network{State: NetworkOff}}
	m := &fakeMenu{}
	tr := Build(m, p.actions())
	before := map[int]int{}
	for _, i := range []int{phone, status, toggle, login} {
		before[i] = m.items[i].touched()
	}
	tr.Refresh()
	for i, n := range before {
		if got := m.items[i].touched(); got != n {
			t.Fatalf("entry %d redrawn without a change", i)
		}
	}
	p.mu.Lock()
	p.login = true
	p.mu.Unlock()
	tr.Refresh()
	if m.items[login].touched() != before[login]+1 || m.items[status].touched() != before[status] {
		t.Fatal("a change of start at login redrew the wrong entries")
	}
}

func TestTheMenuFollowsTheLanguageChosen(t *testing.T) {
	p := &program{network: Network{State: NetworkOn, URL: "https://studio.example.test"}}
	m := &fakeMenu{}
	tr := Build(m, p.actions())
	before := m.items[open].touched()
	p.mu.Lock()
	p.lang = "it"
	p.mu.Unlock()
	tr.Refresh()
	if title(m, open) != "Apri Phospheare" || title(m, quit) != "Esci da Phospheare" ||
		title(m, status) != "Rete di casa: accesa su https://studio.example.test" || title(m, toggle) != "Spegni la rete di casa" {
		t.Fatalf("in Italian: %q / %q / %q / %q", title(m, open), title(m, quit), title(m, status), title(m, toggle))
	}
	tr.Refresh()
	if m.items[open].touched() != before+1 {
		t.Fatal("a name was redrawn without a change of language")
	}
}

// While the home network asks for the person, an entry says so and opens
// the setup page; it goes once nothing is asked.
func TestAnEntryAsksForThePersonAndOpensTheSetupPage(t *testing.T) {
	p := &program{network: Network{State: NetworkOn, URL: "https://studio.example.test", Asks: true}}
	m := serve(t, p)
	if m.items[ask].isHidden() || title(m, ask) != "Something needs you: open Setup" {
		t.Fatalf("while asked: %q, hidden %v", title(m, ask), m.items[ask].isHidden())
	}
	click(t, m, ask)
	if got := p.called(); len(got) != 1 || got[0] != "setup" {
		t.Fatalf("calls %v", got)
	}
	p.mu.Lock()
	p.network.Asks = false
	p.mu.Unlock()
	click(t, m, setup)
	if !m.items[ask].isHidden() {
		t.Fatal("the entry stays with nothing to ask")
	}
}
