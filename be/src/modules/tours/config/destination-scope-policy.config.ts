import { registerAs } from '@nestjs/config';

export interface DestinationScopePolicy {
  /** Explicit product policy for a selected point destination. */
  pointRadiusMeters: number;
}

export default registerAs(
  'destinationScopePolicy',
  (): DestinationScopePolicy => ({
    pointRadiusMeters: Number(
      process.env.DESTINATION_POINT_RADIUS_METERS ?? 25_000,
    ),
  }),
);
