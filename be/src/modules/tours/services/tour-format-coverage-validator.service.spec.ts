import { ActivityKind } from '@prisma/client';
import { TourFormatCoverageValidator } from './tour-format-coverage-validator.service';
import { ExperienceFormat } from '../interfaces/tour-generation.interface';
import { TourFormatCoverageActivityRef } from '../interfaces/tour-format-coverage.interface';

describe('TourFormatCoverageValidator', () => {
  let service: TourFormatCoverageValidator;

  beforeEach(() => {
    service = new TourFormatCoverageValidator();
  });

  function ref(
    activityId: string,
    kind: ActivityKind,
  ): TourFormatCoverageActivityRef {
    return { activityId, kind };
  }

  it('flags a requested format with available candidates but none selected', () => {
    const result = service.validate({
      requestedExperienceFormats: [ExperienceFormat.NEIGHBORHOOD_WALKS],
      selectedActivities: [ref('poi-1', ActivityKind.POI)],
      availableCandidateActivities: [
        ref('walk-1', ActivityKind.NEIGHBORHOOD_WALK),
        ref('walk-2', ActivityKind.NEIGHBORHOOD_WALK),
        ref('poi-1', ActivityKind.POI),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'REQUESTED_FORMAT_MISSING',
        requestedFormat: ExperienceFormat.NEIGHBORHOOD_WALKS,
        availableCandidateCount: 2,
        selectedCandidateCount: 0,
      }),
    ]);
  });

  it('does not reject when the requested format has zero candidates in the pool at all', () => {
    const result = service.validate({
      requestedExperienceFormats: [ExperienceFormat.NEIGHBORHOOD_WALKS],
      selectedActivities: [ref('poi-1', ActivityKind.POI)],
      availableCandidateActivities: [ref('poi-1', ActivityKind.POI)],
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('accepts a requested format that was represented in the selection', () => {
    const result = service.validate({
      requestedExperienceFormats: [ExperienceFormat.NEIGHBORHOOD_WALKS],
      selectedActivities: [
        ref('walk-1', ActivityKind.NEIGHBORHOOD_WALK),
        ref('poi-1', ActivityKind.POI),
      ],
      availableCandidateActivities: [
        ref('walk-1', ActivityKind.NEIGHBORHOOD_WALK),
        ref('poi-1', ActivityKind.POI),
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('flags only the format that was ignored when two are requested and both are available', () => {
    const result = service.validate({
      requestedExperienceFormats: [
        ExperienceFormat.NEIGHBORHOOD_WALKS,
        ExperienceFormat.EXPERIENCES,
      ],
      selectedActivities: [
        ref('walk-1', ActivityKind.NEIGHBORHOOD_WALK),
        ref('poi-1', ActivityKind.POI),
      ],
      availableCandidateActivities: [
        ref('walk-1', ActivityKind.NEIGHBORHOOD_WALK),
        ref('exp-1', ActivityKind.EXPERIENCE),
        ref('poi-1', ActivityKind.POI),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({
        requestedFormat: ExperienceFormat.EXPERIENCES,
        availableCandidateCount: 1,
        selectedCandidateCount: 0,
      }),
    ]);
  });

  it('allows POIs to complement a selected composite without invalidating coverage', () => {
    const result = service.validate({
      requestedExperienceFormats: [ExperienceFormat.NEIGHBORHOOD_WALKS],
      selectedActivities: [
        ref('walk-1', ActivityKind.NEIGHBORHOOD_WALK),
        ref('poi-1', ActivityKind.POI),
        ref('poi-2', ActivityKind.POI),
      ],
      availableCandidateActivities: [
        ref('walk-1', ActivityKind.NEIGHBORHOOD_WALK),
        ref('poi-1', ActivityKind.POI),
        ref('poi-2', ActivityKind.POI),
      ],
    });

    expect(result.valid).toBe(true);
  });

  it('does not let a ROUTE satisfy a requested neighborhood_walks format', () => {
    const result = service.validate({
      requestedExperienceFormats: [ExperienceFormat.NEIGHBORHOOD_WALKS],
      selectedActivities: [ref('route-1', ActivityKind.ROUTE)],
      availableCandidateActivities: [
        ref('walk-1', ActivityKind.NEIGHBORHOOD_WALK),
        ref('route-1', ActivityKind.ROUTE),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toEqual(
      expect.objectContaining({
        requestedFormat: ExperienceFormat.NEIGHBORHOOD_WALKS,
      }),
    );
  });

  it('evaluates coverage at tour level: a format present on only one of several days still satisfies it', () => {
    // This validator has no dayNumber concept at all — selectedActivities is
    // the whole tour's picks. A single NEIGHBORHOOD_WALK anywhere satisfies
    // the requested format regardless of which day it landed on.
    const result = service.validate({
      requestedExperienceFormats: [ExperienceFormat.NEIGHBORHOOD_WALKS],
      selectedActivities: [
        ref('poi-1', ActivityKind.POI),
        ref('poi-2', ActivityKind.POI),
        ref('walk-1', ActivityKind.NEIGHBORHOOD_WALK),
        ref('poi-3', ActivityKind.POI),
      ],
      availableCandidateActivities: [
        ref('walk-1', ActivityKind.NEIGHBORHOOD_WALK),
        ref('poi-1', ActivityKind.POI),
        ref('poi-2', ActivityKind.POI),
        ref('poi-3', ActivityKind.POI),
      ],
    });

    expect(result.valid).toBe(true);
  });

  it('never flags point_visits — it has no kind mapping and needs no coverage gate', () => {
    const result = service.validate({
      requestedExperienceFormats: [ExperienceFormat.POINT_VISITS],
      selectedActivities: [ref('poi-1', ActivityKind.POI)],
      availableCandidateActivities: [
        ref('poi-1', ActivityKind.POI),
        ref('walk-1', ActivityKind.NEIGHBORHOOD_WALK),
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
