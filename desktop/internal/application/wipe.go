// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package application

import (
	"fmt"

	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
	"github.com/perseomazzoni/phospheare/desktop/internal/ports"
)

// Wipe forgets what the setup page set, so it can be set up again. Both
// wipes end every seal key, which disconnects Google Drive and the kept
// OpenRouter keys from every browser; the accounts stay signed in, since
// their mark is the browser's own. Neither touches the Google Cloud project
// or the account, name and token at deSEC.
type Wipe struct {
	Config   ports.ConfigStore
	Identity ports.IdentityService
	// LAN is the home-network listener.
	LAN interface{ Stop() error }
	// Certs is the home-network certificate, with its keys.
	Certs     interface{ Forget() error }
	Autostart ports.Autostart
	// Logs is the program's log files, with their detailed time.
	Logs interface{ Clear() error }
}

// Google forgets the Google client and replaces the seal keys. The
// identity service then stays stopped until a client is given again.
func (w *Wipe) Google() error {
	if err := w.Config.Update(func(c *domain.Config) { c.Google = domain.Google{} }); err != nil {
		return fmt.Errorf("save the settings: %w", err)
	}
	if err := w.Identity.SignOutBrowsers(); err != nil {
		return fmt.Errorf("sign the browsers out: %w", err)
	}
	return nil
}

// Everything also stops the home network and forgets its name, settings
// and certificate, stops starting at login, removes the seal keys, so the
// vault keeps nothing for this setup, and empties the log files. The
// identity service's own port and an ACME directory set by hand stay, since
// nothing on the setup page sets them.
func (w *Wipe) Everything() error {
	if err := w.LAN.Stop(); err != nil {
		return fmt.Errorf("stop home-network access: %w", err)
	}
	if err := w.Autostart.Disable(); err != nil {
		return fmt.Errorf("stop starting at login: %w", err)
	}
	err := w.Config.Update(func(c *domain.Config) {
		fresh := domain.Defaults()
		fresh.Port = c.Port
		fresh.LAN.ACMEDirectory = c.LAN.ACMEDirectory
		*c = fresh
	})
	if err != nil {
		return fmt.Errorf("save the settings: %w", err)
	}
	if err := w.Certs.Forget(); err != nil {
		return fmt.Errorf("forget the certificate: %w", err)
	}
	if err := w.Identity.ForgetKeys(); err != nil {
		return fmt.Errorf("sign the browsers out: %w", err)
	}
	if err := w.Logs.Clear(); err != nil {
		return fmt.Errorf("empty the log: %w", err)
	}
	return nil
}
