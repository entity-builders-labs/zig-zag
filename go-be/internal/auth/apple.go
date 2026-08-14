package auth

import (
	"context"
	"fmt"
)

type VerifiedAppleUser struct {
	ProviderID string
	Email      string
}

// AppleTokenVerifier ports AppleTokenService
// (be/src/modules/auth/services/apple-token.service.ts) — same JWKS
// verification mechanism as GoogleTokenVerifier, no canonical Go
// equivalent to the apple-signin-auth npm package exists either.
type AppleTokenVerifier struct {
	verifier *oidcVerifier
}

func NewAppleTokenVerifier(ctx context.Context, clientIDs []string) (*AppleTokenVerifier, error) {
	v, err := newOIDCVerifier(ctx, "https://appleid.apple.com/auth/keys",
		[]string{"https://appleid.apple.com"}, clientIDs)
	if err != nil {
		return nil, err
	}
	return &AppleTokenVerifier{verifier: v}, nil
}

func (a *AppleTokenVerifier) Verify(ctx context.Context, identityToken string) (VerifiedAppleUser, error) {
	claims, err := a.verifier.verify(identityToken)
	if err != nil {
		return VerifiedAppleUser{}, fmt.Errorf("invalid Apple token: %w", err)
	}

	sub, _ := claims["sub"].(string)
	if sub == "" {
		return VerifiedAppleUser{}, fmt.Errorf("invalid Apple token: missing sub")
	}
	email, _ := claims["email"].(string)

	return VerifiedAppleUser{ProviderID: sub, Email: email}, nil
}
