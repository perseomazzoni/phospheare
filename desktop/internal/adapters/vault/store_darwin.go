// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package vault

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

// The login Keychain keeps each secret as a generic password: service
// `once-dark-studio-desktop`, account `<name> <data folder>`. The release
// build has no cgo, so the Security framework is reached through
// `/usr/bin/security`. A new secret goes to it on standard input
// (`security -i`), never in its arguments, which every process list shows.
// The items then trust that tool, which reads them without a prompt.
//
// The value is kept as base64: `security -w` prints a value holding a
// newline, as a PEM key does, in hex, and base64 prints as itself.

const securityTool = "/usr/bin/security"

// notFound is the tool's exit code for an item it does not hold.
const notFound = 44

type keychain struct{ dir string }

func system(dataDir string) (systemStore, error) {
	return keychain{dir: dataDir}, nil
}

// account answers the item's account. The tool's command line takes it in
// single quotes, so a data folder holding a quote is named by its hash.
func (k keychain) account(name string) string {
	if strings.ContainsAny(k.dir, "'\\\n") {
		sum := sha256.Sum256([]byte(k.dir))
		return name + " " + hex.EncodeToString(sum[:8])
	}
	return name + " " + k.dir
}

func (k keychain) check() error {
	if out, err := exec.Command(securityTool, "default-keychain").CombinedOutput(); err != nil {
		return fmt.Errorf("security default-keychain: %v: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (k keychain) get(name string) (string, error) {
	out, err := exec.Command(securityTool, "find-generic-password", "-s", product, "-a", k.account(name), "-w").Output()
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() == notFound {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("the Keychain did not answer for %s: %w", name, err)
	}
	value, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(out)))
	if err != nil {
		return "", fmt.Errorf("the Keychain's %s is not this program's: %w", name, err)
	}
	return string(value), nil
}

func (k keychain) set(name, value string) error {
	cmd := exec.Command(securityTool, "-i")
	cmd.Stdin = strings.NewReader(fmt.Sprintf("add-generic-password -U -s '%s' -a '%s' -w '%s'\n",
		product, k.account(name), base64.StdEncoding.EncodeToString([]byte(value))))
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("the Keychain did not keep %s: %v: %s", name, err, strings.TrimSpace(string(out)))
	}
	// The interactive tool can end well after a command that failed, so
	// the item is read back.
	kept, err := k.get(name)
	if err != nil {
		return err
	}
	if kept != value {
		return fmt.Errorf("the Keychain did not keep %s", name)
	}
	return nil
}

func (k keychain) remove(name string) error {
	out, err := exec.Command(securityTool, "delete-generic-password", "-s", product, "-a", k.account(name)).CombinedOutput()
	var exit *exec.ExitError
	if err == nil || (errors.As(err, &exit) && exit.ExitCode() == notFound) {
		return nil
	}
	return fmt.Errorf("the Keychain did not remove %s: %v: %s", name, err, strings.TrimSpace(string(out)))
}
