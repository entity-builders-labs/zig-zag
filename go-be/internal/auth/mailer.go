package auth

import (
	"context"
	"fmt"
	"net/smtp"
)

// SMTPConfig mirrors auth.emailOtp.smtp in be/src/core/config/auth.config.ts.
type SMTPConfig struct {
	Host         string
	Port         int
	User         string
	Pass         string
	From         string
	IsProduction bool
}

// SMTPMailer ports MailerService (be/src/modules/auth/services/mailer.service.ts).
type SMTPMailer struct {
	cfg SMTPConfig
}

func NewSMTPMailer(cfg SMTPConfig) *SMTPMailer {
	return &SMTPMailer{cfg: cfg}
}

func (m *SMTPMailer) SendLoginCode(ctx context.Context, email, code string) error {
	// The single .env at the repo root feeds local dev and production alike,
	// so SMTP_HOST being set doesn't mean it's safe to send — local/CI runs
	// the same real production credentials. RequestCode already returns
	// devCode outside production for exactly this reason; guard the real
	// send the same way, regardless of what's configured.
	if !m.cfg.IsProduction {
		return nil
	}
	if m.cfg.Host == "" {
		return nil
	}

	addr := fmt.Sprintf("%s:%d", m.cfg.Host, m.cfg.Port)
	var auth smtp.Auth
	if m.cfg.User != "" {
		auth = smtp.PlainAuth("", m.cfg.User, m.cfg.Pass, m.cfg.Host)
	}

	subject := fmt.Sprintf("%s es tu codigo de acceso a Zig-Zag", code)
	body := fmt.Sprintf(
		"Tu codigo de acceso es %s. Vence en unos minutos. Si no lo pediste vos, podes ignorar este mensaje.",
		code,
	)
	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s\r\n",
		m.cfg.From, email, subject, body)

	return smtp.SendMail(addr, auth, m.cfg.From, []string{email}, []byte(msg))
}
