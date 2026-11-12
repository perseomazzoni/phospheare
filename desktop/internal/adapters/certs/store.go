// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package certs

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/durable"
	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
	"github.com/perseomazzoni/phospheare/desktop/internal/ports"
)

// Load reads a PEM certificate chain and key and checks that the leaf
// covers hostname and has not expired at now.
func Load(certPEM, keyPEM []byte, hostname string, now time.Time) (*tls.Certificate, domain.CertInfo, error) {
	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return nil, domain.CertInfo{}, fmt.Errorf("the certificate and key do not load together: %w", err)
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		return nil, domain.CertInfo{}, err
	}
	cert.Leaf = leaf
	info := domain.CertInfo{NotAfter: leaf.NotAfter, Issuer: issuerName(leaf), Names: leaf.DNSNames}
	if err := leaf.VerifyHostname(hostname); err != nil {
		return nil, info, fmt.Errorf("the certificate does not cover %s", hostname)
	}
	if !now.Before(leaf.NotAfter) {
		return nil, info, fmt.Errorf("the certificate expired on %s", leaf.NotAfter.Format("2 January 2006"))
	}
	if now.Before(leaf.NotBefore) {
		return nil, info, errors.New("the certificate is not valid yet")
	}
	return &cert, info, nil
}

func issuerName(c *x509.Certificate) string {
	if c.Issuer.CommonName != "" {
		if len(c.Issuer.Organization) > 0 {
			return c.Issuer.Organization[0] + " " + c.Issuer.CommonName
		}
		return c.Issuer.CommonName
	}
	return c.Issuer.String()
}

// Dir is where the certificate lives: the issued certificate in the
// `tls/` folder at Path, and the two private keys, the `ACME` account's
// and the certificate's, in the vault.
type Dir struct {
	Path  string
	Vault ports.Vault
}

func (d Dir) path(name string) string { return filepath.Join(d.Path, name) }

// AccountKey reads the `ACME` account key, creating it on first use.
func (d Dir) AccountKey() (crypto.Signer, error) {
	raw, err := d.Vault.Get(domain.SecretACMEAccountKey)
	if err != nil {
		return nil, err
	}
	if raw != "" {
		block, _ := pem.Decode([]byte(raw))
		if block == nil {
			return nil, errors.New("the kept ACME account key is not PEM")
		}
		return x509.ParseECPrivateKey(block.Bytes)
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	der, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, err
	}
	if err := d.Vault.Set(domain.SecretACMEAccountKey, string(pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: der}))); err != nil {
		return nil, err
	}
	return key, nil
}

// Issued reads the stored certificate and key.
func (d Dir) Issued() (certPEM, keyPEM []byte, err error) {
	if certPEM, err = os.ReadFile(d.path("cert.pem")); err != nil {
		return nil, nil, err
	}
	key, err := d.Vault.Get(domain.SecretTLSKey)
	if err != nil {
		return nil, nil, err
	}
	if key == "" {
		return nil, nil, errors.New("the certificate's key is not kept")
	}
	return certPEM, []byte(key), nil
}

// Forget removes the certificate and both keys.
func (d Dir) Forget() error {
	for _, name := range []string{domain.SecretTLSKey, domain.SecretACMEAccountKey} {
		if err := d.Vault.Set(name, ""); err != nil {
			return err
		}
	}
	if err := os.Remove(d.path("cert.pem")); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// SaveIssued stores a certificate and its key: the key first, so a
// certificate on disk never pairs with an older key.
func (d Dir) SaveIssued(certPEM, keyPEM []byte) error {
	if err := d.Vault.Set(domain.SecretTLSKey, string(keyPEM)); err != nil {
		return err
	}
	if err := os.MkdirAll(d.Path, 0o700); err != nil {
		return err
	}
	return durable.WriteFile(d.path("cert.pem"), certPEM, 0o600)
}
