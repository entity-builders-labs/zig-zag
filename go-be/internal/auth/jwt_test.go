package auth_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/auth"
)

func TestSignAndVerifyToken(t *testing.T) {
	tests := []struct {
		name       string
		userID     string
		email      string
		secret     string
		ttl        time.Duration
		verifyWith string // secret used to verify; defaults to secret if empty
		wantErr    bool
	}{
		{
			name:   "valid token round-trips",
			userID: "user-1",
			email:  "person@example.com",
			secret: "access-secret",
			ttl:    time.Hour,
		},
		{
			name:       "wrong secret is rejected",
			userID:     "user-1",
			email:      "person@example.com",
			secret:     "access-secret",
			ttl:        time.Hour,
			verifyWith: "different-secret",
			wantErr:    true,
		},
		{
			name:    "expired token is rejected",
			userID:  "user-1",
			email:   "person@example.com",
			secret:  "access-secret",
			ttl:     -time.Hour,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			token, err := auth.SignToken(tt.userID, tt.email, tt.secret, tt.ttl)
			require.NoError(t, err)

			verifySecret := tt.verifyWith
			if verifySecret == "" {
				verifySecret = tt.secret
			}

			claims, err := auth.VerifyToken(token, verifySecret)
			if tt.wantErr {
				require.ErrorIs(t, err, auth.ErrInvalidToken)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tt.userID, claims.Subject)
			require.Equal(t, tt.email, claims.Email)
		})
	}
}

func TestVerifyToken_RejectsUnsignedToken(t *testing.T) {
	// alg=none token, no signature — a classic JWT library vulnerability
	// class if not rejected. golang-jwt requires the caller's keyfunc to
	// accept the algorithm; VerifyToken's keyfunc only accepts HMAC.
	const noneAlgToken = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJhdHRhY2tlciJ9."

	_, err := auth.VerifyToken(noneAlgToken, "access-secret")
	if err == nil {
		t.Fatal("expected alg=none token to be rejected, got nil error")
	}
}
