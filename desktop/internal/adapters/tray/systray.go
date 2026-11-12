// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

//go:build windows || linux

package tray

import (
	"bytes"
	"context"
	"time"

	"fyne.io/systray"
)

// Run shows the icon and the menu, and calls body, which is the program's
// life; it returns once body returns or the system ends the tray, as at
// sign-out. It must be called on the main goroutine: the library pins it to
// the main thread, which the system's window messages need.
func Run(a Actions, body func()) {
	systray.Run(func() {
		systray.SetTitle(a.ProductName)
		systray.SetTooltip(a.ProductName)
		t := Build(menu{}, a)
		ctx, cancel := context.WithCancel(context.Background())
		go followTheme(ctx)
		go t.Serve(ctx)
		go func() {
			body()
			cancel()
			systray.Quit()
		}()
	}, nil)
}

// followTheme shows the figure for the taskbar's theme, and again
// whenever the theme changes, until ctx ends.
func followTheme(ctx context.Context) {
	shown := icon()
	systray.SetIcon(shown)
	tick := time.NewTicker(every)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			if now := icon(); !bytes.Equal(now, shown) {
				shown = now
				systray.SetIcon(shown)
			}
		}
	}
}

type menu struct{}

func (menu) Add(title string) (Item, <-chan struct{}) {
	i := systray.AddMenuItem(title, "")
	return i, i.ClickedCh
}

func (menu) AddCheckbox(title string, checked bool) (Item, <-chan struct{}) {
	i := systray.AddMenuItemCheckbox(title, "", checked)
	return i, i.ClickedCh
}

func (menu) AddSeparator() { systray.AddSeparator() }
