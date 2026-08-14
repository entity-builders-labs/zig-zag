package auth_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/auth"
	"github.com/juanobrach/zig-zag/go-be/internal/auth/mocks"
	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
)

func pgTime(t time.Time) pgtype.Timestamp { return pgtype.Timestamp{Time: t, Valid: true} }

func TestOTPService_RequestCode(t *testing.T) {
	cfg := auth.OTPConfig{TTL: 10 * time.Minute, MaxAttempts: 5, ResendCooldown: 60 * time.Second}

	tests := []struct {
		name       string
		setupMocks func(db *mocks.Querier, mailer *mocks.Mailer)
		wantErr    error
	}{
		{
			name: "no prior code: creates and emails a new one",
			setupMocks: func(db *mocks.Querier, mailer *mocks.Mailer) {
				db.EXPECT().GetLastEmailLoginCode(mock.Anything, "person@example.com").
					Return(sqlcgen.EmailLoginCode{}, pgx.ErrNoRows)
				db.EXPECT().CreateEmailLoginCode(mock.Anything, mock.MatchedBy(func(p sqlcgen.CreateEmailLoginCodeParams) bool {
					return p.Email == "person@example.com" && len(p.CodeHash) == 64
				})).Return(sqlcgen.EmailLoginCode{}, nil)
				mailer.EXPECT().SendLoginCode(mock.Anything, "person@example.com", mock.Anything).Return(nil)
			},
		},
		{
			name: "prior code within cooldown window is rejected",
			setupMocks: func(db *mocks.Querier, mailer *mocks.Mailer) {
				db.EXPECT().GetLastEmailLoginCode(mock.Anything, "person@example.com").
					Return(sqlcgen.EmailLoginCode{CreatedAt: pgTime(time.Now().Add(-10 * time.Second))}, nil)
			},
			wantErr: auth.ErrResendTooSoon,
		},
		{
			name: "prior code past cooldown allows a resend",
			setupMocks: func(db *mocks.Querier, mailer *mocks.Mailer) {
				db.EXPECT().GetLastEmailLoginCode(mock.Anything, "person@example.com").
					Return(sqlcgen.EmailLoginCode{CreatedAt: pgTime(time.Now().Add(-90 * time.Second))}, nil)
				db.EXPECT().CreateEmailLoginCode(mock.Anything, mock.Anything).Return(sqlcgen.EmailLoginCode{}, nil)
				mailer.EXPECT().SendLoginCode(mock.Anything, "person@example.com", mock.Anything).Return(nil)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := mocks.NewQuerier(t)
			mailer := mocks.NewMailer(t)
			tt.setupMocks(db, mailer)

			svc := auth.NewOTPService(db, mailer, cfg)
			code, err := svc.RequestCode(context.Background(), "  Person@Example.com  ")

			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			require.Len(t, code, 6)
		})
	}
}

func TestOTPService_VerifyCode(t *testing.T) {
	cfg := auth.OTPConfig{TTL: 10 * time.Minute, MaxAttempts: 3, ResendCooldown: 60 * time.Second}

	tests := []struct {
		name       string
		code       string
		setupMocks func(db *mocks.Querier)
		wantEmail  string
		wantErr    error
	}{
		{
			name: "no pending code",
			code: "123456",
			setupMocks: func(db *mocks.Querier) {
				db.EXPECT().GetPendingEmailLoginCode(mock.Anything, "person@example.com").
					Return(sqlcgen.EmailLoginCode{}, pgx.ErrNoRows)
			},
			wantErr: auth.ErrInvalidOrExpiredCode,
		},
		{
			name: "expired code",
			code: "123456",
			setupMocks: func(db *mocks.Querier) {
				db.EXPECT().GetPendingEmailLoginCode(mock.Anything, "person@example.com").Return(sqlcgen.EmailLoginCode{
					ID:        "code-1",
					ExpiresAt: pgTime(time.Now().Add(-time.Minute)),
				}, nil)
			},
			wantErr: auth.ErrInvalidOrExpiredCode,
		},
		{
			name: "max attempts already reached",
			code: "123456",
			setupMocks: func(db *mocks.Querier) {
				db.EXPECT().GetPendingEmailLoginCode(mock.Anything, "person@example.com").Return(sqlcgen.EmailLoginCode{
					ID:        "code-1",
					ExpiresAt: pgTime(time.Now().Add(time.Minute)),
					Attempts:  3,
				}, nil)
			},
			wantErr: auth.ErrTooManyAttempts,
		},
		{
			name: "wrong code increments attempts and fails",
			code: "000000",
			setupMocks: func(db *mocks.Querier) {
				db.EXPECT().GetPendingEmailLoginCode(mock.Anything, "person@example.com").Return(sqlcgen.EmailLoginCode{
					ID:        "code-1",
					ExpiresAt: pgTime(time.Now().Add(time.Minute)),
					CodeHash:  hashCodeForTest("999999"),
				}, nil)
				db.EXPECT().IncrementEmailLoginCodeAttempts(mock.Anything, "code-1").Return(nil)
			},
			wantErr: auth.ErrInvalidOrExpiredCode,
		},
		{
			name: "correct code consumes it and returns the normalized email",
			code: "999999",
			setupMocks: func(db *mocks.Querier) {
				db.EXPECT().GetPendingEmailLoginCode(mock.Anything, "person@example.com").Return(sqlcgen.EmailLoginCode{
					ID:        "code-1",
					ExpiresAt: pgTime(time.Now().Add(time.Minute)),
					CodeHash:  hashCodeForTest("999999"),
				}, nil)
				db.EXPECT().ConsumeEmailLoginCode(mock.Anything, "code-1").Return(nil)
			},
			wantEmail: "person@example.com",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := mocks.NewQuerier(t)
			tt.setupMocks(db)

			svc := auth.NewOTPService(db, mocks.NewMailer(t), cfg)
			email, err := svc.VerifyCode(context.Background(), "Person@Example.com", tt.code)

			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tt.wantEmail, email)
		})
	}
}

// hashCodeForTest duplicates the package-private hashCode algorithm
// (SHA-256 hex) so table cases can set up a matching CodeHash fixture
// without exporting the real function purely for tests.
func hashCodeForTest(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}
