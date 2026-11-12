// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package desec talks to deSEC, the non-profit DNS service in Berlin that
// gives the home network its free name under `dedyn.io`. Its account side
// creates the account and the token; its records side points the name at
// the computer's home address and writes the DNS-01 challenge records.
package desec

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/perseomazzoni/phospheare/desktop/internal/ports"
)

// API is the production base of deSEC's API.
const API = "https://desec.io/api/v1"

// Client calls deSEC's API at BaseURL.
type Client struct {
	BaseURL string
	HTTP    *http.Client
	// TokenName is the name the token carries in the person's deSEC
	// account, where they see it.
	TokenName string
	// RetryAfter is the first pause before asking again when deSEC's own
	// gateway fails; each later pause is longer.
	RetryAfter time.Duration
}

// tries is how many times a call is made while deSEC's gateway fails.
const tries = 3

// call sends body as JSON with token, when given, and decodes a successful
// answer into out. It answers the status with any error so callers can
// tell a refusal from a failure. An answer of 502, 503 or 504 is deSEC's
// gateway failing, which passes, so a call that can be repeated is made
// again. A POST is not: the gateway may have passed it on before it failed,
// and a second one would register or make a token twice.
func (c *Client) call(ctx context.Context, method, path, token string, body, out any) (int, error) {
	var raw []byte
	if body != nil {
		var err error
		if raw, err = json.Marshal(body); err != nil {
			return 0, err
		}
	}
	pause := c.RetryAfter
	if pause == 0 {
		pause = 2 * time.Second
	}
	for try := 1; ; try++ {
		status, err := c.once(ctx, method, path, token, raw, body != nil, out)
		if try == tries || !repeatable(method) || status != http.StatusBadGateway && status != http.StatusServiceUnavailable && status != http.StatusGatewayTimeout {
			return status, err
		}
		select {
		case <-ctx.Done():
			return status, err
		case <-time.After(pause * time.Duration(try)):
		}
	}
}

// repeatable reports a method whose call has the same effect made twice.
// deSEC's bulk PATCH of record sets is one: it sets each set whole.
func repeatable(method string) bool {
	switch method {
	case http.MethodGet, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	}
	return false
}

func (c *Client) once(ctx context.Context, method, path, token string, raw []byte, hasBody bool, out any) (int, error) {
	var rd io.Reader
	if hasBody {
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, rd)
	if err != nil {
		return 0, err
	}
	if hasBody {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Token "+token)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return 0, fmt.Errorf("deSEC cannot be reached: %w", err)
	}
	defer resp.Body.Close()
	answer, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		if out != nil && len(answer) > 0 {
			if err := json.Unmarshal(answer, out); err != nil {
				return resp.StatusCode, fmt.Errorf("deSEC answered something unexpected: %w", err)
			}
		}
		return resp.StatusCode, nil
	}
	return resp.StatusCode, refusal(resp, answer)
}

// fields maps deSEC's field names to the ones the setup page shows.
var fields = map[string]string{"email": "email", "domain": "name", "name": "name"}

// refusal turns a deSEC error answer into a ports.Refusal. deSEC answers
// either {"detail": "..."} or an object of field names to messages.
func refusal(resp *http.Response, raw []byte) error {
	if resp.StatusCode == http.StatusTooManyRequests {
		wait := resp.Header.Get("Retry-After")
		if wait == "" {
			wait = "a few"
		}
		return &ports.Refusal{Message: "deSEC asks to wait " + wait + " seconds before trying again."}
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return &ports.Refusal{Field: "token", Message: "deSEC does not accept this token."}
	}
	var detail struct {
		Detail string `json:"detail"`
	}
	if json.Unmarshal(raw, &detail) == nil && detail.Detail != "" {
		return &ports.Refusal{Message: "deSEC says: " + detail.Detail}
	}
	var byField map[string]any
	if json.Unmarshal(raw, &byField) == nil && len(byField) > 0 {
		keys := make([]string, 0, len(byField))
		for k := range byField {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var msgs []string
		field := ""
		for _, k := range keys {
			if field == "" {
				field = fields[k]
			}
			msgs = append(msgs, messages(byField[k])...)
		}
		if len(msgs) > 0 {
			return &ports.Refusal{Field: field, Message: "deSEC says: " + strings.Join(msgs, " ")}
		}
	}
	return fmt.Errorf("deSEC answered status %d", resp.StatusCode)
}

// messages flattens a field's value, a string or a list of strings.
func messages(v any) []string {
	switch m := v.(type) {
	case string:
		return []string{m}
	case []any:
		var out []string
		for _, e := range m {
			out = append(out, messages(e)...)
		}
		return out
	}
	return nil
}
