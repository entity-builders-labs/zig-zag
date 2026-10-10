import { execSync } from 'child_process';
import * as path from 'path';

export type BoundaryKind =
  | 'none'
  | 'polygon'
  | 'polygon-hole'
  | 'multipolygon'
  | 'linestring';

export interface CompositeFixtureOptions {
  ownerEmail: string;
  boundaryKind?: BoundaryKind;
  simulateLaterEdit?: boolean;
  waypointCount?: 2 | 3;
}

export interface CompositeFixture {
  tourId: string;
  tourActivityId: string;
  variantId: string;
  areaId: string;
  familyId: string;
  waypointIds: string[];
  liveWaypointIdsAfterEdit?: string[];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Spawns the backend's `seed-e2e-composite` CLI command (see
 * be/src/commands/scripts/commands/seed-e2e-composite.command.ts) to create
 * a tour with a composite stop directly via Prisma — there's deliberately no
 * HTTP endpoint for this (see CompositeActivityService's module doc), same
 * as be/prisma/seed.ts bypassing normal app flows for seeding. Requires the
 * backend's own env (DATABASE_URL, USE_MOCK_MAPS, etc) to be resolvable the
 * same way `yarn script ...` resolves it when run manually from be/.
 */
export function seedCompositeFixture(
  options: CompositeFixtureOptions
): CompositeFixture {
  const beDir = path.resolve(__dirname, '../../be');
  const args = [`--owner-email=${shellQuote(options.ownerEmail)}`];
  if (options.boundaryKind) {
    args.push(`--boundary-kind=${shellQuote(options.boundaryKind)}`);
  }
  if (options.simulateLaterEdit) {
    args.push('--simulate-later-edit');
  }
  if (options.waypointCount) {
    args.push(`--waypoint-count=${options.waypointCount}`);
  }

  const output = execSync(`yarn script seed-e2e-composite ${args.join(' ')}`, {
    cwd: beDir,
    encoding: 'utf8',
    timeout: 30_000,
  });

  const line = output
    .split('\n')
    .find((l) => l.startsWith('E2E_FIXTURE_JSON:'));
  if (!line) {
    throw new Error(
      `seed-e2e-composite did not print E2E_FIXTURE_JSON — full output:\n${output}`
    );
  }
  return JSON.parse(line.replace('E2E_FIXTURE_JSON:', ''));
}
