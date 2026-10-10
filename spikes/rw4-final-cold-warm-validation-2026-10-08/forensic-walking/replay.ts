// READ-ONLY forensic replay (not committed). Reads the rw4-final COLD catalog
// via ExperienceCatalogService (SELECT only), then re-runs the production
// normalizer + GreedyDailyPlanningSolver + feasibility validator with the
// production ResilientTravelEstimateProvider (Geoapify), memoized per pair
// and logged. No DB writes, no production-code changes.
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/node_modules/@nestjs/config';
import { PrismaService } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/core/database/prisma.service';
import { ExperienceCatalogService } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/modules/tours/services/experience-catalog.service';
import { PlanningCandidateNormalizerService } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/modules/tours/services/planning-candidate-normalizer.service';
import { GreedyDailyPlanningSolver } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/modules/tours/services/greedy-daily-planning.solver';
import { TourPlanningFeasibilityValidatorService } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/modules/tours/services/tour-planning-feasibility-validator.service';
import { ResilientTravelEstimateProvider } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/modules/tours/services/resilient-travel-estimate.provider';
import { GeoapifyTravelEstimateProvider } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/modules/tours/services/geoapify-travel-estimate.provider';
import { ApproximateTravelEstimateProvider } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/modules/tours/services/approximate-travel-estimate.provider';
import { placeCandidates } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/modules/tours/utils/daily-planning-placement.util';
import { sortCandidatesDeterministically } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/modules/tours/utils/daily-planning-candidate-sort.util';
import dailyPlanningPolicyConfig from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/modules/tours/config/daily-planning-policy.config';

const OUT = __dirname;
const pool: [string, string, string, number, number][] = JSON.parse(
  fs.readFileSync(path.join(OUT, 'final-pool.json'), 'utf8'),
);

