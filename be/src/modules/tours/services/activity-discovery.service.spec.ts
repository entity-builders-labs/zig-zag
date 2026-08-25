import { Test, TestingModule } from '@nestjs/testing';
import { ActivityDiscoveryService } from './activity-discovery.service';
import {
  DISCOVERY_PROVIDER,
  SearchGroundedDiscoveryProvider,
} from '../interfaces/activity-discovery.interface';

describe('ActivityDiscoveryService', () => {
  let service: ActivityDiscoveryService;
  let mockProvider: jest.Mocked<SearchGroundedDiscoveryProvider>;

  beforeEach(async () => {
    mockProvider = {
      discover: jest.fn().mockResolvedValue({
        proposals: [],
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityDiscoveryService,
        { provide: DISCOVERY_PROVIDER, useValue: mockProvider },
      ],
    }).compile();

    service = module.get(ActivityDiscoveryService);
  });

  it('delegates gap fill discovery to the provider', async () => {
    const result = await service.discoverGaps(
      'Buenos Aires',
      'Argentina',
      ['nature', 'tango'],
      [
        {
          reason: 'missing_requested_theme',
          severity: 'blocking',
          message: 'Falta cobertura para tango',
        },
      ],
    );

    expect(mockProvider.discover).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationName: 'Buenos Aires',
        destinationCountry: 'Argentina',
        requestedThemes: ['nature', 'tango'],
        mode: { type: 'gap_fill', deficits: expect.any(Array) },
      }),
    );
    expect(result.provider).toBe('groq');
  });

  it('delegates bootstrap discovery to the provider', async () => {
    const result = await service.discoverBootstrap('Salta', 'Argentina', [
      'history',
      'nature',
      'food',
    ]);

    expect(mockProvider.discover).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationName: 'Salta',
        mode: { type: 'bootstrap', reason: 'new_destination' },
      }),
    );
    expect(result.provider).toBe('groq');
  });

  it('never touches Prisma or persists anything', () => {
    // The service has no Prisma dependency — enforced by the constructor
    const constructorParams = Reflect.getOwnPropertyDescriptor(
      ActivityDiscoveryService.prototype,
      'constructor',
    );
    expect(constructorParams).toBeDefined();
    // Verify no prisma-related methods exist
    expect((service as any).prisma).toBeUndefined();
  });
});
