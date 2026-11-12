// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package application

import (
	"context"
	"errors"
	"strings"

	"github.com/perseomazzoni/phospheare/identity/domain"
	"github.com/perseomazzoni/phospheare/identity/ports"
)

// OpenSession answers the claims of a new writer session for writerID, with
// a fresh id and proof, or nil when existing, an admitted session, already
// belongs to that writer: a second tab of the same writer sends the proof
// the first one keeps, and keeps the session, so it does not end the first
// tab's flows.
func (s *Service) OpenSession(existing *domain.Session, writerID string) (*domain.SessionClaims, error) {
	if !domain.WriterIDPattern.MatchString(writerID) {
		return nil, domain.Refuse(domain.CodeBadRequest)
	}
	if existing != nil && existing.WriterID == writerID {
		return nil, nil
	}
	sid, err := domain.RandomID(16)
	if err != nil {
		return nil, err
	}
	proof, err := domain.RandomID(32)
	if err != nil {
		return nil, err
	}
	return &domain.SessionClaims{SID: sid, WriterID: writerID, IAT: s.now().Unix(), Proof: proof}, nil
}

// Admit answers the session c seals when proof unlocks it, or nil.
func (s *Service) Admit(c domain.SessionClaims, proof string) *domain.Session {
	if !c.Admits(proof, s.now()) {
		return nil
	}
	return &domain.Session{SID: c.SID, WriterID: c.WriterID, Proof: c.Proof}
}

// NewConnection answers the claims of a new Drive connection for writerID
// over grant g, under a fresh connection id.
func (s *Service) NewConnection(writerID string, g *domain.Grant) (domain.ConnectionClaims, error) {
	id, err := domain.RandomID(18)
	if err != nil {
		return domain.ConnectionClaims{}, err
	}
	return domain.ConnectionClaims{
		V:            1,
		ConnectionID: id,
		WriterID:     writerID,
		Sub:          g.Sub,
		Email:        g.Email,
		RefreshToken: g.RefreshToken,
		Scopes:       g.Scopes,
		CreatedAt:    s.now().Unix(),
	}, nil
}

// Refresh answers a new access token for conn on session. The second
// result is non-nil when Google issued a new refresh token, and holds the
// claims to seal in place of conn's. A grant Google refuses with
// `invalid_grant` answers CodeGrantInvalid, and the caller removes the
// connection.
func (s *Service) Refresh(ctx context.Context, session domain.Session, conn domain.ConnectionClaims) (*domain.Tokens, *domain.ConnectionClaims, error) {
	if conn.WriterID != session.WriterID {
		return nil, nil, domain.Refuse(domain.CodeWriterMismatch)
	}
	cred, ok := s.Clients.Credentials()
	if !ok {
		return nil, nil, domain.Refuse(domain.CodeNotConfigured)
	}
	tok, err := s.Google.Refresh(ctx, cred, conn.RefreshToken)
	if err != nil {
		var ge *ports.GoogleError
		switch {
		case errors.As(err, &ge) && ge.Code == "invalid_grant":
			return nil, nil, domain.Refuse(domain.CodeGrantInvalid)
		case errors.Is(err, ports.ErrUnreachable):
			return nil, nil, domain.Refuse(domain.CodeGoogleUnreachable)
		default:
			return nil, nil, domain.Refuse(domain.CodeGoogleRefused)
		}
	}
	if tok.RefreshToken == "" || tok.RefreshToken == conn.RefreshToken {
		return tok, nil, nil
	}
	next := conn
	next.RefreshToken = tok.RefreshToken
	if tok.Scope != "" {
		next.Scopes = strings.Fields(tok.Scope)
	}
	return tok, &next, nil
}

// Revoke revokes conn at Google on behalf of session, which must be the
// writer that owns it, and reports whether Google confirmed.
func (s *Service) Revoke(ctx context.Context, session *domain.Session, conn domain.ConnectionClaims) (bool, error) {
	if session == nil {
		return false, domain.Refuse(domain.CodeNoSession)
	}
	if conn.WriterID != session.WriterID {
		return false, domain.Refuse(domain.CodeWriterMismatch)
	}
	return s.Google.Revoke(ctx, conn.RefreshToken) == nil, nil
}
