import { TransportationMode } from '../../../src/modules/tours/interfaces/tour-generation.interface';
import {
  docToAxisWeights,
  INDEX_IDENTITY,
  projectAxisVector,
  queryToAxisWeights,
} from './axis-oracle';

/* ------------------------------------------------------------------ *
 * Deterministic multi-axis embedding service (mirrors the shape the
 * real ExperienceVectorStoreService consumes — see the scale spec).
 * ------------------------------------------------------------------ */

export function makeFakeCompetitiveEmbeddingService() {
  const embeddings = {
    embedQuery: jest.fn(
      async (query: string): Promise<number[]> =>
        projectAxisVector(queryToAxisWeights(query)),
    ),
    embedDocuments: jest.fn(
      async (texts: string[]): Promise<number[][]> =>
        texts.map((text) => projectAxisVector(docToAxisWeights(text))),
    ),
  };
  return {
    embeddings,
    service: {
      ensureInitialized: jest.fn(async (): Promise<void> => undefined),
      getIndexIdentity: jest.fn(() => ({ ...INDEX_IDENTITY })),
      getStatus: jest.fn(() => ({
        status: 'ready' as const,
        identity: { ...INDEX_IDENTITY },
      })),
      getEmbeddings: jest.fn(() => embeddings),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Deterministic preference interpreter (fake LangChain).
 * ------------------------------------------------------------------ */

export interface FakeInterpretation {
  preferredFacets: Array<{
    dimension: string;
    key: string;
    confidence: number;
    strength?: 'strong' | 'medium' | 'weak';
    evidence?: string[];
  }>;
  excludedThemes: string[];
  excludedTraits: string[];
  hardExclusions: string[];
  softConstraints: string[];
  ambiguities: string[];
  dietaryPreferences: string[];
  accessibilityPreferences: string[];
  budgetPreferences: string[];
  groupPreferences: string[];
  positiveSemanticQuery: string;
  notes: string[];
}

export function emptyInterpretation(): FakeInterpretation {
  return {
    preferredFacets: [],
    excludedThemes: [],
    excludedTraits: [],
    hardExclusions: [],
    softConstraints: [],
    ambiguities: [],
    dietaryPreferences: [],
    accessibilityPreferences: [],
    budgetPreferences: [],
    groupPreferences: [],
    positiveSemanticQuery: '',
    notes: ['CP-G competitive benchmark'],
  };
}

export function makeFakeInterpreter() {
  let active: FakeInterpretation = emptyInterpretation();
  const fakeLangChain = {
    generateChatResponse: jest.fn(async () => JSON.stringify(active)),
    getProviderMetadata: jest.fn(() => ({
      provider: 'e2e-competitive-interpreter',
      model: 'deterministic-json-v1',
    })),
  };
  return {
    fakeLangChain,
    setInterpretation(next: FakeInterpretation) {
      active = next;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Deterministic Haversine routing (verbatim shape from the scale spec).
 * ------------------------------------------------------------------ */

export function makeFakeRouting() {
  return {
    isAvailable: jest.fn(() => true),
    estimate: jest.fn(
      async (from: any, to: any, allowedModes: TransportationMode[]) => {
        const dLat = to.centroid.lat - from.centroid.lat;
        const dLng = to.centroid.lng - from.centroid.lng;
        const distanceMeters = Math.sqrt(dLat * dLat + dLng * dLng) * 111_000;
        const mode = allowedModes.includes(TransportationMode.WALKING)
          ? TransportationMode.WALKING
          : allowedModes[0];
        const durationMinutes = (distanceMeters / 1000 / 4.8) * 60;
        return {
          mode,
          durationMinutes,
          distanceMeters,
          walkingMinutes:
            mode === TransportationMode.WALKING ? durationMinutes : 0,
          walkingDistanceMeters:
            mode === TransportationMode.WALKING ? distanceMeters : 0,
          approximate: false,
          provider: 'geoapify',
        };
      },
    ),
  };
}
