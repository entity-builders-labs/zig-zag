import { registerAs } from '@nestjs/config';

export interface AuthConfig {
  jwt: {
    accessSecret: string;
    accessExpiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
  };
  // Accepted audiences for token verification. Multiple ids are needed
  // because Google issues a different client id per platform (web/iOS/Android).
  googleClientIds: string[];
  appleClientIds: string[];
  allowDevAppleAuthMock: boolean;
  emailOtp: {
    codeTtlMinutes: number;
    maxAttempts: number;
    resendCooldownSeconds: number;
    smtp: {
      host?: string;
      port: number;
      secure: boolean;
      user?: string;
      pass?: string;
      from: string;
    };
  };
}

export default registerAs('auth', (): AuthConfig => {
  const isProduction = process.env.NODE_ENV === 'production';
  const accessSecret =
    process.env.JWT_ACCESS_SECRET ||
    (isProduction ? undefined : 'dev-insecure-access-secret');
  const refreshSecret =
    process.env.JWT_REFRESH_SECRET ||
    (isProduction ? undefined : 'dev-insecure-refresh-secret');

  if (!accessSecret || !refreshSecret) {
    throw new Error(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in production',
    );
  }

  return {
    jwt: {
      accessSecret,
      accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
      refreshSecret,
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    },
    googleClientIds: (process.env.GOOGLE_CLIENT_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
    appleClientIds: (
      process.env.APPLE_CLIENT_IDS ||
      'com.entitiybuilders.zig-zag,com.javieriseruk.zigzag'
    )
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
    allowDevAppleAuthMock:
      !isProduction && process.env.ALLOW_DEV_APPLE_AUTH_MOCK !== 'false',
    emailOtp: {
      codeTtlMinutes: process.env.EMAIL_OTP_TTL_MINUTES
        ? parseInt(process.env.EMAIL_OTP_TTL_MINUTES, 10)
        : 10,
      maxAttempts: process.env.EMAIL_OTP_MAX_ATTEMPTS
        ? parseInt(process.env.EMAIL_OTP_MAX_ATTEMPTS, 10)
        : 5,
      resendCooldownSeconds: process.env.EMAIL_OTP_RESEND_COOLDOWN_SECONDS
        ? parseInt(process.env.EMAIL_OTP_RESEND_COOLDOWN_SECONDS, 10)
        : 60,
      smtp: {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587,
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
        from: process.env.SMTP_FROM || 'Zig-Zag <no-reply@zigzag.app>',
      },
    },
  };
});
