import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../../core/database/prisma.service';
import { MailerService } from './mailer.service';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function generateCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

@Injectable()
export class EmailOtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly mailerService: MailerService,
  ) {}

  /** Returns the plaintext code so callers can expose it in non-production responses (e.g. E2E tests, since there's no real SMTP inbox to read from). */
  async requestCode(rawEmail: string): Promise<string> {
    const email = normalizeEmail(rawEmail);
    const cooldownSeconds = this.configService.get<number>(
      'auth.emailOtp.resendCooldownSeconds',
    );

    const lastCode = await this.prisma.emailLoginCode.findFirst({
      where: { email },
      orderBy: { createdAt: 'desc' },
    });

    if (lastCode) {
      const secondsSinceLast =
        (Date.now() - lastCode.createdAt.getTime()) / 1000;
      if (secondsSinceLast < cooldownSeconds) {
        throw new BadRequestException(
          `Esperá ${Math.ceil(cooldownSeconds - secondsSinceLast)} segundos antes de pedir otro código.`,
        );
      }
    }

    const code = generateCode();
    const ttlMinutes = this.configService.get<number>(
      'auth.emailOtp.codeTtlMinutes',
    );

    await this.prisma.emailLoginCode.create({
      data: {
        email,
        codeHash: hashCode(code),
        expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      },
    });

    await this.mailerService.sendLoginCode(email, code);
    return code;
  }

  /** Verifies the code and returns the normalized email on success. */
  async verifyCode(rawEmail: string, code: string): Promise<string> {
    const email = normalizeEmail(rawEmail);
    const maxAttempts = this.configService.get<number>(
      'auth.emailOtp.maxAttempts',
    );

    const pending = await this.prisma.emailLoginCode.findFirst({
      where: { email, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!pending || pending.expiresAt < new Date()) {
      throw new UnauthorizedException('Código inválido o vencido.');
    }

    if (pending.attempts >= maxAttempts) {
      throw new UnauthorizedException(
        'Superaste el máximo de intentos, pedí un nuevo código.',
      );
    }

    if (pending.codeHash !== hashCode(code)) {
      await this.prisma.emailLoginCode.update({
        where: { id: pending.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Código inválido o vencido.');
    }

    await this.prisma.emailLoginCode.update({
      where: { id: pending.id },
      data: { consumedAt: new Date() },
    });

    return email;
  }
}
