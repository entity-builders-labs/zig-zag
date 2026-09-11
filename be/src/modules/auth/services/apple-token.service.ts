import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import appleSignin from 'apple-signin-auth';

export interface VerifiedAppleUser {
  providerId: string;
  email?: string;
}

@Injectable()
export class AppleTokenService {
  constructor(private readonly configService: ConfigService) {}

  async verify(identityToken: string): Promise<VerifiedAppleUser> {
    const isProduction =
      this.configService.get<string>('nodeEnv') === 'production' ||
      process.env.NODE_ENV === 'production';
    const allowDevMock =
      !isProduction &&
      (this.configService.get<boolean>('auth.allowDevAppleAuthMock') ??
        process.env.ALLOW_DEV_APPLE_AUTH_MOCK === 'true');

    if (allowDevMock && identityToken.startsWith('dev_mock_apple_')) {
      const parts = identityToken.split(':');
      const email = parts[1] || 'dev.apple.user@privaterelay.appleid.com';
      const providerId = parts[2] || '001234.dev_apple_sim_user';
      return { providerId, email };
    }

    const audience = this.configService.get<string[]>('auth.appleClientIds');

    try {
      const payload = await appleSignin.verifyIdToken(identityToken, {
        audience,
      });

      return { providerId: payload.sub, email: payload.email };
    } catch {
      throw new UnauthorizedException('Invalid Apple token');
    }
  }
}
