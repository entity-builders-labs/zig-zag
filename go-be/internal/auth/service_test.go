package auth_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/auth"
	"github.com/juanobrach/zig-zag/go-be/internal/auth/mocks"
	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
)

func testTokenConfig() auth.TokenConfig {
	return auth.TokenConfig{
		AccessSecret:  "access-secret",
		AccessTTL:     15 * time.Minute,
		RefreshSecret: "refresh-secret",
		RefreshTTL:    30 * 24 * time.Hour,
	}
}

func newTestService(db auth.Querier, google auth.GoogleVerifier, apple auth.AppleVerifier) *auth.Service {
	otp := auth.NewOTPService(nil, nil, auth.OTPConfig{})
	return auth.NewService(db, google, apple, otp, testTokenConfig())
}

func TestService_LoginWithGoogle(t *testing.T) {
	tests := []struct {
		name       string
		setupMocks func(db *mocks.Querier, google *mocks.GoogleVerifier)
		wantErr    error
	}{
		{
			name: "new user: creates an account",
			setupMocks: func(db *mocks.Querier, google *mocks.GoogleVerifier) {
				google.EXPECT().Verify(mock.Anything, "id-token").Return(auth.VerifiedGoogleUser{
					ProviderID: "g-1", Email: "person@example.com", Name: "Person",
				}, nil)
				db.EXPECT().GetUserByProviderID(mock.Anything, sqlcgen.GetUserByProviderIDParams{
					Provider: sqlcgen.AuthProviderGOOGLE, ProviderId: "g-1",
				}).Return(sqlcgen.User{}, pgx.ErrNoRows)
				db.EXPECT().CreateUser(mock.Anything, mock.MatchedBy(func(p sqlcgen.CreateUserParams) bool {
					return p.Email == "person@example.com" && p.ProviderId == "g-1" && p.Provider == sqlcgen.AuthProviderGOOGLE
				})).Return(sqlcgen.User{ID: "u-1", Email: "person@example.com"}, nil)
				db.EXPECT().SetUserRefreshTokenHash(mock.Anything, mock.MatchedBy(func(p sqlcgen.SetUserRefreshTokenHashParams) bool {
					return p.ID == "u-1"
				})).Return(nil)
			},
		},
		{
			name: "existing user: updates profile fields, no create",
			setupMocks: func(db *mocks.Querier, google *mocks.GoogleVerifier) {
				google.EXPECT().Verify(mock.Anything, "id-token").Return(auth.VerifiedGoogleUser{
					ProviderID: "g-1", Email: "person@example.com", Name: "New Name",
				}, nil)
				db.EXPECT().GetUserByProviderID(mock.Anything, mock.Anything).
					Return(sqlcgen.User{ID: "u-1", Email: "person@example.com"}, nil)
				db.EXPECT().UpdateUserProfile(mock.Anything, mock.MatchedBy(func(p sqlcgen.UpdateUserProfileParams) bool {
					return p.ID == "u-1" && p.Name != nil && *p.Name == "New Name"
				})).Return(sqlcgen.User{ID: "u-1", Email: "person@example.com"}, nil)
				db.EXPECT().SetUserRefreshTokenHash(mock.Anything, mock.Anything).Return(nil)
			},
		},
		{
			name: "invalid google token propagates without touching the DB",
			setupMocks: func(db *mocks.Querier, google *mocks.GoogleVerifier) {
				google.EXPECT().Verify(mock.Anything, "id-token").Return(auth.VerifiedGoogleUser{}, errors.New("token expired"))
			},
			wantErr: auth.ErrInvalidGoogleToken,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := mocks.NewQuerier(t)
			google := mocks.NewGoogleVerifier(t)
			tt.setupMocks(db, google)

			svc := newTestService(db, google, mocks.NewAppleVerifier(t))
			result, err := svc.LoginWithGoogle(context.Background(), "id-token")

			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			require.NotEmpty(t, result.AccessToken)
			require.NotEmpty(t, result.RefreshToken)
			require.Equal(t, "person@example.com", result.User.Email)
		})
	}
}

