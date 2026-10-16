import {
  PlanningExperienceCandidate,
  NormalizedOpeningHours,
} from 'src/modules/tours/interfaces/daily-planning.interface';
import {
  AcceptanceCandidateSpec,
  toPointCandidate,
} from './point-footprints.util';

export class CandidateBuilder {
  private candidate: AcceptanceCandidateSpec;

  constructor(
    id: string = `cand-${Math.random().toString(36).substring(2, 7)}`,
  ) {
    this.candidate = {
      experienceId: id,
      title: `Experience ${id}`,
      durationMinutes: 60,
      // A lone candidate; pools give distinct ranks with withPreferenceRank.
      preferenceRank: 1,
      spatialFootprint: {
        type: 'POINT',
        centroid: { lat: -34.6037, lng: -58.3816 }, // Default Buenos Aires
      },
    };
  }

  static aCandidate(id?: string): CandidateBuilder {
    return new CandidateBuilder(id);
  }

  withId(id: string): this {
    this.candidate.experienceId = id;
    return this;
  }

  withTitle(title: string): this {
    this.candidate.title = title;
    return this;
  }

  withDuration(minutes: number): this {
    this.candidate.durationMinutes = minutes;
    return this;
  }

  withDurationMinutes(minutes: number): this {
    this.candidate.durationMinutes = minutes;
    return this;
  }

  withCentroid(lat: number, lng: number): this {
    this.candidate.spatialFootprint = {
      type: 'POINT',
      centroid: { lat, lng },
    };
    return this;
  }

  withPreferenceRank(rank: number): this {
    this.candidate.preferenceRank = rank;
    return this;
  }

  withOpeningHours(hours: NormalizedOpeningHours): this {
    this.candidate.openingHours = hours;
    return this;
  }

  build(): PlanningExperienceCandidate {
    return toPointCandidate({ ...this.candidate });
  }
}
