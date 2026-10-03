import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AppleLoginDto {
  @ApiProperty({ description: 'Apple identity token obtained on the client' })
  @IsString()
  @IsNotEmpty()
  identityToken: string;

  @ApiProperty({
    description:
      "User's full name — only sent by Apple on the first authorization, must be forwarded by the client since the backend can't recover it later",
    required: false,
  })
  @IsString()
  @IsOptional()
  fullName?: string;
}
