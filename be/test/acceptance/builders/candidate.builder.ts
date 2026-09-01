import {
  PlanningActivityCandidate,
  NormalizedOpeningHours,
} from 'src/modules/tours/interfaces/daily-planning.interface';
import { ExperienceFormat } from 'src/modules/tours/interfaces/tour-generation.interface';

export class CandidateBuilder {
  private candidate: PlanningActivityCandidate;

  constructor(
    id: string = `cand-${Math.random().toString(36).substring(2, 7)}`,
  ) {
    this.candidate = {
      activityId: id,
      kind: 'POI',
      title: `Activity ${id}`,
      durationMinutes: 60,
      semanticScore: 0.8,
      qualityScore: 0.9,
      spatialFootprint: {
        type: 'POINT',
        centroid: { lat: -34.6037, lng: -58.3816 }, // Default Buenos Aires
      },
      formats: [ExperienceFormat.POINT_VISITS],
    };
  }

  static aCandidate(id?: string): CandidateBuilder {
    return new CandidateBuilder(id);
  }

  withId(id: string): this {
    this.candidate.activityId = id;
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

  withFormats(...formats: ExperienceFormat[]): this {
    this.candidate.formats = formats;
    return this;
  }

  withThemes(...themes: string[]): this {
    this.candidate.themes = themes;
    return this;
  }

  withFamily(familyId: string, variantKey?: string): this {
    this.candidate.familyId = familyId;
    this.candidate.variantKey = variantKey;
    return this;
  }

  withFamilyId(familyId: string, variantKey?: string): this {
    return this.withFamily(familyId, variantKey);
  }

  withOpeningHours(hours: NormalizedOpeningHours): this {
    this.candidate.openingHours = hours;
    return this;
  }

  build(): PlanningActivityCandidate {
    return { ...this.candidate };
  }
}
