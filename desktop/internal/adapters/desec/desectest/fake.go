// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package desectest is a stand-in for deSEC's API, for tests and for
// walking the setup page without real accounts. It keeps accounts, tokens
// with their policies and record sets in memory.
package desectest

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
)

type account struct {
	password, domain string
	active           bool
}

type policy struct {
	Domain    *string `json:"domain"`
	Subname   *string `json:"subname"`
	Type      *string `json:"type"`
	PermWrite bool    `json:"perm_write"`
}

type token struct {
	id, domain string
	login      bool
	policies   []policy
}

// Fake is the stand-in. Its zero value is not usable; call New.
type Fake struct {
	*httptest.Server

	mu       sync.Mutex
	accounts map[string]*account
	tokens   map[string]*token
	records  map[string][]string
	// Logins counts login attempts, so tests can check the polling.
	Logins int
	// TokenNames holds the name of every token made, in order.
	TokenNames []string
	// NoPolicies makes policy requests answer 403, as for a token that may
	// not manage tokens.
	NoPolicies bool
	// OnTXT, when set, sees every `TXT` write: the full name and its value,
	// or "" when the record is removed. It runs while the fake is locked, so
	// it must not call the fake.
	OnTXT func(fqdn, value string)
}

// New starts a fake. Its URL is the API base, as desec.API is.
func New() *Fake {
	f := NewUnstarted()
	f.Start()
	return f
}

// NewUnstarted makes a fake that is not started yet. Its caller can set the
// server's Listener and then call Start, or serve Config.Handler itself.
func NewUnstarted() *Fake {
	f := &Fake{accounts: map[string]*account{}, tokens: map[string]*token{}, records: map[string][]string{}}
	f.Server = httptest.NewUnstartedServer(http.HandlerFunc(f.serve))
	return f
}

// Account is an account as Accounts lists it.
type Account struct {
	Email, Domain string
	Active        bool
}

// Accounts answers every account, sorted by email.
func (f *Fake) Accounts() []Account {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]Account, 0, len(f.accounts))
	for email, a := range f.accounts {
		out = append(out, Account{Email: email, Domain: a.domain, Active: a.active})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Email < out[j].Email })
	return out
}

// Activate acts as the person using the activation link.
func (f *Fake) Activate(email string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if a := f.accounts[email]; a != nil {
		a.active = true
	}
}

// AddAccount adds an active account and answers a token for it, as one
// made on desec.io.
func (f *Fake) AddAccount(email, domain string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.accounts[email] = &account{password: "made-on-desec", domain: domain, active: true}
	return f.newToken(domain, false)
}

// Record answers the values of subname's record of type on domain.
func (f *Fake) Record(domain, subname, typ string) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.records[domain+"/"+subname+"/"+typ]
}

// Tokens answers how many long-lived tokens exist and how many of them
// carry policies.
func (f *Fake) Tokens() (all, narrowed int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, t := range f.tokens {
		if !t.login {
			all++
			if len(t.policies) > 0 {
				narrowed++
			}
		}
	}
	return all, narrowed
}

func (f *Fake) newToken(domain string, login bool) string {
	b := make([]byte, 12)
	rand.Read(b)
	v := hex.EncodeToString(b)
	f.tokens[v] = &token{id: "id-" + v, domain: domain, login: login}
	return v
}

func (f *Fake) byID(id string) (string, *token) {
	for v, t := range f.tokens {
		if t.id == id {
			return v, t
		}
	}
	return "", nil
}

func reply(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if body != nil {
		json.NewEncoder(w).Encode(body)
	}
}

// allows applies a token's policies: with none every write is allowed; with
// some, the most specific matching row decides.
func allows(t *token, domain, subname, typ string) bool {
	if len(t.policies) == 0 {
		return true
	}
	best, score := false, -1
	for _, p := range t.policies {
		s := 0
		if p.Domain != nil {
			if *p.Domain != domain {
				continue
			}
			s += 4
		}
		if p.Subname != nil {
			if *p.Subname != subname {
				continue
			}
			s += 2
		}
		if p.Type != nil {
			if *p.Type != typ {
				continue
			}
			s++
		}
		if s > score {
			best, score = p.PermWrite, s
		}
	}
	return best
}

