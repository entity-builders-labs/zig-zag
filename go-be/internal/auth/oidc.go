package auth

import (
	"context"
	"fmt"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

// oidcVerifier does JWKS-based RS256 ID token verification — the mechanism
// both Google and Apple Sign-In use (fetch the provider's public keys,
// verify the token's signature, issuer, and audience), factored out once
// rather than duplicated between GoogleTokenVerifier and AppleTokenVerifier.
type oidcVerifier struct {
	kf        keyfunc.Keyfunc
	issuers   []string
	audiences []string
}

func newOIDCVerifier(ctx context.Context, jwksURL string, issuers, audiences []string) (*oidcVerifier, error) {
	kf, err := keyfunc.NewDefaultCtx(ctx, []string{jwksURL})
	if err != nil {
		return nil, fmt.Errorf("fetch JWKS from %s: %w", jwksURL, err)
	}
	return &oidcVerifier{kf: kf, issuers: issuers, audiences: audiences}, nil
}

func (v *oidcVerifier) verify(tokenString string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenString, v.kf.Keyfunc, jwt.WithValidMethods([]string{"RS256"}))
	if err != nil {
		return nil, fmt.Errorf("parse token: %w", err)
	}
	if !token.Valid {
		return nil, fmt.Errorf("token is not valid")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, fmt.Errorf("unexpected claims type")
	}

	iss, _ := claims["iss"].(string)
	if !contains(v.issuers, iss) {
		return nil, fmt.Errorf("unexpected issuer %q", iss)
	}

	// Fails closed: an empty configured audience list (GOOGLE_CLIENT_IDS /
	// APPLE_CLIENT_IDS unset) means nothing can match, so every token is
	// rejected rather than the check being silently skipped.
	if !audienceMatches(claims["aud"], v.audiences) {
		return nil, fmt.Errorf("unexpected audience")
	}

	return claims, nil
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

func audienceMatches(aud any, allowed []string) bool {
	switch v := aud.(type) {
	case string:
		return contains(allowed, v)
	case []any:
		for _, a := range v {
			if s, ok := a.(string); ok && contains(allowed, s) {
				return true
			}
		}
	}
	return false
}
