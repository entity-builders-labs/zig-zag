import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthProvider } from '@prisma/client';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../../../core/database/prisma.service';
import { GoogleTokenService } from './google-token.service';
import { AppleTokenService } from './apple-token.service';
import { EmailOtpService } from './email-otp.service';

describe('AuthService', () => {
  let service: AuthService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockJwtService = {
    sign: jest.fn(() => 'signed-token'),
    verify: jest.fn(),
  };

  const configValues: Record<string, unknown> = {
    'auth.jwt.accessSecret': 'access-secret',
    'auth.jwt.accessExpiresIn': '15m',
    'auth.jwt.refreshSecret': 'refresh-secret',
    'auth.jwt.refreshExpiresIn': '30d',
  };

  const mockConfigService = {
    get: jest.fn((key: string) => configValues[key]),
  };

  const mockGoogleTokenService = { verify: jest.fn() };
  const mockAppleTokenService = { verify: jest.fn() };
  const mockEmailOtpService = { requestCode: jest.fn(), verifyCode: jest.fn() };

  const baseUser: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
    provider: AuthProvider;
    providerId: string;
    refreshTokenHash: string | null;
  } = {
    id: 'user-1',
    email: 'user@example.com',
    name: 'User',
    avatarUrl: null,
    provider: AuthProvider.GOOGLE,
    providerId: 'google-sub-1',
    refreshTokenHash: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: GoogleTokenService, useValue: mockGoogleTokenService },
        { provide: AppleTokenService, useValue: mockAppleTokenService },
        { provide: EmailOtpService, useValue: mockEmailOtpService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    mockJwtService.sign.mockReturnValue('signed-token');
  });

  describe('loginWithGoogle', () => {
    it('creates a new user on first login and issues a session', async () => {
      mockGoogleTokenService.verify.mockResolvedValue({
        providerId: 'google-sub-1',
        email: 'user@example.com',
        name: 'User',
        avatarUrl: 'https://example.com/avatar.png',
      });
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue(baseUser);
      mockPrismaService.user.update.mockResolvedValue(baseUser);

      const result = await service.loginWithGoogle('id-token');

      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: {
          provider: AuthProvider.GOOGLE,
          providerId: 'google-sub-1',
          email: 'user@example.com',
          name: 'User',
          avatarUrl: 'https://example.com/avatar.png',
        },
      });
      expect(result.accessToken).toBe('signed-token');
      expect(result.refreshToken).toBe('signed-token');
      expect(result.user.id).toBe('user-1');
    });

    it('updates name/avatar for a returning user instead of creating a new one', async () => {
      mockGoogleTokenService.verify.mockResolvedValue({
        providerId: 'google-sub-1',
        email: 'user@example.com',
        name: 'Updated Name',
        avatarUrl: 'https://example.com/new-avatar.png',
      });
      mockPrismaService.user.findUnique.mockResolvedValue(baseUser);
      mockPrismaService.user.update.mockResolvedValue({
        ...baseUser,
        name: 'Updated Name',
      });

      await service.loginWithGoogle('id-token');

      expect(mockPrismaService.user.create).not.toHaveBeenCalled();
      expect(mockPrismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: {
            name: 'Updated Name',
            avatarUrl: 'https://example.com/new-avatar.png',
          },
        }),
      );
    });

    it('throws a ConflictException when the email is already used by another provider', async () => {
      mockGoogleTokenService.verify.mockResolvedValue({
        providerId: 'google-sub-1',
        email: 'user@example.com',
      });
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.loginWithGoogle('id-token')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('loginWithApple', () => {
    it('creates a new user on first login with Apple and issues a session', async () => {
      mockAppleTokenService.verify.mockResolvedValue({
        providerId: 'apple-sub-1',
        email: 'user@example.com',
      });
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue({
        ...baseUser,
        provider: AuthProvider.APPLE,
        providerId: 'apple-sub-1',
        name: 'Apple User',
      });

      const result = await service.loginWithApple('identity-token', 'Apple User');

      expect(result.user.email).toBe('user@example.com');
      expect(result.accessToken).toBe('signed-token');
      expect(result.refreshToken).toBe('signed-token');
      expect(mockPrismaService.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider: AuthProvider.APPLE,
            providerId: 'apple-sub-1',
            email: 'user@example.com',
            name: 'Apple User',
          }),
        }),
      );
    });
  });

  describe('loginWithEmailCode', () => {
    it('verifies the code and upserts a user keyed by email', async () => {
      mockEmailOtpService.verifyCode.mockResolvedValue('user@example.com');
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue({
        ...baseUser,
        provider: AuthProvider.EMAIL,
        providerId: 'user@example.com',
      });

      const result = await service.loginWithEmailCode(
        'user@example.com',
        '123456',
      );

      expect(mockEmailOtpService.verifyCode).toHaveBeenCalledWith(
        'user@example.com',
        '123456',
      );
      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: {
          provider: AuthProvider.EMAIL,
          providerId: 'user@example.com',
          email: 'user@example.com',
          name: undefined,
          avatarUrl: undefined,
        },
      });
      expect(result.user.email).toBe('user@example.com');
    });
  });

  describe('refresh', () => {
    it('throws when the token fails verification', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('bad token');
      });

      await expect(service.refresh('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws when the stored hash does not match the presented token', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: 'user-1',
        email: 'user@example.com',
      });
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...baseUser,
        refreshTokenHash: 'some-other-hash',
      });

      await expect(service.refresh('presented-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('issues a new session when the token matches the stored hash', async () => {
      const storedHash = crypto
        .createHash('sha256')
        .update('valid-refresh-token')
        .digest('hex');

      mockJwtService.verify.mockReturnValue({
        sub: 'user-1',
        email: 'user@example.com',
      });
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...baseUser,
        refreshTokenHash: storedHash,
      });
      mockPrismaService.user.update.mockResolvedValue(baseUser);

      const result = await service.refresh('valid-refresh-token');

      expect(result.accessToken).toBe('signed-token');
    });
  });

  describe('logout', () => {
    it('clears the stored refresh token hash', async () => {
      mockPrismaService.user.update.mockResolvedValue(baseUser);

      await service.logout('user-1');

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { refreshTokenHash: null },
      });
    });
  });
});
