import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsIn } from 'class-validator';

export class RegisterDeviceDto {
  @ApiProperty({
    description: 'Expo Push Token (e.g. ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx])',
    example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
  })
  @IsString()
  @IsNotEmpty()
  expoPushToken: string;

  @ApiProperty({
    description: 'Device platform',
    example: 'ios',
    enum: ['ios', 'android'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['ios', 'android'])
  platform: string;
}
