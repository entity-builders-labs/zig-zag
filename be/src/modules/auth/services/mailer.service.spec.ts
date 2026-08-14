import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailerService } from './mailer.service';

const mockSendMail = jest.fn();

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

describe('MailerService', () => {
  const buildService = async (smtpHost: string | undefined) => {
    const mockConfigService = {
      get: jest.fn(() => ({
        host: smtpHost,
        port: 587,
        secure: false,
        user: undefined as string | undefined,
        pass: undefined as string | undefined,
        from: 'Zig-Zag <no-reply@zigzag.app>',
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailerService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    return module.get<MailerService>(MailerService);
  };

  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('skips sending without throwing when SMTP is not configured (dev/test)', async () => {
    const service = await buildService(undefined);

    await expect(
      service.sendLoginCode('user@example.com', '123456'),
    ).resolves.toBeUndefined();
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('skips sending outside production even when SMTP is configured — the single .env shared by local/CI carries real prod credentials', async () => {
    process.env.NODE_ENV = 'test';
    const service = await buildService('smtp.example.com');

    await expect(
      service.sendLoginCode('user@example.com', '123456'),
    ).resolves.toBeUndefined();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('sends the code by email when SMTP is configured in production', async () => {
    process.env.NODE_ENV = 'production';
    mockSendMail.mockResolvedValue({});
    const service = await buildService('smtp.example.com');

    await service.sendLoginCode('user@example.com', '123456');

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: expect.stringContaining('123456'),
      }),
    );
  });

  it('propagates a real send failure when SMTP is configured in production', async () => {
    process.env.NODE_ENV = 'production';
    mockSendMail.mockRejectedValue(new Error('connection refused'));
    const service = await buildService('smtp.example.com');

    await expect(
      service.sendLoginCode('user@example.com', '123456'),
    ).rejects.toThrow('connection refused');
  });
});
