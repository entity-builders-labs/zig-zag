import {
  PlanningExperienceCandidate,
  NormalizedOpeningHours,
} from 'src/modules/tours/interfaces/daily-planning.interface';
import { withPointFootprints } from './point-footprints.util';

export class CandidateBuilder {
  private candidate: Omit<
    PlanningExperienceCandidate,
    'startFootprint' | 'endFootprint'
  >;

  constructor(
    id: string = `cand-${Math.random().toString(36).substring(2, 7)}`,
  ) {
    this.candidate = {
      experienceId: id,
      title: `Experience ${id}`,
      durationMinutes: 60,
      semanticScore: 0.8,
      qualityScore: 0.9,
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

  withScores(semantic: number, quality: number): this {
    this.candidate.semanticScore = semantic;
    this.candidate.qualityScore = quality;
    return this;
  }

  withSemanticScore(score: number): this {
    this.candidate.semanticScore = score;
    return this;
  }

  withQualityScore(score: number): this {
    this.candidate.qualityScore = score;
    return this;
  }

  withThemes(...themes: string[]): this {
    this.candidate.themes = themes;
    return this;
  }

  withFamily(familyId: string): this {
    this.candidate.metadata = { ...this.candidate.metadata, source: familyId };
    return this;
  }

  withFamilyId(familyId: string): this {
    return this.withFamily(familyId);
  }

  withOpeningHours(hours: NormalizedOpeningHours): this {
    this.candidate.openingHours = hours;
    return this;
  }

  build(): PlanningExperienceCandidate {
    return withPointFootprints({ ...this.candidate });
  }
}
