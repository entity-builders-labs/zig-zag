package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
	"github.com/juanobrach/zig-zag/go-be/internal/domain"
)

// Querier is the narrow slice of sqlcgen.Queries Service and OTPService
// need — defined here, the consumer, so tests can mock just this instead
// of the full generated query set.
type Querier interface {
	GetUserByProviderID(ctx context.Context, arg sqlcgen.GetUserByProviderIDParams) (sqlcgen.User, error)
	CreateUser(ctx context.Context, arg sqlcgen.CreateUserParams) (sqlcgen.User, error)
	UpdateUserProfile(ctx context.Context, arg sqlcgen.UpdateUserProfileParams) (sqlcgen.User, error)
	GetUserByID(ctx context.Context, id string) (sqlcgen.User, error)
	SetUserRefreshTokenHash(ctx context.Context, arg sqlcgen.SetUserRefreshTokenHashParams) error
	ClearUserRefreshTokenHash(ctx context.Context, id string) error
	GetLastEmailLoginCode(ctx context.Context, email string) (sqlcgen.EmailLoginCode, error)
	GetPendingEmailLoginCode(ctx context.Context, email string) (sqlcgen.EmailLoginCode, error)
	CreateEmailLoginCode(ctx context.Context, arg sqlcgen.CreateEmailLoginCodeParams) (sqlcgen.EmailLoginCode, error)
	IncrementEmailLoginCodeAttempts(ctx context.Context, id string) error
	ConsumeEmailLoginCode(ctx context.Context, id string) error
}

// GoogleVerifier verifies a Google ID token. See GoogleTokenVerifier for
// the real implementation.
type GoogleVerifier interface {
	Verify(ctx context.Context, idToken string) (VerifiedGoogleUser, error)
}

// AppleVerifier verifies an Apple identity token. See AppleTokenVerifier
// for the real implementation.
type AppleVerifier interface {
	Verify(ctx context.Context, identityToken string) (VerifiedAppleUser, error)
}

// AuthUser is the public user shape returned from API responses — mirrors
// AuthService's toAuthUser: deliberately narrower than domain.User (no
// provider/providerId/refreshTokenHash leaking out).
type AuthUser struct {
	ID        string  `json:"id"`
	Email     string  `json:"email"`
	Name      *string `json:"name"`
	AvatarURL *string `json:"avatarUrl"`
}

type AuthResult struct {
	AccessToken  string   `json:"accessToken"`
	RefreshToken string   `json:"refreshToken"`
	User         AuthUser `json:"user"`
}

// TokenConfig holds JWT signing parameters, mirroring auth.jwt.* in
// be/src/core/config/auth.config.ts.
type TokenConfig struct {
	AccessSecret  string
	AccessTTL     time.Duration
	RefreshSecret string
	RefreshTTL    time.Duration
}

// Service ports AuthService (be/src/modules/auth/services/auth.service.ts).
type Service struct {
	db     Querier
	google GoogleVerifier
	apple  AppleVerifier
	otp    *OTPService
	tokens TokenConfig
}

func NewService(db Querier, google GoogleVerifier, apple AppleVerifier, otp *OTPService, tokens TokenConfig) *Service {
	return &Service{db: db, google: google, apple: apple, otp: otp, tokens: tokens}
}

var ErrInvalidGoogleToken = errors.New("invalid Google token")
var ErrInvalidAppleToken = errors.New("invalid Apple token")

func (s *Service) LoginWithGoogle(ctx context.Context, idToken string) (AuthResult, error) {
	verified, err := s.google.Verify(ctx, idToken)
	if err != nil {
		return AuthResult{}, fmt.Errorf("%w: %w", ErrInvalidGoogleToken, err)
	}

	var name, avatarURL *string
	if verified.Name != "" {
		name = &verified.Name
	}
	if verified.AvatarURL != "" {
		avatarURL = &verified.AvatarURL
	}

	user, err := s.upsertUser(ctx, upsertParams{
		Provider:   domain.AuthProviderGoogle,
		ProviderID: verified.ProviderID,
		Email:      &verified.Email,
		Name:       name,
		AvatarURL:  avatarURL,
	})
	if err != nil {
		return AuthResult{}, err
	}
	return s.issueSession(ctx, user)
}

func (s *Service) LoginWithApple(ctx context.Context, identityToken string, fullName *string) (AuthResult, error) {
	verified, err := s.apple.Verify(ctx, identityToken)
	if err != nil {
		return AuthResult{}, fmt.Errorf("%w: %w", ErrInvalidAppleToken, err)
	}

	var email *string
	if verified.Email != "" {
		email = &verified.Email
	}

	user, err := s.upsertUser(ctx, upsertParams{
		Provider:   domain.AuthProviderApple,
		ProviderID: verified.ProviderID,
		Email:      email,
		Name:       fullName,
	})
	if err != nil {
		return AuthResult{}, err
	}
	return s.issueSession(ctx, user)
}

func (s *Service) RequestEmailCode(ctx context.Context, email string) (string, error) {
	return s.otp.RequestCode(ctx, email)
}

