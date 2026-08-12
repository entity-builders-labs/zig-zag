import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    const smtp = this.configService.get('auth.emailOtp.smtp');
    this.from = smtp.from;
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
  }

  async sendLoginCode(email: string, code: string): Promise<void> {
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
