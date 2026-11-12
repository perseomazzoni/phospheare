// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package vault

import (
	"errors"
	"fmt"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Credential Manager keeps each secret as a generic credential named
// `once-dark-studio-desktop:<data folder>:<name>`, under "Windows
// Credentials" in its window. Windows encrypts it with the person's login
// (`DPAPI`), and the local-machine persistence keeps it out of a roaming
// profile.

var (
	advapi32        = windows.NewLazySystemDLL("advapi32.dll")
	procCredReadW   = advapi32.NewProc("CredReadW")
	procCredWriteW  = advapi32.NewProc("CredWriteW")
	procCredDeleteW = advapi32.NewProc("CredDeleteW")
	procCredFree    = advapi32.NewProc("CredFree")
)

const (
	credTypeGeneric         = 1
	credPersistLocalMachine = 2
	// credMaxBlob is the most a generic credential holds.
	credMaxBlob = 5 * 512
)

// credential is the `CREDENTIALW` structure.
type credential struct {
	Flags              uint32
	Type               uint32
	TargetName         *uint16
	Comment            *uint16
	LastWritten        windows.Filetime
	CredentialBlobSize uint32
	CredentialBlob     *byte
	Persist            uint32
	AttributeCount     uint32
	Attributes         uintptr
	TargetAlias        *uint16
	UserName           *uint16
}

type credentials struct{ prefix string }

func system(dataDir string) (systemStore, error) {
	return credentials{prefix: product + ":" + dataDir + ":"}, nil
}

func (c credentials) check() error {
	if err := procCredReadW.Find(); err != nil {
		return err
	}
	_, err := c.get("check")
	return err
}

func (c credentials) get(name string) (string, error) {
	target, err := windows.UTF16PtrFromString(c.prefix + name)
	if err != nil {
		return "", err
	}
	var cred *credential
	ok, _, err := procCredReadW.Call(uintptr(unsafe.Pointer(target)), credTypeGeneric, 0, uintptr(unsafe.Pointer(&cred)))
	if ok == 0 {
		if errors.Is(err, windows.ERROR_NOT_FOUND) {
			return "", nil
		}
		return "", fmt.Errorf("Credential Manager: %w", err)
	}
	defer procCredFree.Call(uintptr(unsafe.Pointer(cred)))
	if cred.CredentialBlobSize == 0 {
		return "", nil
	}
	return string(unsafe.Slice(cred.CredentialBlob, cred.CredentialBlobSize)), nil
}

func (c credentials) set(name, value string) error {
	if len(value) > credMaxBlob {
		return fmt.Errorf("Credential Manager holds at most %d bytes, and %s is %d", credMaxBlob, name, len(value))
	}
	target, err := windows.UTF16PtrFromString(c.prefix + name)
	if err != nil {
		return err
	}
	user, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return err
	}
	blob := []byte(value)
	cred := credential{
		Type:               credTypeGeneric,
		TargetName:         target,
		CredentialBlobSize: uint32(len(blob)),
		CredentialBlob:     &blob[0],
		Persist:            credPersistLocalMachine,
		UserName:           user,
	}
	ok, _, err := procCredWriteW.Call(uintptr(unsafe.Pointer(&cred)), 0)
	runtime.KeepAlive(blob)
	runtime.KeepAlive(target)
	runtime.KeepAlive(user)
	if ok == 0 {
		return fmt.Errorf("Credential Manager: %w", err)
	}
	return nil
}

func (c credentials) remove(name string) error {
	target, err := windows.UTF16PtrFromString(c.prefix + name)
	if err != nil {
		return err
	}
	ok, _, err := procCredDeleteW.Call(uintptr(unsafe.Pointer(target)), credTypeGeneric, 0)
	if ok == 0 && !errors.Is(err, windows.ERROR_NOT_FOUND) {
		return fmt.Errorf("Credential Manager: %w", err)
	}
	return nil
}
