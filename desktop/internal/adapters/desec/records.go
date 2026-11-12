// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package desec

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
)

// rrset is one record set in deSEC's bulk form. An empty Records deletes it.
type rrset struct {
	Subname string   `json:"subname"`
	Type    string   `json:"type"`
	TTL     int      `json:"ttl"`
	Records []string `json:"records"`
}

// minimumTTL answers the shortest time to live domain allows; deSEC sets it
// per domain, 3600 seconds for most `dedyn.io` names.
func (c *Client) minimumTTL(ctx context.Context, token, domain string) (int, error) {
	var out struct {
		MinimumTTL int `json:"minimum_ttl"`
	}
	if _, err := c.call(ctx, http.MethodGet, "/domains/"+url.PathEscape(domain)+"/", token, nil, &out); err != nil {
		return 0, err
	}
	if out.MinimumTTL <= 0 {
		return 3600, nil
	}
	return out.MinimumTTL, nil
}

// write creates, replaces or deletes record sets in one change. The bulk
// `PATCH` leaves every other record set as it is.
func (c *Client) write(ctx context.Context, token, domain string, sets ...rrset) error {
	_, err := c.call(ctx, http.MethodPatch, "/domains/"+url.PathEscape(domain)+"/rrsets/", token, sets, nil)
	return err
}

// SetA points domain itself at ip, with the domain's minimum time to live
// so a changed address reaches phones as soon as deSEC allows. It also
// removes any `AAAA` record there: a phone that prefers IPv6 would try a
// stale one first and never reach the computer.
func (c *Client) SetA(ctx context.Context, token, domain, ip string) error {
	ttl, err := c.minimumTTL(ctx, token, domain)
	if err != nil {
		return err
	}
	return c.write(ctx, token, domain,
		rrset{Subname: "", Type: "A", TTL: ttl, Records: []string{ip}},
		rrset{Subname: "", Type: "AAAA", TTL: ttl, Records: []string{}})
}

// SetTXT writes subname's `TXT` record with value, quoted as DNS needs.
func (c *Client) SetTXT(ctx context.Context, token, domain, subname, value string) error {
	ttl, err := c.minimumTTL(ctx, token, domain)
	if err != nil {
		return err
	}
	return c.write(ctx, token, domain, rrset{Subname: subname, Type: "TXT", TTL: ttl, Records: []string{strconv.Quote(value)}})
}

// DeleteTXT removes subname's `TXT` record.
func (c *Client) DeleteTXT(ctx context.Context, token, domain, subname string) error {
	ttl, err := c.minimumTTL(ctx, token, domain)
	if err != nil {
		return err
	}
	return c.write(ctx, token, domain, rrset{Subname: subname, Type: "TXT", TTL: ttl, Records: []string{}})
}
