import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  ValidationPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequestUser } from '../../auth/interfaces/jwt-payload.interface';
import { PushNotificationService } from '../services/push-notification.service';
import { RegisterDeviceDto } from '../dto/register-device.dto';
import {
  RegisterWebPushSubscriptionDto,
  UnregisterWebPushSubscriptionDto,
} from '../dto/web-push-subscription.dto';

@ApiTags('notifications')
@Controller('notifications/devices')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DevicesController {
  constructor(private readonly pushService: PushNotificationService) {}

  @Post()
  @ApiOperation({ summary: 'Register or refresh an Expo push notification token for the current user' })
  async registerDevice(
    @CurrentUser() user: RequestUser,
    @Body(ValidationPipe) dto: RegisterDeviceDto,
  ) {
    const device = await this.pushService.registerDevice(user.id, dto);
    return {
      success: true,
      deviceId: device.id,
      platform: device.platform,
      enabled: device.enabled,
    };
  }

  @Post('web')
  @ApiOperation({ summary: 'Register or refresh a Web Push subscription' })
  async registerWebPushSubscription(
    @CurrentUser() user: RequestUser,
    @Body(ValidationPipe) dto: RegisterWebPushSubscriptionDto,
  ) {
    const subscription = await this.pushService.registerWebPushSubscription(
      user.id,
      dto,
    );
    return { success: true, subscriptionId: subscription.id };
  }

  @Delete('web')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable a Web Push subscription' })
  async unregisterWebPushSubscription(
    @CurrentUser() user: RequestUser,
    @Body(ValidationPipe) dto: UnregisterWebPushSubscriptionDto,
  ) {
    await this.pushService.unregisterWebPushSubscription(user.id, dto.endpoint);
    return { success: true };
  }

  @Delete(':token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unregister / disable a push notification token on logout' })
  async unregisterDevice(
    @CurrentUser() user: RequestUser,
    @Param('token') token: string,
  ) {
    await this.pushService.unregisterDevice(user.id, token);
    return {
      success: true,
      message: 'Device token unregistered successfully.',
    };
  }
}
