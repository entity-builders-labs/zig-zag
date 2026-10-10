import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { GoogleTokenService } from './google-token.service';

const mockVerifyIdToken = jest.fn();

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

describe('GoogleTokenService', () => {
  let service: GoogleTokenService;

  const mockConfigService = {
    get: jest.fn(() => ['google-client-id']),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleTokenService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<GoogleTokenService>(GoogleTokenService);
    jest.clearAllMocks();
  });

  it('returns the verified user for a valid token', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: 'google-sub-1',
        email: 'user@example.com',
        name: 'User',
        picture: 'https://example.com/avatar.png',
      }),
    });

    const result = await service.verify('valid-id-token');

    expect(result).toEqual({
      providerId: 'google-sub-1',
      email: 'user@example.com',
      name: 'User',
      avatarUrl: 'https://example.com/avatar.png',
    });
  });

  it('throws UnauthorizedException when the payload has no sub/email', async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({}) });

    await expect(service.verify('token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when verification fails', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('invalid signature'));

    await expect(service.verify('bad-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
