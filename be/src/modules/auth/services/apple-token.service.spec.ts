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
    get: jest.fn<any, [string?]>((key?: string) => ['apple-client-id']),
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
  });

  it('returns the verified user for a valid token', async () => {
    mockVerifyIdToken.mockResolvedValue({
      sub: 'apple-sub-1',
      email: 'user@example.com',
    });

    const result = await service.verify('valid-identity-token');

    expect(result).toEqual({
      providerId: 'apple-sub-1',
      email: 'user@example.com',
    });
  });

  it('throws UnauthorizedException when verification fails', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('invalid signature'));

    await expect(service.verify('bad-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('accepts dev mock token in non-production environment', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'nodeEnv') return 'development';
      return ['apple-client-id'];
    });

    try {
      const result = await service.verify(
        'dev_mock_apple_:dev.apple.user@privaterelay.appleid.com:001234.dev_apple_sim_user',
      );

      expect(result).toEqual({
        providerId: '001234.dev_apple_sim_user',
        email: 'dev.apple.user@privaterelay.appleid.com',
      });
      // Should not call real appleSignin.verifyIdToken
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('rejects dev mock token in production environment', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'nodeEnv') return 'production';
      return ['apple-client-id'];
    });

    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));

    try {
      await expect(
        service.verify('dev_mock_apple_:user@example.com:sim-id'),
      ).rejects.toThrow(UnauthorizedException);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});
