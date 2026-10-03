import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUrl } from 'class-validator';

export class RegisterWebPushSubscriptionDto {
  @ApiProperty({ description: 'Push service endpoint URL' })
  @IsUrl({ require_tld: false })
  endpoint: string;

  @ApiProperty({ description: 'Base64url P-256 public key' })
  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @ApiProperty({ description: 'Base64url authentication secret' })
  @IsString()
  @IsNotEmpty()
  auth: string;
}

export class UnregisterWebPushSubscriptionDto {
  @ApiProperty({ description: 'Push service endpoint URL' })
  @IsUrl({ require_tld: false })
  endpoint: string;
}
