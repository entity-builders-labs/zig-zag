import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return service status', () => {
      const result = appController.health();
      expect(result.status).toBe('ok');
      expect(result.service).toBe('backend');
      expect(typeof result.timestamp).toBe('string');
    });
  });
});
