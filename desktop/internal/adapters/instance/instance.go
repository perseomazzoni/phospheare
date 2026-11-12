// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package instance tells whether the program holding the loopback port is
// another copy of `once-dark-studio-desktop`, so a second launch opens the
// browser at the running one instead of failing.
package instance

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/admin"
	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
)

// Probe reports whether the server at addr (`127.0.0.1:<port>`) answers
// `GET /desktop/info` as this program when asked for host.
func Probe(ctx context.Context, addr, host string) bool {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+addr+"/desktop/info", nil)
	if err != nil {
		return false
	}
	req.Host = host
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false
	}
	var info struct {
		Program string `json:"program"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&info) != nil {
		return false
	}
	return info.Program == admin.Program
}

// OpenAgain asks the copy holding port to open the browser where a person
// finds it again: the app, or the setup page where no tray leads there.
// The running copy opens it, since only it holds the setup page's key. An
// error means it did not, as with a copy too old to be asked.
func OpenAgain(ctx context.Context, port int) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://"+addr+admin.OpenAgainPath, nil)
	if err != nil {
		return err
	}
	req.Host = domain.LoopbackHost("localhost", port)
	req.Header.Set(admin.AdminHeader, "1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		return fmt.Errorf("the running copy answered %d", resp.StatusCode)
	}
	return nil
}
