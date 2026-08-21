import { Controller, Get, Inject } from '@nestjs/common';
import { IPlacesApiService } from '@integrations/google-places/interfaces/places-api.interface';

@Controller()
export class AppController {
  constructor(
    @Inject('PlacesApiService')
    private readonly placesApi: IPlacesApiService,
  ) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'backend',
      timestamp: new Date().toISOString(),
      providers: {
        places: this.placesApi.getStatus(),
      },
    };
  }
}
