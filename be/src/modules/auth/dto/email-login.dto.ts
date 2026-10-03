import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';

export class RequestEmailCodeDto {
  @ApiProperty({ description: 'Email address to send the login code to' })
  @IsEmail()
  email: string;
}

export class VerifyEmailCodeDto {
  @ApiProperty({ description: 'Email address the code was sent to' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: '6-digit login code received by email' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  code: string;
}
