import {
  PlanningActivityCandidate,
  NormalizedOpeningHours,
} from 'src/modules/tours/interfaces/daily-planning.interface';
import { ExperienceFormat } from 'src/modules/tours/interfaces/tour-generation.interface';

export class CandidateBuilder {
  private candidate: PlanningActivityCandidate = {
    activityId: 'cand-001',
    kind: 'POI',
    title: 'Test Activity',
    durationMinutes: 60,
    semanticScore: 0.8,
    qualityScore: 0.9,
    spatialFootprint: {
      type: 'POINT',
      centroid: { lat: -34.6037, lng: -58.3816 }, // Obelisco CABA
    },
    formats: [ExperienceFormat.POINT_VISITS],
    openingHours: { status: 'unknown' },
  };

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

  withScores(semantic: number, quality: number): this {
    this.candidate.semanticScore = semantic;
    this.candidate.qualityScore = quality;
    return this;
  }

  withLocation(lat: number, lng: number): this {
    this.candidate.spatialFootprint = {
      type: 'POINT',
      centroid: { lat, lng },
    };
    return this;
  }

  withFormats(...formats: ExperienceFormat[]): this {
    this.candidate.formats = formats;
    return this;
  }

  withFamilyId(familyId: string): this {
    this.candidate.familyId = familyId;
    return this;
  }

  withOpeningHours(hours: NormalizedOpeningHours): this {
    this.candidate.openingHours = hours;
    return this;
  }

  build(): PlanningActivityCandidate {
    return JSON.parse(JSON.stringify(this.candidate));
  }
}
