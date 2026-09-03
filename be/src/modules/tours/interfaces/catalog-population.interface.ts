export interface CatalogPopulationScope {
  label: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface CreateCatalogPopulationJobRequest {
  idempotencyKey: string;
  requestedById: string;
  scope: CatalogPopulationScope;
  themes: string[];
  intents?: string[];
  maxCandidates?: number;
}

export interface CatalogPopulationRequestedPayload {
  jobId: string;
  eventKey: string;
}

export const CATALOG_POPULATION_STATUS = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  RETRYABLE: 'RETRYABLE',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export type CatalogPopulationStatus =
  (typeof CATALOG_POPULATION_STATUS)[keyof typeof CATALOG_POPULATION_STATUS];
