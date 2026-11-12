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

// A trial sign-in proves the Google setup from the setup page: the person
// signs in once and grants the Drive permissions, the callback touches
// Google Drive with the access token and keeps only a TrialReport. A trial
// belongs to no writer session, so it opens no session and no Drive
// connection.
//
// The token is not revoked. Revoking a token ends the whole grant of that
// account to the client, which may hold a live Drive connection in a
// browser; the trial's access token, issued without offline access, lapses
// within the hour instead.

// BeginTrial answers a new trial flow and the URL that starts it at Google.
func (s *Service) BeginTrial(redirectURI string) (domain.Flow, string, error) {
	return s.begin(BeginRequest{Purpose: domain.PurposeTrial, RedirectURI: redirectURI})
}

// trial settles a trial flow's callback into its report.
func (s *Service) trial(ctx context.Context, f domain.Flow, p CallbackParams) domain.TrialReport {
	switch {
	case domain.CancelledAtGoogle(p.Error):
		return domain.TrialReport{Result: domain.TrialCancelled}
	case p.Error != "" || p.Code == "":
		return domain.TrialReport{Result: domain.TrialFailed}
	}
	cred, ok := s.Clients.Credentials()
	if !ok {
		return domain.TrialReport{Result: domain.TrialFailed}
	}
	token, err := s.Google.Exchange(ctx, cred, p.Code, f.Verifier, f.RedirectURI)
	if err != nil {
		var ge *ports.GoogleError
		switch {
		case errors.Is(err, ports.ErrUnreachable):
			return domain.TrialReport{Result: domain.TrialUnreachable}
		case errors.As(err, &ge) && (ge.Code == "invalid_client" || ge.Code == "unauthorized_client"):
			return domain.TrialReport{Result: domain.TrialClient}
		}
		return domain.TrialReport{Result: domain.TrialFailed}
	}
	claims, err := domain.ParseIDToken(token.IDToken)
	if err != nil || claims.Validate(cred.ClientID, f.Nonce, s.now()) != nil {
		return domain.TrialReport{Result: domain.TrialFailed}
	}
	report := domain.TrialReport{Email: claims.Email}
	granted := strings.Fields(token.Scope)
	if !contains(granted, domain.ScopeDriveFile) || !contains(granted, domain.ScopeDriveAppdata) || token.AccessToken == "" {
		report.Result = domain.TrialScopeMissing
		return report
	}
	switch err := s.Drive.Probe(ctx, token.AccessToken); {
	case err == nil:
		report.Result = domain.TrialOK
	case errors.Is(err, ports.ErrDriveOff):
		report.Result = domain.TrialDriveOff
	case errors.Is(err, ports.ErrDriveScope):
		report.Result = domain.TrialScopeMissing
	case errors.Is(err, ports.ErrUnreachable):
		report.Result = domain.TrialUnreachable
	default:
		report.Result = domain.TrialFailed
	}
	return report
}

// FinishTrial answers the report of f, the trial flow this browser carries,
// or nil when it carries none. The second result reports whether the
// browser keeps the flow.
func (s *Service) FinishTrial(f *domain.Flow) (*domain.TrialReport, bool, error) {
	switch {
	case f == nil || !s.Live(*f):
		return nil, false, domain.Refuse(domain.CodeFlowExpired)
	case f.Purpose != domain.PurposeTrial:
		return nil, false, domain.Refuse(domain.CodeBadRequest)
	case f.Status == domain.StatusPending:
		return nil, true, domain.Refuse(domain.CodeFlowPending)
	case f.Report == nil:
		return nil, false, domain.Refuse(domain.CodeFlowFailed)
	}
	return f.Report, false, nil
}
