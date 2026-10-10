import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import appleSignin from 'apple-signin-auth';
import { AppleTokenService } from './apple-token.service';

jest.mock('apple-signin-auth', () => ({
  __esModule: true,
  default: { verifyIdToken: jest.fn() },
}));

const mockVerifyIdToken = appleSignin.verifyIdToken as jest.Mock;

describe('AppleTokenService', () => {
  let service: AppleTokenService;

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppleTokenService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AppleTokenService>(AppleTokenService);
    jest.clearAllMocks();
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'nodeEnv') return 'development';
      if (key === 'auth.appleClientIds') return ['com.entitiybuilders.zig-zag'];
      if (key === 'auth.allowDevAppleAuthMock') return true;
      return null;
    });
  });

  it('returns the verified user for a valid real token', async () => {
    mockVerifyIdToken.mockResolvedValue({
      sub: 'apple-sub-1',
      email: 'user@example.com',
    });

    const result = await service.verify('valid-identity-token');

    expect(result).toEqual({
      providerId: 'apple-sub-1',
      email: 'user@example.com',
    });
    expect(mockVerifyIdToken).toHaveBeenCalledWith('valid-identity-token', {
      audience: ['com.entitiybuilders.zig-zag'],
    });
  });

  it('throws UnauthorizedException when real token verification fails', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('invalid signature'));

    await expect(service.verify('bad-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('accepts dev mock token when mock is enabled in development environment', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalMockFlag = process.env.ALLOW_DEV_APPLE_AUTH_MOCK;
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DEV_APPLE_AUTH_MOCK = 'true';

    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'nodeEnv') return 'development';
      if (key === 'auth.appleClientIds') return ['com.entitiybuilders.zig-zag'];
      if (key === 'auth.allowDevAppleAuthMock') return true;
      return null;
    });

    try {
      const result = await service.verify(
        'dev_mock_apple_:dev.apple.user@privaterelay.appleid.com:001234.dev_apple_sim_user',
      );

      expect(result).toEqual({
        providerId: '001234.dev_apple_sim_user',
        email: 'dev.apple.user@privaterelay.appleid.com',
      });
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
      process.env.ALLOW_DEV_APPLE_AUTH_MOCK = originalMockFlag;
    }
  });

  it('rejects dev mock token in development when mock is disabled', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalMockFlag = process.env.ALLOW_DEV_APPLE_AUTH_MOCK;
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DEV_APPLE_AUTH_MOCK = 'false';

    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'nodeEnv') return 'development';
      if (key === 'auth.appleClientIds') return ['com.entitiybuilders.zig-zag'];
      if (key === 'auth.allowDevAppleAuthMock') return false;
      return null;
    });

    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));

    try {
      await expect(
        service.verify('dev_mock_apple_:user@example.com:sim-id'),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockVerifyIdToken).toHaveBeenCalledWith(
        'dev_mock_apple_:user@example.com:sim-id',
        { audience: ['com.entitiybuilders.zig-zag'] },
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
      process.env.ALLOW_DEV_APPLE_AUTH_MOCK = originalMockFlag;
    }
  });

  it('rejects dev mock token in production even if mock flag is set to true', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalMockFlag = process.env.ALLOW_DEV_APPLE_AUTH_MOCK;
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_APPLE_AUTH_MOCK = 'true';

    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'nodeEnv') return 'production';
      if (key === 'auth.appleClientIds') return ['com.entitiybuilders.zig-zag'];
      if (key === 'auth.allowDevAppleAuthMock') return false;
      return null;
    });

    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));

    try {
      await expect(
        service.verify('dev_mock_apple_:user@example.com:sim-id'),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockVerifyIdToken).toHaveBeenCalledWith(
        'dev_mock_apple_:user@example.com:sim-id',
        { audience: ['com.entitiybuilders.zig-zag'] },
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
      process.env.ALLOW_DEV_APPLE_AUTH_MOCK = originalMockFlag;
    }
  });

  it('rejects dev mock token in production when mock flag is disabled', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalMockFlag = process.env.ALLOW_DEV_APPLE_AUTH_MOCK;
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_APPLE_AUTH_MOCK = 'false';

    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'nodeEnv') return 'production';
      if (key === 'auth.appleClientIds') return ['com.entitiybuilders.zig-zag'];
      if (key === 'auth.allowDevAppleAuthMock') return false;
      return null;
    });

    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));

    try {
      await expect(
        service.verify('dev_mock_apple_:user@example.com:sim-id'),
      ).rejects.toThrow(UnauthorizedException);
    } finally {
      process.env.NODE_ENV = originalEnv;
      process.env.ALLOW_DEV_APPLE_AUTH_MOCK = originalMockFlag;
    }
  });
});