func TestService_LoginWithApple_RequiresEmailOnFirstSignIn(t *testing.T) {
	db := mocks.NewQuerier(t)
	apple := mocks.NewAppleVerifier(t)

	apple.EXPECT().Verify(mock.Anything, "identity-token").Return(auth.VerifiedAppleUser{ProviderID: "a-1"}, nil) // no email: only sent on first authorization by Apple
	db.EXPECT().GetUserByProviderID(mock.Anything, sqlcgen.GetUserByProviderIDParams{
		Provider: sqlcgen.AuthProviderAPPLE, ProviderId: "a-1",
	}).Return(sqlcgen.User{}, pgx.ErrNoRows)

	svc := newTestService(db, mocks.NewGoogleVerifier(t), apple)
	_, err := svc.LoginWithApple(context.Background(), "identity-token", nil)
	require.ErrorIs(t, err, auth.ErrEmailRequiredForFirstSignIn)
}

func TestService_Refresh(t *testing.T) {
	tokens := testTokenConfig()
	validRefresh, err := auth.SignToken("u-1", "person@example.com", tokens.RefreshSecret, tokens.RefreshTTL)
	require.NoError(t, err)

	tests := []struct {
		name         string
		refreshToken string
		setupMocks   func(db *mocks.Querier)
		wantErr      error
	}{
		{
			name:         "garbage token is rejected before any DB call",
			refreshToken: "not-a-jwt",
			setupMocks:   func(db *mocks.Querier) {},
			wantErr:      auth.ErrInvalidRefreshToken,
		},
		{
			name:         "valid signature but hash mismatch (e.g. already rotated) is rejected",
			refreshToken: validRefresh,
			setupMocks: func(db *mocks.Querier) {
				otherHash := "not-the-real-hash"
				db.EXPECT().GetUserByID(mock.Anything, "u-1").Return(sqlcgen.User{
					ID: "u-1", Email: "person@example.com", RefreshTokenHash: &otherHash,
				}, nil)
			},
			wantErr: auth.ErrInvalidRefreshToken,
		},
		{
			name:         "valid token and matching hash issues a new session",
			refreshToken: validRefresh,
			setupMocks: func(db *mocks.Querier) {
				db.EXPECT().GetUserByID(mock.Anything, "u-1").RunAndReturn(func(ctx context.Context, id string) (sqlcgen.User, error) {
					// Hash must match sha256(validRefresh) exactly — computed via
					// the same algorithm service.go uses, not hardcoded, so this
					// doesn't silently drift if the hashing scheme ever changes.
					return sqlcgen.User{ID: "u-1", Email: "person@example.com", RefreshTokenHash: sha256HexPtr(validRefresh)}, nil
				})
				db.EXPECT().SetUserRefreshTokenHash(mock.Anything, mock.MatchedBy(func(p sqlcgen.SetUserRefreshTokenHashParams) bool {
					return p.ID == "u-1"
				})).Return(nil)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := mocks.NewQuerier(t)
			tt.setupMocks(db)

			svc := newTestService(db, mocks.NewGoogleVerifier(t), mocks.NewAppleVerifier(t))
			result, err := svc.Refresh(context.Background(), tt.refreshToken)

			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			require.NotEmpty(t, result.AccessToken)
		})
	}
}

func TestService_Logout(t *testing.T) {
	db := mocks.NewQuerier(t)
	db.EXPECT().ClearUserRefreshTokenHash(mock.Anything, "u-1").Return(nil)

	svc := newTestService(db, mocks.NewGoogleVerifier(t), mocks.NewAppleVerifier(t))
	require.NoError(t, svc.Logout(context.Background(), "u-1"))
}

func TestService_GetByID(t *testing.T) {
	db := mocks.NewQuerier(t)
	db.EXPECT().GetUserByID(mock.Anything, "u-1").Return(sqlcgen.User{ID: "u-1", Email: "person@example.com"}, nil)

	svc := newTestService(db, mocks.NewGoogleVerifier(t), mocks.NewAppleVerifier(t))
	user, err := svc.GetByID(context.Background(), "u-1")
	require.NoError(t, err)
	require.Equal(t, "person@example.com", user.Email)
}

// sha256HexPtr duplicates service.go's unexported hashToken (SHA-256 hex)
// so this test doesn't need to export a test-only helper from production code.
func sha256HexPtr(token string) *string {
	sum := sha256.Sum256([]byte(token))
	h := hex.EncodeToString(sum[:])
	return &h
}
