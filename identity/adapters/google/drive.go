// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package google

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/perseomazzoni/phospheare/identity/ports"
)

// DriveFiles is Google Drive's files endpoint.
const DriveFiles = "https://www.googleapis.com/drive/v3/files"

// Drive makes the trial sign-in's one Google Drive call.
type Drive struct {
	// Files is the files endpoint; tests point it at a fake.
	Files string
	HTTP  *http.Client
}

// NewDrive answers a Drive over files with a 20-second timeout.
func NewDrive(files string) *Drive {
	return &Drive{Files: files, HTTP: &http.Client{Timeout: 20 * time.Second}}
}

// driveError is Google's JSON error answer. The reason of a turned-off API
// is `accessNotConfigured` in errors[], and `SERVICE_DISABLED` in the newer
// details[]; a token without the scope gets `insufficientPermissions` or
// `ACCESS_TOKEN_SCOPE_INSUFFICIENT`.
type driveError struct {
	Error struct {
		Errors []struct {
			Reason string `json:"reason"`
		} `json:"errors"`
		Details []struct {
			Reason string `json:"reason"`
		} `json:"details"`
	} `json:"error"`
}

func (e driveError) reasons() []string {
	var out []string
	for _, x := range e.Error.Errors {
		out = append(out, x.Reason)
	}
	for _, x := range e.Error.Details {
		out = append(out, x.Reason)
	}
	return out
}

// Probe lists one file of the app's hidden folder with accessToken.
func (d *Drive) Probe(ctx context.Context, accessToken string) error {
	q := url.Values{"spaces": {"appDataFolder"}, "pageSize": {"1"}, "fields": {"files(id)"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, d.Files+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	resp, err := d.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ports.ErrUnreachable, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("%w: %v", ports.ErrUnreachable, err)
	}
	switch {
	case resp.StatusCode < 300:
		return nil
	case resp.StatusCode >= 500:
		return fmt.Errorf("%w: status %d", ports.ErrUnreachable, resp.StatusCode)
	}
	var de driveError
	_ = json.Unmarshal(body, &de)
	for _, r := range de.reasons() {
		switch r {
		case "accessNotConfigured", "SERVICE_DISABLED":
			return ports.ErrDriveOff
		case "insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT":
			return ports.ErrDriveScope
		}
	}
	return fmt.Errorf("google drive: status %d", resp.StatusCode)
}
