package auth_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/auth"
	"github.com/juanobrach/zig-zag/go-be/internal/db"
	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
)

// TestOTPService_ExpiresAtSurvivesRealDBRoundTrip is a regression test for a
// real bug caught only by hitting the actual database (mocked unit tests
// can't catch it — there's no serialization boundary to cross): "timestamp"
// (no time zone) columns in this schema store UTC wall-clock numbers, but
// pgTimestamp originally wrote local-zone wall-clock digits unconverted,
// silently shifting every stored instant by the machine's UTC offset. In a
// zone behind UTC that made a freshly-created code's expiresAt land hours
// in the past the moment it was written — every code looked expired
// immediately regardless of its actual TTL. See pgTimestamp's doc comment
// in service.go.
func TestOTPService_ExpiresAtSurvivesRealDBRoundTrip(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@localhost:5432/zigzag"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pool, err := db.NewPool(ctx, url)
	if err != nil {
		t.Skipf("no reachable Postgres for integration test: %v", err)
	}
	defer pool.Close()

	queries := sqlcgen.New(pool)
	otp := auth.NewOTPService(queries, noopMailer{}, auth.OTPConfig{
		TTL:            10 * time.Minute,
		MaxAttempts:    5,
		ResendCooldown: time.Millisecond, // keep repeated test runs from tripping the cooldown
	})

	email := "regression-utc-test@example.com"
	code, err := otp.RequestCode(ctx, email)
	require.NoError(t, err)

	// The regression: immediately verifying a code that was just created
	// with a 10-minute TTL must succeed — if expiresAt were written in the
	// machine's local zone instead of UTC, this would fail with
	// ErrInvalidOrExpiredCode everywhere except UTC+0 machines.
	gotEmail, err := otp.VerifyCode(ctx, email, code)
	require.NoError(t, err)
	require.Equal(t, email, gotEmail)
}

type noopMailer struct{}

func (noopMailer) SendLoginCode(ctx context.Context, email, code string) error { return nil }
