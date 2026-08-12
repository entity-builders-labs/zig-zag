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
    get: jest.fn(() => ['apple-client-id']),
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
});
