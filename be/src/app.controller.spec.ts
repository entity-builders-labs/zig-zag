import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: 'PlacesApiService',
          useValue: {
            getStatus: () => ({
              provider: 'google',
              available: true,
              cacheEnabled: true,
              cacheMode: 'strict',
            }),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return service status', () => {
      const result = appController.health();
      expect(result.status).toBe('ok');
      expect(result.service).toBe('backend');
      expect(typeof result.timestamp).toBe('string');
      expect(result.providers.places).toEqual({
        provider: 'google',
        available: true,
        cacheEnabled: true,
        cacheMode: 'strict',
      });
    });
  });
});
