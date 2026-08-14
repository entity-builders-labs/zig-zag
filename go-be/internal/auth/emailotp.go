package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
)

// Mailer sends the login code email. See SMTPMailer for the real
// implementation.
type Mailer interface {
	SendLoginCode(ctx context.Context, email, code string) error
}

// OTPConfig mirrors AuthConfig.emailOtp in be/src/core/config/auth.config.ts.
type OTPConfig struct {
	TTL            time.Duration
	MaxAttempts    int
	ResendCooldown time.Duration
}

// OTPService ports EmailOtpService (be/src/modules/auth/services/email-otp.service.ts).
type OTPService struct {
	db     Querier
	mailer Mailer
	cfg    OTPConfig
}

func NewOTPService(db Querier, mailer Mailer, cfg OTPConfig) *OTPService {
	return &OTPService{db: db, mailer: mailer, cfg: cfg}
}

var ErrResendTooSoon = errors.New("resend cooldown not elapsed")

// RequestCode returns the plaintext code so callers can expose it in
// non-production responses (E2E tests, since there's no real SMTP inbox to
// read from) — same contract as EmailOtpService.requestCode.
func (s *OTPService) RequestCode(ctx context.Context, rawEmail string) (string, error) {
	email := normalizeEmail(rawEmail)

	last, err := s.db.GetLastEmailLoginCode(ctx, email)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("look up last code: %w", err)
	}
	if err == nil {
		elapsed := time.Since(last.CreatedAt.Time)
		if elapsed < s.cfg.ResendCooldown {
			return "", fmt.Errorf("%w: wait %.0f more seconds", ErrResendTooSoon, (s.cfg.ResendCooldown - elapsed).Seconds())
		}
	}

	code, err := generateCode()
	if err != nil {
		return "", fmt.Errorf("generate code: %w", err)
	}

	if _, err := s.db.CreateEmailLoginCode(ctx, sqlcgen.CreateEmailLoginCodeParams{
		ID:        newID(),
		Email:     email,
		CodeHash:  hashCode(code),
		ExpiresAt: pgTimestamp(time.Now().Add(s.cfg.TTL)),
	}); err != nil {
		return "", fmt.Errorf("create login code: %w", err)
	}

	if err := s.mailer.SendLoginCode(ctx, email, code); err != nil {
		return "", fmt.Errorf("send login code email: %w", err)
	}

	return code, nil
}

var ErrInvalidOrExpiredCode = errors.New("invalid or expired code")
var ErrTooManyAttempts = errors.New("too many attempts, request a new code")

// VerifyCode verifies the code and returns the normalized email on success.
func (s *OTPService) VerifyCode(ctx context.Context, rawEmail, code string) (string, error) {
	email := normalizeEmail(rawEmail)

	pending, err := s.db.GetPendingEmailLoginCode(ctx, email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrInvalidOrExpiredCode
		}
		return "", fmt.Errorf("look up pending code: %w", err)
	}
	if pending.ExpiresAt.Time.Before(time.Now()) {
		return "", ErrInvalidOrExpiredCode
	}

	if int(pending.Attempts) >= s.cfg.MaxAttempts {
		return "", ErrTooManyAttempts
	}

	if pending.CodeHash != hashCode(code) {
		_ = s.db.IncrementEmailLoginCodeAttempts(ctx, pending.ID)
		return "", ErrInvalidOrExpiredCode
	}

	if err := s.db.ConsumeEmailLoginCode(ctx, pending.ID); err != nil {
		return "", fmt.Errorf("consume code: %w", err)
	}

	return email, nil
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// generateCode mirrors crypto.randomInt(0, 1_000_000) zero-padded to 6
// digits, using crypto/rand rather than math/rand since this is a
// security-sensitive one-time code.
func generateCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func hashCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}
