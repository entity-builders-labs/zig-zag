import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { AuthProvider, User } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { GoogleTokenService } from './google-token.service';
import { AppleTokenService } from './apple-token.service';
import { EmailOtpService } from './email-otp.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly googleTokenService: GoogleTokenService,
    private readonly appleTokenService: AppleTokenService,
    private readonly emailOtpService: EmailOtpService,
  ) {}

  async loginWithGoogle(idToken: string): Promise<AuthResult> {
    const verified = await this.googleTokenService.verify(idToken);
    const user = await this.upsertUser({
      provider: AuthProvider.GOOGLE,
      providerId: verified.providerId,
      email: verified.email,
      name: verified.name,
      avatarUrl: verified.avatarUrl,
    });
    return this.issueSession(user);
  }

  async loginWithApple(
    identityToken: string,
    fullName?: string,
  ): Promise<AuthResult> {
    const verified = await this.appleTokenService.verify(identityToken);
    const user = await this.upsertUser({
      provider: AuthProvider.APPLE,
      providerId: verified.providerId,
      email: verified.email,
      name: fullName,
    });
    return this.issueSession(user);
  }

  async requestEmailCode(email: string): Promise<string> {
    return this.emailOtpService.requestCode(email);
  }

  async loginWithEmailCode(email: string, code: string): Promise<AuthResult> {
    const verifiedEmail = await this.emailOtpService.verifyCode(email, code);
    const user = await this.upsertUser({
      provider: AuthProvider.EMAIL,
      providerId: verifiedEmail,
      email: verifiedEmail,
    });
    return this.issueSession(user);
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('auth.jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (
      !user?.refreshTokenHash ||
      user.refreshTokenHash !== hashToken(refreshToken)
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.issueSession(user);
  }

  async logout(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null },
    });
  }

  async getById(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    return toAuthUser(user);
  }

  private async upsertUser(params: {
    provider: AuthProvider;
    providerId: string;
    email?: string;
    name?: string;
    avatarUrl?: string;
  }): Promise<User> {
    const existing = await this.prisma.user.findUnique({
      where: {
        provider_providerId: {
          provider: params.provider,
          providerId: params.providerId,
        },
      },
    });

    if (existing) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          name: params.name ?? existing.name,
          avatarUrl: params.avatarUrl ?? existing.avatarUrl,
        },
      });
    }

    if (!params.email) {
      throw new UnauthorizedException(
        'Email is required for first-time sign in',
      );
    }

    try {
      return await this.prisma.user.create({
        data: {
          provider: params.provider,
          providerId: params.providerId,
          email: params.email,
          name: params.name,
          avatarUrl: params.avatarUrl,
        },
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          'Ya existe una cuenta con este email usando otro método de acceso.',
        );
      }
      throw error;
    }
  }

  private async issueSession(user: User): Promise<AuthResult> {
    const payload: JwtPayload = { sub: user.id, email: user.email };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('auth.jwt.accessSecret'),
      // jsonwebtoken's StringValue type only accepts a fixed set of unit
      // suffixes; ours comes from env so it can't be narrowed statically.
      expiresIn: this.configService.get<string>(
        'auth.jwt.accessExpiresIn',
      ) as any,
    });
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('auth.jwt.refreshSecret'),
      expiresIn: this.configService.get<string>(
        'auth.jwt.refreshExpiresIn',
      ) as any,
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenHash: hashToken(refreshToken) },
    });

    return { accessToken, refreshToken, user: toAuthUser(user) };
  }
}
