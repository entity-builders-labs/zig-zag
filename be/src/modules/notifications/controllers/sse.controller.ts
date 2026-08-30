import {
  Controller,
  Param,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { SSEHubService } from '../services/sse-hub.service';

@Controller('notifications')
export class SSEController {
  constructor(private readonly sseHub: SSEHubService) {}

  @Sse('stream/:channelId')
  streamEvents(@Param('channelId') channelId: string): Observable<MessageEvent> {
    return this.sseHub
      .getStream(channelId)
      .pipe(finalize(() => this.sseHub.removeClient(channelId)));
  }

  @Sse('tours/:tourId/stream')
  streamTourEvents(@Param('tourId') tourId: string): Observable<MessageEvent> {
    return this.sseHub
      .getStream(tourId)
      .pipe(finalize(() => this.sseHub.removeClient(tourId)));
  }
}
