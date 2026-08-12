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
