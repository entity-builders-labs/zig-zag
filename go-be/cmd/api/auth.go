package main

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	appauth "github.com/juanobrach/zig-zag/go-be/internal/auth"
	"github.com/juanobrach/zig-zag/go-be/internal/config"
	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
)

// unavailableVerifierErr lets the server boot even if fetching a provider's
// JWKS fails at startup (no network, provider outage) — that specific
// login method just errors clearly at request time instead of taking the
// whole process down over a transient external dependency.
type unavailableVerifierErr struct{ provider string }

func (e unavailableVerifierErr) Error() string {
	return fmt.Sprintf("%s sign-in is unavailable: failed to load its public keys at startup", e.provider)
}

type unavailableGoogleVerifier struct{ err error }

func (u unavailableGoogleVerifier) Verify(context.Context, string) (appauth.VerifiedGoogleUser, error) {
	return appauth.VerifiedGoogleUser{}, u.err
}

type unavailableAppleVerifier struct{ err error }

func (u unavailableAppleVerifier) Verify(context.Context, string) (appauth.VerifiedAppleUser, error) {
	return appauth.VerifiedAppleUser{}, u.err
}

func wireAuth(ctx context.Context, cfg *config.Config, queries *sqlcgen.Queries) *appauth.Handlers {
	var google appauth.GoogleVerifier
	if v, err := appauth.NewGoogleTokenVerifier(ctx, cfg.Auth.GoogleClientIDs); err != nil {
		slog.Warn("Google token verifier unavailable, /auth/google will error until the process restarts", "error", err)
		google = unavailableGoogleVerifier{err: unavailableVerifierErr{provider: "Google"}}
	} else {
		google = v
	}

	var apple appauth.AppleVerifier
	if v, err := appauth.NewAppleTokenVerifier(ctx, cfg.Auth.AppleClientIDs); err != nil {
		slog.Warn("Apple token verifier unavailable, /auth/apple will error until the process restarts", "error", err)
		apple = unavailableAppleVerifier{err: unavailableVerifierErr{provider: "Apple"}}
	} else {
		apple = v
	}

	mailer := appauth.NewSMTPMailer(appauth.SMTPConfig{
		Host:         cfg.Auth.SMTPHost,
		Port:         cfg.Auth.SMTPPort,
		User:         cfg.Auth.SMTPUser,
		Pass:         cfg.Auth.SMTPPass,
		From:         cfg.Auth.SMTPFrom,
		IsProduction: cfg.App.IsProduction(),
	})

	otp := appauth.NewOTPService(queries, mailer, appauth.OTPConfig{
		TTL:            time.Duration(cfg.Auth.EmailOTPTTLMinutes) * time.Minute,
		MaxAttempts:    cfg.Auth.EmailOTPMaxAttempts,
		ResendCooldown: time.Duration(cfg.Auth.EmailOTPResendCooldown) * time.Second,
	})

	accessTTL, err := appauth.ParseExpiresIn(cfg.Auth.JWTAccessExpiresIn)
	if err != nil {
		slog.Warn("invalid JWT_ACCESS_EXPIRES_IN, falling back to 15m", "value", cfg.Auth.JWTAccessExpiresIn, "error", err)
		accessTTL = 15 * time.Minute
	}
	refreshTTL, err := appauth.ParseExpiresIn(cfg.Auth.JWTRefreshExpiresIn)
	if err != nil {
		slog.Warn("invalid JWT_REFRESH_EXPIRES_IN, falling back to 30d", "value", cfg.Auth.JWTRefreshExpiresIn, "error", err)
		refreshTTL = 30 * 24 * time.Hour
	}

	svc := appauth.NewService(queries, google, apple, otp, appauth.TokenConfig{
		AccessSecret:  cfg.Auth.JWTAccessSecret,
		AccessTTL:     accessTTL,
		RefreshSecret: cfg.Auth.JWTRefreshSecret,
		RefreshTTL:    refreshTTL,
	})

	return appauth.NewHandlers(svc, cfg.App.IsProduction())
}