(async () => {
  const config = new ConfigService(process.env as any);
  const policy = dailyPlanningPolicyConfig();
  const prisma = new PrismaService(config);
  const catalog = new ExperienceCatalogService(prisma as any, { getStatus: () => ({ provider: 'none' }) } as any);
  const rows: any[] = await catalog.findVerifiedWithinForMatching(-34.6037, -58.3816, 13420);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const missing = pool.filter(([id]) => !byId.has(id));
  if (missing.length) console.log('MISSING from catalog read', missing);

  const approximate = new ApproximateTravelEstimateProvider(policy as any);
  const resilient = new ResilientTravelEstimateProvider(config, new GeoapifyTravelEstimateProvider(config), approximate);
  const memo = new Map<string, any>();
  const log: any[] = [];
  const provider = {
    async estimate(from: any, to: any, modes: any) {
      const key = `${from.centroid.lat},${from.centroid.lng}|${to.centroid.lat},${to.centroid.lng}|${modes}`;
      if (!memo.has(key)) {
        const est = await resilient.estimate(from, to, modes);
        const approx = await approximate.estimate(from, to, modes);
        memo.set(key, { est, approx });
        log.push({ from: from.centroid, to: to.centroid, est, approx });
      }
      return memo.get(key).est;
    },
  };
  const normalizer = new PlanningCandidateNormalizerService(policy as any);
  const solver = new GreedyDailyPlanningSolver(provider as any, policy as any);
  const validator = new TourPlanningFeasibilityValidatorService();

  const scoreBreakdownById = new Map(pool.map(([id, , , sem, pref]) => [id, { semanticSimilarity: sem, preferenceScore: pref } as any]));
  const preferenceWeightById = new Map(pool.map(([id, , , , pref]) => [id, pref]));
  const normalize = (ids: string[]) =>
    normalizer.normalizeExperiences(ids.map((id) => byId.get(id)), scoreBreakdownById, { preferenceWeightById, mustIncludeExperienceIds: new Set() });
  const base: any = {
    destination: {},
    requestedDays: 1,
    mobility: { allowedTransportationModes: ['walking'], maxWalkingDistancePerDayMeters: 10000, maxContinuousWalkingDistanceMeters: 3000, travelPace: 'moderate', accessibilityNeeds: [] },
    travelPace: 'moderate',
    planningWindow: policy.window,
    startDates: [],
  };
  const label = (id: string) => byId.get(id)?.canonicalName ?? id;
  const report = (name: string, sol: any, cands: any[]) => {
    const v = validator.validate(sol, { ...base, candidates: cands });
    const day = sol.days[0];
    return {
      name,
      dayOrder: day.experiences.map((e: any) => ({
        id: e.experienceId, name: label(e.experienceId), start: e.startMinutesFromMidnight, end: e.endMinutesFromMidnight,
        travelFromPrevious: e.travelFromPrevious,
      })),
      unselected: sol.unselected.map((u: any) => ({ ...u, name: label(u.experienceId) })),
      validator: v,
    };
  };

  // Composite footprints as the planner sees them.
  const [composite] = await normalize(['32656b95-d509-4e0d-afca-af00680b2dd8']);
  const compositeRow = byId.get('32656b95-d509-4e0d-afca-af00680b2dd8');

  // A) Provisional epoch-4 planned set (trace-step-116), replayed on epoch-5 catalog.
  const provisionalIds = ['638f2eeb-00d8-4efc-9983-a45039eaa904', 'c69c9def-0691-4a47-a04f-030932f69465', 'f2476cf1-5419-453e-a634-c68b0e0f8085', '209127e2-a8d8-4470-8ded-3c2a68a654b7', '32656b95-d509-4e0d-afca-af00680b2dd8'].filter((id) => byId.has(id));

  // B) Final planFromSelection promotion loop (initial = SELECTED, reservoir = RESERVOIR in trace order).
  const initialIds = pool.filter((p) => p[2] === 'SELECTED').map((p) => p[0]);
  const reservoirIds = pool.filter((p) => p[2] === 'RESERVOIR').map((p) => p[0]).filter((id) => byId.has(id));
  let admitted = await normalize(initialIds);
  let sol = await solver.solve({ ...base, candidates: admitted });
  const initialReport = report('final-initial-solve', sol, admitted);
  const count = (s: any) => s.days.reduce((n: number, d: any) => n + d.experiences.length, 0);
  const util = (s: any) => s.days.reduce((n: number, d: any) => n + d.utilizationMinutes, 0);
  const promotionLog: any[] = [];
  let admittedIds = [...initialIds];
  for (const id of reservoirIds) {
    const trialIds = [...admittedIds, id];
    const trialCands = await normalize(trialIds);
    const trial = await solver.solve({ ...base, candidates: trialCands });
    const promoted = trial.days.flatMap((d: any) => d.experiences).some((e: any) => e.experienceId === id);
    const progress = count(trial) > count(sol) || util(trial) > util(sol);
    promotionLog.push({ id, name: label(id), promoted, progress, count: count(trial) });
    if (promoted && progress) { sol = trial; admitted = trialCands; admittedIds = trialIds; }
  }
  const finalReport = report('final-after-promotion (relevance-noDegradation check approximated)', sol, admitted);

  const provisionalCands = await normalize(provisionalIds);
  const provisionalSol = await solver.solve({ ...base, candidates: provisionalCands });

  // C) Placement-phase view of the final admitted set (what checkHardConstraints saw).
  const routed = await Promise.all(admitted.map((c: any) => (solver as any).withInternalRouting(c, ['walking'])));
  const sortedForPlacement = sortCandidatesDeterministically(routed, { semanticWeight: policy.scoring.semanticWeight, qualityWeight: policy.scoring.qualityWeight });
  const placementLegs: any[] = [];
  const tracingProvider = { async estimate(f: any, t: any, m: any) { const e = await provider.estimate(f, t, m); placementLegs.push({ from: f.centroid, to: t.centroid, walkingDistanceMeters: e.walkingDistanceMeters }); return e; } };
  const placed = await placeCandidates(sortedForPlacement, 1, { policy, mobility: base.mobility, planningWindow: base.planningWindow, travelEstimateProvider: tracingProvider, startDates: [] } as any);
  const placement = {
    placementOrder: sortedForPlacement.map((c: any) => label(c.experienceId)),
    assignedAppendOrder: [...placed.days.get(1)!.assigned].map((c: any) => label(c.experienceId)),
    compositeMobility: routed.find((c: any) => c.experienceId === '32656b95-d509-4e0d-afca-af00680b2dd8')?.mobility,
    unselected: placed.unselected,
    legsCheckedAtPlacement: placementLegs,
  };
  console.log('PLACEMENT', JSON.stringify(placement, null, 1));
  const out = {
    compositeCatalogComponents: compositeRow.components.map((c: any) => ({ order: c.order, sourcePosition: c.sourcePosition, role: c.role, name: c.name ?? c.geoEntity?.name, lat: c.geoEntity?.latitude ?? c.latitude, lng: c.geoEntity?.longitude ?? c.longitude, geometryType: (c.geoEntity?.geometry ?? c.geometry)?.type })),
    compositePlanner: { spatialFootprint: { type: composite.spatialFootprint.type, centroid: composite.spatialFootprint.centroid }, componentFootprints: composite.componentFootprints?.map((f: any) => ({ type: f.type, centroid: f.centroid })), startFootprint: composite.startFootprint.centroid, endFootprint: composite.endFootprint.centroid },
    otherFootprints: pool.filter(([id]) => byId.has(id)).map(([id, name]) => ({ id, name, start: null })),
    provisional: report('provisional-set', provisionalSol, provisionalCands),
    initialReport,
    promotionLog,
    finalReport,
    placement,
    estimates: log,
  };
  fs.writeFileSync(path.join(OUT, 'replay-output.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ composite: out.compositePlanner, provisional: out.provisional, initialReport, finalReport: { dayOrder: finalReport.dayOrder.map((e: any) => [e.name, e.travelFromPrevious?.walkingDistanceMeters, e.travelFromPrevious?.provider]), validator: finalReport.validator }, estimateCalls: log.length }, null, 1));
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
