import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    const smtp = this.configService.get('auth.emailOtp.smtp');
    this.from = smtp.from;
    // No SMTP_HOST is the expected dev/test state — /auth/email/request-code
    // already returns devCode outside production, so there's nothing to send
    // to. Building a transporter against an empty host would just hang/error
    // on every request instead of failing fast and readably.
    this.transporter = smtp.host
      ? nodemailer.createTransport({
          host: smtp.host,
          port: smtp.port,
          secure: smtp.secure,
          auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
        })
      : null;
  }

  async sendLoginCode(email: string, code: string): Promise<void> {
    // The single .env at the repo root feeds local dev and production alike
    // (see CLAUDE.md), so SMTP_HOST being set doesn't mean it's safe to send
    // — local/CI runs the same real production credentials. requestCode()
    // already returns devCode outside production for exactly this reason;
    // guard the real send the same way, regardless of what's configured.
    if (process.env.NODE_ENV !== 'production') {
      this.logger.warn(
        `NODE_ENV is not 'production' — skipping the real login code email to ${email} (devCode is returned in the API response instead).`,
      );
      return;
    }

    if (!this.transporter) {
      this.logger.warn(
        `SMTP not configured — skipping login code email to ${email}`,
      );
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject: `${code} es tu código de acceso a Zig-Zag`,
        text: `Tu código de acceso es ${code}. Vence en unos minutos. Si no lo pediste vos, podés ignorar este mensaje.`,
        html: `<p>Tu código de acceso es <strong style="font-size:20px">${code}</strong>.</p><p>Vence en unos minutos. Si no lo pediste vos, podés ignorar este mensaje.</p>`,
      });
    } catch (error) {
      this.logger.error(`Failed to send login code to ${email}`, error.stack);
      throw error;
    }
  }
}
