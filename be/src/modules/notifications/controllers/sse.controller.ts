import {
  Controller,
  ForbiddenException,
  NotFoundException,
  Param,
  Sse,
  MessageEvent,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { SSEHubService } from '../services/sse-hub.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequestUser } from '../../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../core/database/prisma.service';
import { notificationChannel } from '../utils/notification-channel.util';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class SSEController {
  constructor(
    private readonly sseHub: SSEHubService,
    private readonly prisma: PrismaService,
  ) {}

  @Sse('tours/:tourId/stream')
  async streamTourEvents(
    @Param('tourId') tourId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<Observable<MessageEvent>> {
    const tour = await this.prisma.tour.findUnique({
      where: { id: tourId },
      select: { ownerId: true },
    });
    if (!tour) throw new NotFoundException(`Tour with ID ${tourId} not found`);
    if (tour.ownerId !== user.id) {
      throw new ForbiddenException('You do not have access to this tour');
    }

    const channelId = notificationChannel.tour(tourId);
    return this.sseHub
      .getStream(channelId)
      .pipe(finalize(() => this.sseHub.removeClient(channelId)));
  }

  @Sse('experiences/:experienceId/stream')
  async streamExperienceEvents(
    @Param('experienceId') experienceId: string,
  ): Promise<Observable<MessageEvent>> {
    const experience = await this.prisma.experience.findUnique({
      where: { id: experienceId },
      select: { id: true },
    });
    if (!experience) {
      throw new NotFoundException(
        `Experience with ID ${experienceId} not found`,
      );
    }

    const channelId = notificationChannel.experience(experienceId);
    return this.sseHub
      .getStream(channelId)
      .pipe(finalize(() => this.sseHub.removeClient(channelId)));
  }
}
