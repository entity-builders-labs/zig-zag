import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { EmailOtpService } from './email-otp.service';
import { PrismaService } from '../../../core/database/prisma.service';
import { MailerService } from './mailer.service';

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

describe('EmailOtpService', () => {
  let service: EmailOtpService;

  const mockPrismaService = {
    emailLoginCode: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockMailerService = {
    sendLoginCode: jest.fn(),
  };

  const configValues: Record<string, unknown> = {
    'auth.emailOtp.resendCooldownSeconds': 60,
    'auth.emailOtp.codeTtlMinutes': 10,
    'auth.emailOtp.maxAttempts': 5,
  };

  const mockConfigService = {
    get: jest.fn((key: string) => configValues[key]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailOtpService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: MailerService, useValue: mockMailerService },
      ],
    }).compile();

    service = module.get<EmailOtpService>(EmailOtpService);
    jest.clearAllMocks();
  });

  describe('requestCode', () => {
    it('creates a code and emails it when there is no prior code', async () => {
      mockPrismaService.emailLoginCode.findFirst.mockResolvedValue(null);
      mockPrismaService.emailLoginCode.create.mockResolvedValue({});

      const returnedCode = await service.requestCode('User@Example.com');

      expect(mockPrismaService.emailLoginCode.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'user@example.com' }),
        }),
      );
      expect(mockMailerService.sendLoginCode).toHaveBeenCalledTimes(1);
      const [emailArg, codeArg] = mockMailerService.sendLoginCode.mock.calls[0];
      expect(emailArg).toBe('user@example.com');
      expect(codeArg).toMatch(/^\d{6}$/);
      expect(returnedCode).toBe(codeArg);
    });

    it('rejects a new request within the resend cooldown', async () => {
      mockPrismaService.emailLoginCode.findFirst.mockResolvedValue({
        createdAt: new Date(),
      });

      await expect(service.requestCode('user@example.com')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrismaService.emailLoginCode.create).not.toHaveBeenCalled();
      expect(mockMailerService.sendLoginCode).not.toHaveBeenCalled();
    });

    it('allows a new request once the cooldown has passed', async () => {
      mockPrismaService.emailLoginCode.findFirst.mockResolvedValue({
        createdAt: new Date(Date.now() - 61_000),
      });
      mockPrismaService.emailLoginCode.create.mockResolvedValue({});

      await service.requestCode('user@example.com');

      expect(mockPrismaService.emailLoginCode.create).toHaveBeenCalled();
      expect(mockMailerService.sendLoginCode).toHaveBeenCalled();
    });
  });

  describe('verifyCode', () => {
    it('throws when there is no pending code for the email', async () => {
      mockPrismaService.emailLoginCode.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyCode('user@example.com', '123456'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws when the pending code is expired', async () => {
      mockPrismaService.emailLoginCode.findFirst.mockResolvedValue({
        id: 'code-1',
        attempts: 0,
        expiresAt: new Date(Date.now() - 1000),
        codeHash: hashCode('123456'),
      });

      await expect(
        service.verifyCode('user@example.com', '123456'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws without checking the code once max attempts is reached', async () => {
      mockPrismaService.emailLoginCode.findFirst.mockResolvedValue({
        id: 'code-1',
        attempts: 5,
        expiresAt: new Date(Date.now() + 60_000),
        codeHash: hashCode('123456'),
      });

      await expect(
        service.verifyCode('user@example.com', '123456'),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockPrismaService.emailLoginCode.update).not.toHaveBeenCalled();
    });

    it('increments attempts and throws on a wrong code', async () => {
      mockPrismaService.emailLoginCode.findFirst.mockResolvedValue({
        id: 'code-1',
        attempts: 1,
        expiresAt: new Date(Date.now() + 60_000),
        codeHash: hashCode('123456'),
      });

      await expect(
        service.verifyCode('user@example.com', '000000'),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockPrismaService.emailLoginCode.update).toHaveBeenCalledWith({
        where: { id: 'code-1' },
        data: { attempts: { increment: 1 } },
      });
    });

    it('consumes the code and returns the normalized email on success', async () => {
      mockPrismaService.emailLoginCode.findFirst.mockResolvedValue({
        id: 'code-1',
        attempts: 0,
        expiresAt: new Date(Date.now() + 60_000),
        codeHash: hashCode('123456'),
      });

      const result = await service.verifyCode('User@Example.com', '123456');

      expect(result).toBe('user@example.com');
      expect(mockPrismaService.emailLoginCode.update).toHaveBeenCalledWith({
        where: { id: 'code-1' },
        data: { consumedAt: expect.any(Date) },
      });
    });
  });
});
