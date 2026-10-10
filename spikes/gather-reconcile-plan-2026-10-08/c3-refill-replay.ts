// READ-ONLY replay of the C3 post-refill composition against the run DB.
// No writes, no external providers (local Ollama query embedding only).
import '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/node_modules/dotenv/config';
import { ConfigService } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/node_modules/@nestjs/config';
import { PrismaService } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/core/database/prisma.service';
import { ExperienceCatalogService } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/modules/tours/services/experience-catalog.service';
import { ExperienceCompositionService } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/modules/tours/services/experience-composition.service';
import { ExperienceVectorStoreService } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/shared/ai/services/experience-vector-store.service';
import { AiEmbeddingService } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/shared/ai/services/ai-embedding.service';
import aiConfig from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/shared/ai/ai.config';
import { buildPreferenceSpec } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/modules/tours/utils/preference-spec-builder.util';
import { filterOverlappingExperienceCandidates } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/modules/tours/utils/candidate-overlap-filter.util';

const RUN = '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/spikes/rw4-functional-composite-campaign-2026-10-05/c3-partial-cold';
const AG = '42211eec';
const SOB = '03e3222c';
const tag = (id: string) => (id.startsWith(AG) ? 'AG' : id.startsWith(SOB) ? 'SOB' : '');

(async () => {
  const trace = require(`${RUN}/generation-trace.json`);
  const request = require(`${RUN}/request.json`);
  const interp = trace.steps.find((s: any) => s.name === 'preference.interpretation');
  const spec = buildPreferenceSpec(
    { contractVersion: 1, ...request, intent: request.intent } as any,
    interp.output.intent,
  );
  const prisma = new PrismaService(new ConfigService({}));
  const catalog = new ExperienceCatalogService(prisma as any, { getStatus: () => ({ provider: 'none' }) } as any);
  const embedding = new AiEmbeddingService(aiConfig() as any);
  await embedding.onModuleInit();
  const composition = new ExperienceCompositionService(new ExperienceVectorStoreService(embedding, prisma as any));

  // Initial window: area bbox circle (catalog-visibility used 13420 m); refill window: request point + 25 km.
  const initialWindow = await catalog.findVerifiedWithin(-34.6037, -58.3816, 13420, 250);
  const refillWindow = await catalog.findVerifiedWithin(request.destination.latitude, request.destination.longitude, 25000, 250);
  const union = new Map<string, any>();
  [...initialWindow, ...refillWindow].forEach((e: any) => union.set(e.id, e));
  console.log('windows', initialWindow.length, refillWindow.length, 'union', union.size,
    'AG in refill window', refillWindow.some((e: any) => e.id.startsWith(AG)),
    'SOB in refill window', refillWindow.some((e: any) => e.id.startsWith(SOB)));

  const out = await composition.compose({ experiences: [...union.values()], preferenceSpec: spec, resolvedVenueMustIds: [] });
  console.log('semantic', out.semanticRanking.status, out.semanticRanking.indexedCandidateCount, '/', out.semanticRanking.requestedCandidateCount);
  const show = (label: string, ids: string[]) =>
    console.log(label, ids.map((id, i) => `${i}:${id.slice(0, 8)}${tag(id) ? '(' + tag(id) + ')' : ''} w=${(out.preferenceWeightById.get(id) ?? 0).toFixed(2)} sim=${out.semanticSimilarityById.get(id)?.toFixed(3) ?? 'n/a'}`).join(' | '));
  show('SELECTED ', out.result.selected);
  show('RESERVOIR', out.result.reservoir.slice(0, 20));
  for (const id of [...union.keys()].filter((id) => tag(id))) {
    const e = union.get(id);
    console.log(tag(id), id, 'navigable', e.components.length, 'selected?', out.result.selected.includes(id), 'reservoirIdx', out.result.reservoir.indexOf(id));
  }
  // Overlap filter as the orchestrator feeds it: AG offered first (pre-refill), SOB later.
  const order = [...out.result.selected, ...out.result.reservoir].map((id) => union.get(id));
  const agFirst = [union.get([...union.keys()].find((k) => k.startsWith(AG))!), ...order.filter((e) => !e.id.startsWith(AG))];
  const sobFirst = [union.get([...union.keys()].find((k) => k.startsWith(SOB))!), ...order.filter((e) => !e.id.startsWith(SOB))];
  for (const [label, input] of [['AG-first', agFirst], ['SOB-first', sobFirst]] as const) {
    const res = filterOverlappingExperienceCandidates(input.map((e: any) => ({ ...e, weightedPreferenceCoverage: out.preferenceWeightById.get(e.id) })));
    console.log('overlap', label, 'excluded', res.excluded.map((x) => `${x.id.slice(0, 8)}${tag(x.id) ? '(' + tag(x.id) + ')' : ''}→${x.overlapsWith.slice(0, 8)}`).join(', '));
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
