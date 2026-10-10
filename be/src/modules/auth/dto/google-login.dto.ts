import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class GoogleLoginDto {
  @ApiProperty({ description: 'Google ID token obtained on the client' })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}
