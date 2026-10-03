import { VenueAnchorResolutionService } from './venue-anchor-resolution.service';

describe('VenueAnchorResolutionService', () => {
  const boundary = {
    id: 'scope',
    name: 'Paris',
    osmType: 'relation',
    osmId: 1,
    geometry: {},
    tags: {},
  } as any;
  const make = (accepted: string[]) => {
    const places = {
      acquire: jest.fn().mockResolvedValue({
        status: 'success',
        value: [{ evidenceKey: 'p', provider: 'places', title: 'Venue' }],
      }),
    };
    const synthesizer = {
      synthesizeProposals: jest.fn().mockReturnValue([{ id: 'proposal' }]),
    };
    const corroborator = {
      corroborateAndMerge: jest
        .fn()
        .mockReturnValue({ candidates: [{ id: 'candidate' }] }),
    };
    const acquisition = {
      materializeExecution: jest.fn().mockResolvedValue({
        resolved: accepted.map((experienceId) => ({
          status: 'accepted',
          experienceId,
        })),
      }),
    };
    return {
      service: new VenueAnchorResolutionService(
        places as any,
        synthesizer as any,
        corroborator as any,
        acquisition as any,
      ),
      places,
      acquisition,
    };
  };

  it('resolves and returns canonical identity for a must venue', async () => {
    const { service } = make(['exp-venue']);
    await expect(
      service.resolve({
        anchors: [
          {
            kind: 'venue',
            status: 'resolved',
            usage: 'specific_destination',
            priority: 'must',
            rawName: 'Louvre',
            canonicalName: 'Louvre',
            geoEntityId: 'geo-louvre',
            provider: 'test',
          } as any,
        ],
        destinationName: 'Paris',
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      }),
    ).resolves.toEqual({
      resolvedMustIds: ['exp-venue'],
      resolvedSoftIds: [],
      resolvedNames: ['Louvre'],
    });
  });

  it('leaves ambiguous and nonexistent venues unresolved', async () => {
    const ambiguous = make(['a', 'b']);
    await expect(
      ambiguous.service.resolve({
        anchors: [
          {
            kind: 'venue',
            status: 'resolved',
            usage: 'specific_destination',
            priority: 'must',
            rawName: 'Club',
            canonicalName: 'Club',
            geoEntityId: 'geo-club',
            provider: 'test',
          } as any,
        ],
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      }),
    ).resolves.toEqual({
      resolvedMustIds: [],
      resolvedSoftIds: [],
      resolvedNames: [],
    });
    const missing = make([]);
    await expect(
      missing.service.resolve({
        anchors: [
          {
            kind: 'venue',
            status: 'resolved',
            usage: 'specific_destination',
            priority: 'must',
            rawName: 'Nowhere',
            canonicalName: 'Nowhere',
            geoEntityId: 'geo-nowhere',
            provider: 'test',
          } as any,
        ],
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      }),
    ).resolves.toEqual({
      resolvedMustIds: [],
      resolvedSoftIds: [],
      resolvedNames: [],
    });
  });

  it('uses canonical ID for soft boost resolution, never name equality', async () => {
    const { service, acquisition } = make(['exp-soft']);
    const result = await service.resolve({
      anchors: [
        {
          kind: 'venue',
          status: 'resolved',
          usage: 'specific_destination',
          priority: 'soft',
          rawName: 'Venue',
          canonicalName: 'Venue',
          geoEntityId: 'geo-venue',
          provider: 'test',
        } as any,
      ],
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
    });
    expect(result.resolvedSoftIds).toEqual(['exp-soft']);
    expect(acquisition.materializeExecution).toHaveBeenCalled();
  });
});
