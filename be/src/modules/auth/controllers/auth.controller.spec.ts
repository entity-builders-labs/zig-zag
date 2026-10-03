import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from '../services/auth.service';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    loginWithGoogle: jest.fn(),
    loginWithApple: jest.fn(),
    requestEmailCode: jest.fn(),
    loginWithEmailCode: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    getById: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates google login to the service', async () => {
    mockAuthService.loginWithGoogle.mockResolvedValue({ accessToken: 'a' });

    const result = await controller.loginWithGoogle({ idToken: 'id-token' });

    expect(mockAuthService.loginWithGoogle).toHaveBeenCalledWith('id-token');
    expect(result).toEqual({ accessToken: 'a' });
  });

  describe('requestEmailCode', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('includes the plaintext code outside production, for tests without a real inbox', async () => {
      process.env.NODE_ENV = 'test';
      mockAuthService.requestEmailCode.mockResolvedValue('123456');

      const result = await controller.requestEmailCode({
        email: 'user@example.com',
      });

      expect(result).toEqual({ message: 'Código enviado.', devCode: '123456' });
    });

    it('omits the code in production', async () => {
      process.env.NODE_ENV = 'production';
      mockAuthService.requestEmailCode.mockResolvedValue('123456');

      const result = await controller.requestEmailCode({
        email: 'user@example.com',
      });

      expect(result).toEqual({ message: 'Código enviado.' });
    });
  });

  it('delegates email code verification to the service', async () => {
    mockAuthService.loginWithEmailCode.mockResolvedValue({ accessToken: 'a' });

    await controller.loginWithEmailCode({
      email: 'user@example.com',
      code: '123456',
    });

    expect(mockAuthService.loginWithEmailCode).toHaveBeenCalledWith(
      'user@example.com',
      '123456',
    );
  });

  it('logs out the current user', async () => {
    const result = await controller.logout({
      id: 'user-1',
      email: 'user@example.com',
    });

    expect(mockAuthService.logout).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ message: 'Logged out.' });
  });
});
