import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { GoogleTokenService } from './services/google-token.service';
import { AppleTokenService } from './services/apple-token.service';
import { EmailOtpService } from './services/email-otp.service';
import { MailerService } from './services/mailer.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PrismaModule } from '../../core/database/database.module';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('auth.jwt.accessSecret'),
        signOptions: {
          // jsonwebtoken's StringValue type only accepts a fixed set of unit
          // suffixes; ours comes from env so it can't be narrowed statically.
          expiresIn: configService.get<string>(
            'auth.jwt.accessExpiresIn',
          ) as any,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleTokenService,
    AppleTokenService,
    EmailOtpService,
    MailerService,
    JwtStrategy,
  ],
  exports: [PassportModule],
})
export class AuthModule {}
