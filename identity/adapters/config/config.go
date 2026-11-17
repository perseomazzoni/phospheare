// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package config reads the identity service's settings from its
// environment. Reading checks every setting and answers every problem at
// once, each naming its variable, so a bad configuration stops the service
// before it listens.
//
// A parent process that keeps the secrets in the system's own store passes
// them on standard input instead (IDENTITY_SECRETS_ON_STDIN): one JSON line
// with the Google client secret and the seal keyring, read before anything
// else, so neither is in the environment or on disk.
package config

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"strconv"
	"strings"

	"github.com/perseomazzoni/phospheare/identity/domain"
)

// Config is a checked set of settings.
type Config struct {
	Origins      []domain.Origin
	Google       domain.Credentials
	SealKeysFile string
	// SealKeys is the keyring's text when it came on standard input; the
	// service then reads no SealKeysFile.
	SealKeys string
	Listen   string
	// ProductName names the service on the pages it serves; "" keeps the
	// build's name.
	ProductName string
	// StopOnStdinClose stops the service, as `SIGTERM` does, when its standard
	// input closes: a parent that keeps a pipe to it open takes it down
	// with it however the parent ends.
	StopOnStdinClose bool
	// LogJSON writes the log as JSON lines, for a parent that writes them
	// into its own log file; text lines otherwise.
	LogJSON bool
	// LogLevel is the lowest level the log writes.
	LogLevel slog.Level
}

// DefaultListen is where the service listens without IDENTITY_LISTEN.
const DefaultListen = ":8080"

// Environment is where settings come from: a variable's value.
type Environment struct {
	Getenv func(string) string
	// Secrets, when not nil, came on standard input and stand in for
	// IDENTITY_GOOGLE_CLIENT_SECRET and IDENTITY_SEAL_KEYS_FILE.
	Secrets *Secrets
}

// Secrets is the line a parent writes on standard input.
type Secrets struct {
	GoogleClientSecret string `json:"googleClientSecret"`
	// SealKeys is the keyring as its file would hold it, one key per line.
	SealKeys string `json:"sealKeys"`
}

// SecretsOnStdin reports whether IDENTITY_SECRETS_ON_STDIN asks for the
// secrets on standard input. A value that is neither true nor false is
// Load's to report, and answers false here.
func SecretsOnStdin(env Environment) bool {
	on, err := strconv.ParseBool(strings.TrimSpace(env.Getenv("IDENTITY_SECRETS_ON_STDIN")))
	return err == nil && on
}

// maxSecretsLine bounds the line, so a parent that never ends it cannot
// make the service read without end.
const maxSecretsLine = 64 << 10

// ReadSecrets reads the secrets line from r, leaving the rest of r unread.
func ReadSecrets(r *bufio.Reader) (Secrets, error) {
	var line []byte
	for {
		chunk, more, err := r.ReadLine()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return Secrets{}, errors.New("IDENTITY_SECRETS_ON_STDIN: standard input ended before the secrets line")
			}
			return Secrets{}, fmt.Errorf("IDENTITY_SECRETS_ON_STDIN: %w", err)
		}
		line = append(line, chunk...)
		if len(line) > maxSecretsLine {
			return Secrets{}, errors.New("IDENTITY_SECRETS_ON_STDIN: the secrets line is too long")
		}
		if !more {
			break
		}
	}
	var s Secrets
	dec := json.NewDecoder(strings.NewReader(string(line)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&s); err != nil {
		return Secrets{}, fmt.Errorf("IDENTITY_SECRETS_ON_STDIN: the secrets line is not its JSON: %w", err)
	}
	return s, nil
}

// Client is the part of the settings that names the Google client and the
// origins it serves: what `identity google-check` needs.
type Client struct {
	Origins []domain.Origin
	Google  domain.Credentials
}

// LoadClient reads and checks only the origins and the Google client.
func LoadClient(env Environment) (Client, error) {
	var errs []error
	c := readClient(env, &errs)
	if err := errors.Join(errs...); err != nil {
		return Client{}, err
	}
	return c, nil
}

