// READ-ONLY replay of the selected composite's internal walking, which the
// solver computes (withInternalRouting) but does not persist. Reads the
// catalog row (SELECT only), normalizes it with the production normalizer,
// and routes consecutive componentFootprints with the production
// Resilient(Geoapify → approximate) provider. No DB writes, no code changes.
//
//   cd be && set -a && source ../.env && set +a &&
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<db> \
//   EXPERIENCE_ID=<id> npx ts-node --transpile-only <this file>
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../be/src/core/database/prisma.service';
import { ExperienceCatalogService } from '../../../be/src/modules/tours/services/experience-catalog.service';
import { PlanningCandidateNormalizerService } from '../../../be/src/modules/tours/services/planning-candidate-normalizer.service';
import { ResilientTravelEstimateProvider } from '../../../be/src/modules/tours/services/resilient-travel-estimate.provider';
import { GeoapifyTravelEstimateProvider } from '../../../be/src/modules/tours/services/geoapify-travel-estimate.provider';
import { ApproximateTravelEstimateProvider } from '../../../be/src/modules/tours/services/approximate-travel-estimate.provider';
import dailyPlanningPolicyConfig from '../../../be/src/modules/tours/config/daily-planning-policy.config';

(async () => {
  const id = process.env.EXPERIENCE_ID!;
  const config = new ConfigService(process.env as any);
  const policy = dailyPlanningPolicyConfig();
  const prisma = new PrismaService(config);
  const catalog = new ExperienceCatalogService(prisma as any, { getStatus: () => ({ provider: 'none' }) } as any);
  const rows: any[] = await catalog.findVerifiedWithinForMatching(-34.6037, -58.3816, 13420);
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`experience ${id} not in catalog read`);
  const normalizer = new PlanningCandidateNormalizerService(policy as any);
  const [candidate] = await normalizer.normalizeExperiences([row], new Map(), {
    preferenceWeightById: new Map(),
    mustIncludeExperienceIds: new Set(),
  } as any);
  const approximate = new ApproximateTravelEstimateProvider(policy as any);
  const resilient = new ResilientTravelEstimateProvider(config, new GeoapifyTravelEstimateProvider(config), approximate);
  const footprints = candidate.componentFootprints ?? [];
  const legs: any[] = [];
  for (let i = 1; i < footprints.length; i++) {
    const est = await resilient.estimate(footprints[i - 1], footprints[i], ['walking'] as any);
    legs.push({ from: footprints[i - 1].centroid, to: footprints[i].centroid, walkingDistanceMeters: est.walkingDistanceMeters, walkingMinutes: est.walkingMinutes, provider: est.provider, approximate: est.approximate });
  }
  const out = {
    experienceId: id,
    canonicalName: row.canonicalName,
    durationMinutes: row.durationMinutes ?? null,
    plannerDurationMinutes: candidate.durationMinutes,
    componentFootprintCount: footprints.length,
    legs,
    internalWalkingDistanceMeters: legs.reduce((s, l) => s + l.walkingDistanceMeters, 0),
    maxInternalContinuousWalkingDistanceMeters: Math.max(0, ...legs.map((l) => l.walkingDistanceMeters)),
    internalWalkingMinutes: legs.reduce((s, l) => s + l.walkingMinutes, 0),
  };
  console.log(JSON.stringify(out, null, 1));
  await prisma.$disconnect();
})();
