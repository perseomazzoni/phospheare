// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package config

import (
	"bufio"
	"errors"
	"io"
	"strings"
	"testing"
)

func env(vars map[string]string) Environment {
	return Environment{Getenv: func(k string) string { return vars[k] }}
}

func valid() map[string]string {
	return map[string]string{
		"IDENTITY_PUBLIC_ORIGINS":       "https://studio.example.test",
		"IDENTITY_GOOGLE_CLIENT_ID":     "123.apps.googleusercontent.com",
		"IDENTITY_GOOGLE_CLIENT_SECRET": "secret",
		"IDENTITY_SEAL_KEYS_FILE":       "/run/secrets/seal.keys",
	}
}

func TestLoadAppliesDefaults(t *testing.T) {
	c, err := Load(env(valid()))
	if err != nil {
		t.Fatal(err)
	}
	if c.Listen != ":8080" || len(c.Origins) != 1 ||
		c.Origins[0].Host != "studio.example.test" || c.Google.ClientSecret != "secret" || c.StopOnStdinClose {
		t.Fatalf("config %+v", c)
	}
}

func TestLoadReadsStopOnStdinClose(t *testing.T) {
	vars := valid()
	vars["IDENTITY_STOP_ON_STDIN_CLOSE"] = "true"
	c, err := Load(env(vars))
	if err != nil || !c.StopOnStdinClose {
		t.Fatalf("stop on stdin close %v, %v", c.StopOnStdinClose, err)
	}
}

func TestLoadTakesTheSecretsFromStdin(t *testing.T) {
	vars := valid()
	delete(vars, "IDENTITY_GOOGLE_CLIENT_SECRET")
	vars["IDENTITY_SECRETS_ON_STDIN"] = "true"
	e := env(vars)
	e.Secrets = &Secrets{GoogleClientSecret: "from stdin", SealKeys: "key\n"}
	c, err := Load(e)
	if err != nil {
		t.Fatal(err)
	}
	if c.Google.ClientSecret != "from stdin" || c.SealKeys != "key\n" || c.SealKeysFile != "" {
		t.Fatalf("config %+v", c)
	}
}

func TestLoadNamesAnEmptySecretsLine(t *testing.T) {
	vars := valid()
	vars["IDENTITY_SECRETS_ON_STDIN"] = "true"
	e := env(vars)
	e.Secrets = &Secrets{}
	_, err := Load(e)
	if err == nil || !strings.Contains(err.Error(), "no googleClientSecret") || !strings.Contains(err.Error(), "no sealKeys") {
		t.Fatalf("want both secrets named, got: %v", err)
	}
}

func TestSecretsOnStdinIsTrueOnlyWhenAskedFor(t *testing.T) {
	for value, want := range map[string]bool{"": false, "false": false, "sometimes": false, "true": true, " 1 ": true} {
		if got := SecretsOnStdin(env(map[string]string{"IDENTITY_SECRETS_ON_STDIN": value})); got != want {
			t.Errorf("%q: %v, want %v", value, got, want)
		}
	}
}

func TestReadSecretsReadsOneLineAndLeavesTheRest(t *testing.T) {
	in := bufio.NewReader(strings.NewReader(`{"googleClientSecret":"s","sealKeys":"k\n"}` + "\nrest"))
	s, err := ReadSecrets(in)
	if err != nil || s.GoogleClientSecret != "s" || s.SealKeys != "k\n" {
		t.Fatalf("secrets %+v, %v", s, err)
	}
	if rest, _ := io.ReadAll(in); string(rest) != "rest" {
		t.Fatalf("rest %q", rest)
	}
}

func TestReadSecretsRefusesWhatIsNotTheLine(t *testing.T) {
	for _, text := range []string{"", `{"googleClientSecret":"s","other":1}` + "\n", "not json\n"} {
		if _, err := ReadSecrets(bufio.NewReader(strings.NewReader(text))); err == nil ||
			!strings.Contains(err.Error(), "IDENTITY_SECRETS_ON_STDIN") {
			t.Errorf("%q: %v", text, err)
		}
	}
}

func TestLoadNamesEverySettingThatIsWrong(t *testing.T) {
	_, err := Load(env(map[string]string{
		"IDENTITY_PUBLIC_ORIGINS":      "http://studio.example.test",
		"IDENTITY_LISTEN":              "8080",
		"IDENTITY_STOP_ON_STDIN_CLOSE": "sometimes",
	}))
	if err == nil {
		t.Fatal("a broken environment loaded")
	}
	for _, name := range []string{
		"IDENTITY_PUBLIC_ORIGINS", "IDENTITY_GOOGLE_CLIENT_ID", "IDENTITY_GOOGLE_CLIENT_SECRET",
		"IDENTITY_SEAL_KEYS_FILE", "IDENTITY_LISTEN", "IDENTITY_STOP_ON_STDIN_CLOSE",
	} {
		if !strings.Contains(err.Error(), name+":") {
			t.Fatalf("the error does not name %s:\n%v", name, err)
		}
	}
	var joined interface{ Unwrap() []error }
	if !errors.As(err, &joined) || len(joined.Unwrap()) != 6 {
		t.Fatalf("want six problems, got: %v", err)
	}
}