// Load reads and checks every setting from env.
func Load(env Environment) (Config, error) {
	var errs []error
	fail := func(name, format string, args ...any) {
		errs = append(errs, fmt.Errorf("%s: %s", name, fmt.Sprintf(format, args...)))
	}
	get := func(name string) string { return strings.TrimSpace(env.Getenv(name)) }

	client := readClient(env, &errs)
	c := Config{
		Origins:      client.Origins,
		Google:       client.Google,
		Listen:       or(get("IDENTITY_LISTEN"), DefaultListen),
		SealKeysFile: get("IDENTITY_SEAL_KEYS_FILE"),
		ProductName:  get("IDENTITY_PRODUCT_NAME"),
	}

	if raw := get("IDENTITY_SECRETS_ON_STDIN"); raw != "" {
		if _, err := strconv.ParseBool(raw); err != nil {
			fail("IDENTITY_SECRETS_ON_STDIN", "%q is neither true nor false", raw)
		}
	}
	switch {
	case env.Secrets != nil:
		c.SealKeysFile = ""
		if c.SealKeys = env.Secrets.SealKeys; strings.TrimSpace(c.SealKeys) == "" {
			fail("IDENTITY_SECRETS_ON_STDIN", "the secrets line holds no sealKeys")
		}
	case c.SealKeysFile == "":
		fail("IDENTITY_SEAL_KEYS_FILE", "required: the keyring file, one key per line, made with one key when it does not exist")
	}

	if _, port, err := net.SplitHostPort(c.Listen); err != nil || port == "" {
		fail("IDENTITY_LISTEN", "%q is not host:port", c.Listen)
	}

	if raw := get("IDENTITY_STOP_ON_STDIN_CLOSE"); raw != "" {
		stop, err := strconv.ParseBool(raw)
		if err != nil {
			fail("IDENTITY_STOP_ON_STDIN_CLOSE", "%q is neither true nor false", raw)
		}
		c.StopOnStdinClose = stop
	}

	switch raw := strings.ToLower(get("IDENTITY_LOG_FORMAT")); raw {
	case "", "text":
	case "json":
		c.LogJSON = true
	default:
		fail("IDENTITY_LOG_FORMAT", "%q is neither text nor json", raw)
	}

	switch raw := strings.ToLower(get("IDENTITY_LOG_LEVEL")); raw {
	case "", "info":
		c.LogLevel = slog.LevelInfo
	case "debug":
		c.LogLevel = slog.LevelDebug
	case "warn":
		c.LogLevel = slog.LevelWarn
	case "error":
		c.LogLevel = slog.LevelError
	default:
		fail("IDENTITY_LOG_LEVEL", "%q is not debug, info, warn or error", raw)
	}

	if err := errors.Join(errs...); err != nil {
		return Config{}, err
	}
	return c, nil
}

// readClient reads the origins and the Google client, adding a problem to
// errs for each setting that is wrong.
func readClient(env Environment, errs *[]error) Client {
	fail := func(name, format string, args ...any) {
		*errs = append(*errs, fmt.Errorf("%s: %s", name, fmt.Sprintf(format, args...)))
	}
	get := func(name string) string { return strings.TrimSpace(env.Getenv(name)) }
	var c Client
	if raw := get("IDENTITY_PUBLIC_ORIGINS"); raw == "" {
		fail("IDENTITY_PUBLIC_ORIGINS", "required: the browser origins the service answers, comma-separated")
	} else if origins, err := domain.ParseOrigins(raw); err != nil {
		fail("IDENTITY_PUBLIC_ORIGINS", "%v", err)
	} else {
		c.Origins = origins
	}

	c.Google.ClientID = get("IDENTITY_GOOGLE_CLIENT_ID")
	switch {
	case c.Google.ClientID == "":
		fail("IDENTITY_GOOGLE_CLIENT_ID", "required: the Web application client's id")
	case strings.ContainsAny(c.Google.ClientID, " \t"):
		fail("IDENTITY_GOOGLE_CLIENT_ID", "holds a space")
	}
	switch {
	case env.Secrets != nil:
		if c.Google.ClientSecret = strings.TrimSpace(env.Secrets.GoogleClientSecret); c.Google.ClientSecret == "" {
			fail("IDENTITY_SECRETS_ON_STDIN", "the secrets line holds no googleClientSecret")
		}
	default:
		if c.Google.ClientSecret = get("IDENTITY_GOOGLE_CLIENT_SECRET"); c.Google.ClientSecret == "" {
			fail("IDENTITY_GOOGLE_CLIENT_SECRET", "required: the Web application client's secret")
		}
	}
	return c
}

func or(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}
