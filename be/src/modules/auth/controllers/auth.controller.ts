import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../services/auth.service';
import { GoogleLoginDto } from '../dto/google-login.dto';
import { AppleLoginDto } from '../dto/apple-login.dto';
import {
  RequestEmailCodeDto,
  VerifyEmailCodeDto,
} from '../dto/email-login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { RequestUser } from '../interfaces/jwt-payload.interface';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('google')
  @ApiOperation({ summary: 'Login or register with a Google ID token' })
  loginWithGoogle(@Body(ValidationPipe) dto: GoogleLoginDto) {
    return this.authService.loginWithGoogle(dto.idToken);
  }

  @Post('apple')
  @ApiOperation({ summary: 'Login or register with an Apple identity token' })
  loginWithApple(@Body(ValidationPipe) dto: AppleLoginDto) {
    return this.authService.loginWithApple(dto.identityToken, dto.fullName);
  }

  @Post('email/request-code')
  @ApiOperation({ summary: 'Send a one-time login code to an email address' })
  async requestEmailCode(@Body(ValidationPipe) dto: RequestEmailCodeDto) {
    const code = await this.authService.requestEmailCode(dto.email);
    // Outside production there's no real inbox to read from (dev/E2E use
    // fake or unconfigured SMTP), so the code rides along in the response.
    const devCode =
      process.env.NODE_ENV !== 'production' ? { devCode: code } : {};
    return { message: 'Código enviado.', ...devCode };
  }

  @Post('email/verify')
  @ApiOperation({
    summary: 'Login or register by verifying an email one-time code',
  })
  loginWithEmailCode(@Body(ValidationPipe) dto: VerifyEmailCodeDto) {
    return this.authService.loginWithEmailCode(dto.email, dto.code);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair' })
  refresh(@Body(ValidationPipe) dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Invalidate the current refresh token' })
  async logout(@CurrentUser() user: RequestUser) {
    await this.authService.logout(user.id);
    return { message: 'Logged out.' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current authenticated user' })
  me(@CurrentUser() user: RequestUser) {
    return this.authService.getById(user.id);
  }
}