func (f *Fake) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	path := r.URL.Path
	var caller *token
	if v, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Token "); ok {
		caller = f.tokens[v]
	}
	switch {
	case r.Method == http.MethodPost && path == "/auth/":
		var body struct{ Email, Password, Domain string }
		json.NewDecoder(r.Body).Decode(&body)
		if !strings.HasSuffix(body.Domain, ".dedyn.io") || strings.HasPrefix(body.Domain, "taken.") {
			reply(w, 400, map[string]any{"domain": []string{"This domain name is unavailable."}})
			return
		}
		if f.accounts[body.Email] == nil {
			f.accounts[body.Email] = &account{password: body.Password, domain: body.Domain}
		}
		reply(w, 202, map[string]string{"detail": "Welcome! Please check your mailbox."})
	case r.Method == http.MethodPost && path == "/auth/login/":
		f.Logins++
		var body struct{ Email, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		a := f.accounts[body.Email]
		if a == nil || a.password != body.Password || !a.active {
			reply(w, 403, map[string]string{"detail": "Invalid username/password."})
			return
		}
		reply(w, 200, map[string]string{"token": f.newToken(a.domain, true)})
	case r.Method == http.MethodPost && path == "/auth/logout/":
		if caller == nil {
			reply(w, 401, map[string]string{"detail": "Invalid token."})
			return
		}
		for v, t := range f.tokens {
			if t == caller {
				delete(f.tokens, v)
			}
		}
		w.WriteHeader(204)
	case r.Method == http.MethodPost && path == "/auth/tokens/":
		if caller == nil || !caller.login {
			reply(w, 403, map[string]string{"detail": "You do not have permission to perform this action."})
			return
		}
		var body struct{ Name string }
		json.NewDecoder(r.Body).Decode(&body)
		f.TokenNames = append(f.TokenNames, body.Name)
		v := f.newToken(caller.domain, false)
		reply(w, 201, map[string]string{"id": f.tokens[v].id, "token": v, "name": body.Name})
	case strings.HasPrefix(path, "/auth/tokens/"):
		rest := strings.TrimSuffix(strings.TrimPrefix(path, "/auth/tokens/"), "/")
		id, sub, _ := strings.Cut(rest, "/")
		if caller == nil || !caller.login || f.NoPolicies && sub != "" {
			reply(w, 403, map[string]string{"detail": "You do not have permission to perform this action."})
			return
		}
		v, t := f.byID(id)
		if t == nil {
			reply(w, 404, map[string]string{"detail": "Not found."})
			return
		}
		switch {
		case r.Method == http.MethodDelete && sub == "":
			delete(f.tokens, v)
			w.WriteHeader(204)
		case r.Method == http.MethodPost && sub == "policies/rrsets":
			var p policy
			json.NewDecoder(r.Body).Decode(&p)
			if len(t.policies) == 0 && (p.Domain != nil || p.Subname != nil || p.Type != nil) {
				reply(w, 400, map[string]any{"non_field_errors": []string{"Policy precedence: The first policy must be the default policy."}})
				return
			}
			t.policies = append(t.policies, p)
			reply(w, 201, p)
		default:
			reply(w, 405, nil)
		}
	case strings.HasPrefix(path, "/domains/"):
		rest := strings.TrimSuffix(strings.TrimPrefix(path, "/domains/"), "/")
		domain, sub, _ := strings.Cut(rest, "/")
		if caller == nil {
			reply(w, 401, map[string]string{"detail": "Invalid token."})
			return
		}
		if caller.domain != domain {
			reply(w, 404, map[string]string{"detail": "Not found."})
			return
		}
		switch {
		case r.Method == http.MethodGet && sub == "":
			reply(w, 200, map[string]any{"name": domain, "minimum_ttl": 3600})
		case r.Method == http.MethodPatch && sub == "rrsets":
			var sets []struct {
				Subname string   `json:"subname"`
				Type    string   `json:"type"`
				TTL     int      `json:"ttl"`
				Records []string `json:"records"`
			}
			json.NewDecoder(r.Body).Decode(&sets)
			for _, s := range sets {
				if !allows(caller, domain, s.Subname, s.Type) {
					reply(w, 403, map[string]string{"detail": "Insufficient token permissions."})
					return
				}
				if s.TTL < 3600 {
					reply(w, 400, map[string]any{"ttl": []string{"Ensure this value is greater than or equal to 3600."}})
					return
				}
			}
			for _, s := range sets {
				key := domain + "/" + s.Subname + "/" + s.Type
				if len(s.Records) == 0 {
					delete(f.records, key)
				} else {
					f.records[key] = s.Records
				}
				if s.Type == "TXT" && f.OnTXT != nil {
					fqdn := domain
					if s.Subname != "" {
						fqdn = s.Subname + "." + domain
					}
					value := ""
					if len(s.Records) > 0 {
						value = strings.Trim(s.Records[0], `"`)
					}
					f.OnTXT(fqdn, value)
				}
			}
			reply(w, 200, sets)
		default:
			reply(w, 405, nil)
		}
	default:
		reply(w, 404, map[string]string{"detail": "Not found."})
	}
}
