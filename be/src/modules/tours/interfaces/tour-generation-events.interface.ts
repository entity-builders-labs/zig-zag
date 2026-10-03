export interface TourGenerationRequestedPayload {
  /** Stable business idempotency key for this tour generation request. */
  eventKey: string;
  tourId: string;
  userId?: string;
  requestedAt: string;
}
