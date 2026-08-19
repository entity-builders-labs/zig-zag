import { GenerateTemplatesCommand } from './generate-templates.command';

describe('GenerateTemplatesCommand', () => {
  let osmPlacesService: any;
  let activitiesService: any;
  let compositeGenerationService: any;
  let command: GenerateTemplatesCommand;
  let tourChainInvoke: jest.Mock;

  const areaCandidate = {
    id: 'osm:relation:49518',
    name: 'San Telmo',
    osmType: 'relation' as const,
    osmId: 49518,
    geometry: { type: 'Polygon' as const, coordinates: [[[0, 0]]] },
    tags: { name: 'San Telmo' },
  };

  beforeEach(() => {
    osmPlacesService = {
      findBoundaryByName: jest.fn().mockResolvedValue(areaCandidate),
      findStreetsNear: jest.fn().mockResolvedValue([]),
    };
    activitiesService = { findAll: jest.fn().mockResolvedValue([]) };
    tourChainInvoke = jest.fn().mockResolvedValue({
      activities: [],
      compositeActivities: [
        {
          name: 'San Telmo Walk',
          kind: 'NEIGHBORHOOD_WALK',
          variantTheme: 'HISTORY',
          areaId: areaCandidate.id,
          waypointIds: ['poi-1', 'poi-2'],
        },
      ],
    });
    compositeGenerationService = {
      enrichCandidatesWithWikidata: jest.fn().mockResolvedValue(0),
      createTourChain: jest.fn().mockReturnValue({ invoke: tourChainInvoke }),
      verifyAndPersistComposites: jest.fn().mockResolvedValue({
        persisted: [{ variant: { id: 'variant-1', name: 'San Telmo Walk' } }],
        hallucinatedWaypointCount: 0,
        invalidCompositeCount: 0,
      }),
    };

    command = new GenerateTemplatesCommand(
      osmPlacesService,
      activitiesService,
      compositeGenerationService,
    );
  });

  it('requires --lat, --lng and --name, failing before any OSM/LLM call', async () => {
    await expect(
      command.run([], { lat: undefined, lng: undefined, name: undefined }),
    ).rejects.toThrow();
    expect(osmPlacesService.findBoundaryByName).not.toHaveBeenCalled();
  });

  it('rejects an unrecognized --themes value before doing any work', async () => {
    await expect(
      command.run([], {
        lat: -34.62,
        lng: -58.37,
        name: 'San Telmo',
        themes: 'history,not-a-real-theme',
      }),
    ).rejects.toThrow(/Invalid --themes/);
    expect(osmPlacesService.findBoundaryByName).not.toHaveBeenCalled();
  });

  it('aborts without generating anything when the area cannot be resolved via OSM', async () => {
    osmPlacesService.findBoundaryByName.mockResolvedValue(null);

    await command.run([], {
      lat: -34.62,
      lng: -58.37,
      name: 'Nowhere',
    });

    expect(activitiesService.findAll).not.toHaveBeenCalled();
    expect(compositeGenerationService.createTourChain).not.toHaveBeenCalled();
  });

  it('proposes and persists one variant per requested theme, each constrained to that theme in the prompt', async () => {
    await command.run([], {
      lat: -34.62,
      lng: -58.37,
      name: 'San Telmo',
      themes: 'history,food',
    });

    expect(tourChainInvoke).toHaveBeenCalledTimes(2);
    expect(tourChainInvoke).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ themes: 'HISTORY' }),
    );
    expect(tourChainInvoke).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ themes: 'FOOD' }),
    );
    expect(
      compositeGenerationService.verifyAndPersistComposites,
    ).toHaveBeenCalledTimes(2);
  });

  it('defaults to a fixed theme set when --themes is omitted', async () => {
    await command.run([], { lat: -34.62, lng: -58.37, name: 'San Telmo' });

    expect(tourChainInvoke).toHaveBeenCalledTimes(4); // HISTORY, FOOD, ART, QUICK
  });

  it('never sets forceUpdateWaypoints unless --update-existing was passed', async () => {
    await command.run([], {
      lat: -34.62,
      lng: -58.37,
      name: 'San Telmo',
      themes: 'history',
    });

    expect(
      compositeGenerationService.verifyAndPersistComposites,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ forceUpdateWaypoints: false }),
    );
  });

  it('forwards forceUpdateWaypoints: true when --update-existing is passed', async () => {
    await command.run([], {
      lat: -34.62,
      lng: -58.37,
      name: 'San Telmo',
      themes: 'history',
      updateExisting: true,
    });

    expect(
      compositeGenerationService.verifyAndPersistComposites,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ forceUpdateWaypoints: true }),
    );
  });

  it('skips a theme the LLM proposed nothing for, without failing the whole run', async () => {
    tourChainInvoke.mockResolvedValueOnce({
      activities: [],
      compositeActivities: [],
    });

    await command.run([], {
      lat: -34.62,
      lng: -58.37,
      name: 'San Telmo',
      themes: 'history,food',
    });

    // Only the second theme (food) reaches verifyAndPersistComposites.
    expect(
      compositeGenerationService.verifyAndPersistComposites,
    ).toHaveBeenCalledTimes(1);
  });

  it('continues to the next theme when one LLM proposal call throws', async () => {
    tourChainInvoke.mockRejectedValueOnce(new Error('LLM down'));

    await command.run([], {
      lat: -34.62,
      lng: -58.37,
      name: 'San Telmo',
      themes: 'history,food',
    });

    expect(tourChainInvoke).toHaveBeenCalledTimes(2);
    expect(
      compositeGenerationService.verifyAndPersistComposites,
    ).toHaveBeenCalledTimes(1);
  });
});