func (s *Service) LoginWithEmailCode(ctx context.Context, email, code string) (AuthResult, error) {
	verifiedEmail, err := s.otp.VerifyCode(ctx, email, code)
	if err != nil {
		return AuthResult{}, err
	}

	user, err := s.upsertUser(ctx, upsertParams{
		Provider:   domain.AuthProviderEmail,
		ProviderID: verifiedEmail,
		Email:      &verifiedEmail,
	})
	if err != nil {
		return AuthResult{}, err
	}
	return s.issueSession(ctx, user)
}

var ErrInvalidRefreshToken = errors.New("invalid refresh token")

func (s *Service) Refresh(ctx context.Context, refreshToken string) (AuthResult, error) {
	claims, err := VerifyToken(refreshToken, s.tokens.RefreshSecret)
	if err != nil {
		return AuthResult{}, ErrInvalidRefreshToken
	}

	user, err := s.db.GetUserByID(ctx, claims.Subject)
	if err != nil {
		return AuthResult{}, ErrInvalidRefreshToken
	}

	if user.RefreshTokenHash == nil || *user.RefreshTokenHash != hashToken(refreshToken) {
		return AuthResult{}, ErrInvalidRefreshToken
	}

	return s.issueSession(ctx, user)
}

func (s *Service) Logout(ctx context.Context, userID string) error {
	return s.db.ClearUserRefreshTokenHash(ctx, userID)
}

func (s *Service) GetByID(ctx context.Context, userID string) (AuthUser, error) {
	user, err := s.db.GetUserByID(ctx, userID)
	if err != nil {
		return AuthUser{}, fmt.Errorf("get user: %w", err)
	}
	return toAuthUser(user), nil
}

type upsertParams struct {
	Provider   domain.AuthProvider
	ProviderID string
	Email      *string
	Name       *string
	AvatarURL  *string
}

var ErrEmailRequiredForFirstSignIn = errors.New("email is required for first-time sign in")
var ErrEmailAlreadyInUse = errors.New("an account with this email already exists using a different sign-in method")

func (s *Service) upsertUser(ctx context.Context, p upsertParams) (sqlcgen.User, error) {
	existing, err := s.db.GetUserByProviderID(ctx, sqlcgen.GetUserByProviderIDParams{
		Provider:   sqlcgen.AuthProvider(p.Provider),
		ProviderId: p.ProviderID,
	})
	if err == nil {
		name := existing.Name
		if p.Name != nil {
			name = p.Name
		}
		avatarURL := existing.AvatarUrl
		if p.AvatarURL != nil {
			avatarURL = p.AvatarURL
		}
		return s.db.UpdateUserProfile(ctx, sqlcgen.UpdateUserProfileParams{ID: existing.ID, Name: name, AvatarUrl: avatarURL})
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return sqlcgen.User{}, fmt.Errorf("look up user: %w", err)
	}

	if p.Email == nil {
		return sqlcgen.User{}, ErrEmailRequiredForFirstSignIn
	}

	created, err := s.db.CreateUser(ctx, sqlcgen.CreateUserParams{
		ID:         newID(),
		Email:      *p.Email,
		Name:       p.Name,
		AvatarUrl:  p.AvatarURL,
		Provider:   sqlcgen.AuthProvider(p.Provider),
		ProviderId: p.ProviderID,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return sqlcgen.User{}, ErrEmailAlreadyInUse
		}
		return sqlcgen.User{}, fmt.Errorf("create user: %w", err)
	}
	return created, nil
}

func (s *Service) issueSession(ctx context.Context, user sqlcgen.User) (AuthResult, error) {
	accessToken, err := SignToken(user.ID, user.Email, s.tokens.AccessSecret, s.tokens.AccessTTL)
	if err != nil {
		return AuthResult{}, fmt.Errorf("sign access token: %w", err)
	}
	refreshToken, err := SignToken(user.ID, user.Email, s.tokens.RefreshSecret, s.tokens.RefreshTTL)
	if err != nil {
		return AuthResult{}, fmt.Errorf("sign refresh token: %w", err)
	}

	hash := hashToken(refreshToken)
	if err := s.db.SetUserRefreshTokenHash(ctx, sqlcgen.SetUserRefreshTokenHashParams{ID: user.ID, RefreshTokenHash: &hash}); err != nil {
		return AuthResult{}, fmt.Errorf("persist refresh token: %w", err)
	}

	return AuthResult{AccessToken: accessToken, RefreshToken: refreshToken, User: toAuthUser(user)}, nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func toAuthUser(u sqlcgen.User) AuthUser {
	return AuthUser{ID: u.ID, Email: u.Email, Name: u.Name, AvatarURL: u.AvatarUrl}
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// pgTimestamp lives here rather than a shared util package — small enough,
// and only auth writes client-computed timestamps today (other modules
// that need this can get their own copy, or this can move once a second
// caller exists — no premature shared package for one line).
//
// "timestamp" (no time zone) columns in this schema store UTC wall-clock
// numbers (confirmed against Postgres's own now(), which is UTC in this
// deployment) — t.UTC() is required here, not optional. Without it, a
// local-zone time.Time (e.g. from time.Now() outside UTC) gets its local
// wall-clock digits written verbatim, which silently shifts every stored
// instant by the zone offset — e.g. an email OTP's expiresAt landing hours
// in the past the moment it's written, making every code look expired
// immediately regardless of its actual TTL.
func pgTimestamp(t time.Time) pgtype.Timestamp {
	return pgtype.Timestamp{Time: t.UTC(), Valid: true}
}
