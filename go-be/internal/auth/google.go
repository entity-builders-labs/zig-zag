package auth

import (
	"context"
	"fmt"
)

type VerifiedGoogleUser struct {
	ProviderID string
	Email      string
	Name       string
	AvatarURL  string
}

// GoogleTokenVerifier ports GoogleTokenService
// (be/src/modules/auth/services/google-token.service.ts) via direct JWKS
// verification instead of the google-auth-library SDK — there's no single
// canonical Go equivalent, and this is the same mechanism that library
// uses internally (fetch Google's public keys, verify RS256 signature +
// issuer + audience).
type GoogleTokenVerifier struct {
	verifier *oidcVerifier
}

func NewGoogleTokenVerifier(ctx context.Context, clientIDs []string) (*GoogleTokenVerifier, error) {
	v, err := newOIDCVerifier(ctx, "https://www.googleapis.com/oauth2/v3/certs",
		[]string{"accounts.google.com", "https://accounts.google.com"}, clientIDs)
	if err != nil {
		return nil, err
	}
	return &GoogleTokenVerifier{verifier: v}, nil
}

func (g *GoogleTokenVerifier) Verify(ctx context.Context, idToken string) (VerifiedGoogleUser, error) {
	claims, err := g.verifier.verify(idToken)
	if err != nil {
		return VerifiedGoogleUser{}, fmt.Errorf("invalid Google token: %w", err)
	}

	sub, _ := claims["sub"].(string)
	email, _ := claims["email"].(string)
	if sub == "" || email == "" {
		return VerifiedGoogleUser{}, fmt.Errorf("invalid Google token: missing sub/email")
	}
	name, _ := claims["name"].(string)
	picture, _ := claims["picture"].(string)

	return VerifiedGoogleUser{ProviderID: sub, Email: email, Name: name, AvatarURL: picture}, nil
}
