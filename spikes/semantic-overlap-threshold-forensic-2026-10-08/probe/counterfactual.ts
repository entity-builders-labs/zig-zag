// Read-only counterfactual probes against the real, unmodified dedupe util.
import {
  compareFingerprints,
  decideExperienceDedupe,
  DedupeExperienceFingerprint,
} from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/modules/tours/utils/experience-dedupe.util';

const m = (g: string | null, name: string, order: number) =>
  g
    ? { geoEntityId: g, sourceName: name, role: 'waypoint', order }
    : { geoEntityId: null, resolutionState: 'UNRESOLVED' as const, sourceName: name, role: 'waypoint', order };
const AF = [m('A', 'Stop A', 1), m('B', 'Stop B', 2), m(null, 'Stop C', 3), m('D', 'Stop D', 4), m(null, 'Stop E', 5), m('F', 'Stop F', 6)];
const AFc = [m('A', 'Stop A', 1), m('B', 'Stop B', 2), m('C', 'Stop C', 3), m('D', 'Stop D', 4), m('E', 'Stop E', 5), m('F', 'Stop F', 6)];
const AB = [m('A', 'Stop A', 1), m('B', 'Stop B', 2)];
const fp = (id: string | undefined, name: string, sem: string[], con: string[], comps: any[]): DedupeExperienceFingerprint => ({
  id, canonicalName: name, semanticTerms: sem, conceptTerms: con, components: comps, provenance: ['web'],
});
const desc = 'An evidenced San Telmo walk';
const show = (label: string, inc: DedupeExperienceFingerprint, ex: DedupeExperienceFingerprint) => {
  const e = compareFingerprints(inc, ex);
  const d = decideExperienceDedupe(inc, [ex]);
  console.log(`${label}\n   n=${e.nameSimilarity.toFixed(3)} s=${e.semanticSimilarity.toFixed(3)} c=${e.componentOverlap.toFixed(3)} r=${e.roleAwareComponentOverlap.toFixed(3)} k=${e.conceptOverlap.toFixed(2)} -> ${d.decision}`);
};

console.log('== Fixture and leave-one-input-out (A-B incoming vs PARTIAL A-F existing)');
show('F0 exact fixture', fp(undefined, 'Walk A-B', [desc, 'history', 'walk'], ['history', 'walk'], AB), fp('x', 'Walk A-B-C-D-E-F', [desc, 'history', 'walk'], ['history', 'walk'], AF));
show('F1 drop description both sides', fp(undefined, 'Walk A-B', ['history', 'walk'], ['history', 'walk'], AB), fp('x', 'Walk A-B-C-D-E-F', ['history', 'walk'], ['history', 'walk'], AF));
show('F2 drop themes/intents both sides', fp(undefined, 'Walk A-B', [desc], [], AB), fp('x', 'Walk A-B-C-D-E-F', [desc], [], AF));
show('F3 names neutral (same token count)', fp(undefined, 'Walk', [desc, 'history', 'walk'], ['history', 'walk'], AB), fp('x', 'Walk', [desc, 'history', 'walk'], ['history', 'walk'], AF));
show('F4 distinct names, same description', fp(undefined, 'Plaza stroll', [desc, 'history', 'walk'], ['history', 'walk'], AB), fp('x', 'Southern barrio circuit', [desc, 'history', 'walk'], ['history', 'walk'], AF));
show('F5 same as F0 but A-F COMPLETE', fp(undefined, 'Walk A-B', [desc, 'history', 'walk'], ['history', 'walk'], AB), fp('x', 'Walk A-B-C-D-E-F', [desc, 'history', 'walk'], ['history', 'walk'], AFc));
show('F6 reverse direction (A-F incoming vs A-B existing)', fp(undefined, 'Walk A-B-C-D-E-F', [desc, 'history', 'walk'], ['history', 'walk'], AF), fp('x', 'Walk A-B', [desc, 'history', 'walk'], ['history', 'walk'], AB));
show('F7 disjoint stops, identical text', fp(undefined, 'Walk A-B', [desc, 'history', 'walk'], ['history', 'walk'], [m('P', 'P', 1), m('Q', 'Q', 2)]), fp('x', 'Walk A-B-C-D-E-F', [desc, 'history', 'walk'], ['history', 'walk'], AF));

console.log('\n== Case-2 style distinct walks (identity spec section 7) with a shared generic description');
const st = [m('s1', 's1', 1), m('s2', 's2', 2), m('s3', 's3', 3), m('s4', 's4', 4)];
const st2 = [m('s1', 's1', 1), m('t2', 't2', 2), m('t3', 't3', 3), m('t4', 't4', 4)];
const g = 'A guided walking tour through historic San Telmo';
show('C1 distinct names, shared generic description, 1/4 shared stop', fp(undefined, 'Immigration History Walk', [g, 'history', 'walk'], ['history', 'walk'], st), fp('x', 'Colonial Architecture Walk', [g, 'history', 'walk'], ['history', 'walk'], st2));

console.log('\n== Input asymmetry: existing side adds relational trait label/key/dimension:key, incoming side does not');
const base = (id: string | undefined, rel: string[]) => fp(id, 'San Telmo Market Walk', ['Market stroll in San Telmo', 'food', 'walk', ...rel], ['food', 'walk'], [m('A', 'A', 1), m('B', 'B', 2), m('C', 'C', 3)]);
const other = (id: string | undefined, rel: string[]) => fp(id, 'San Telmo Antiques Walk', ['Antiques stroll in San Telmo', 'food', 'walk', ...rel], ['food', 'walk'], [m('A', 'A', 1), m('X', 'X', 2), m('Y', 'Y', 3)]);
const rel = ['Local markets', 'local_markets', 'setting:local_markets', 'Street food', 'street_food', 'cuisine:street_food'];
show('S1 X incoming (no relational), Y existing (with relational)', base(undefined, []), other('y', rel));
show('S2 Y incoming (no relational), X existing (with relational)', other(undefined, []), base('x', rel));
show('S3 neither side relational', base(undefined, []), other('y', []));

console.log('\n== Persistence-order dependence: X carries trait rows, Y carries none');
show('O1 X persisted first; Y incoming vs X(existing, relational traits added)', other(undefined, []), base('x', rel));
show('O2 Y persisted first; X incoming (relational traits omitted) vs Y(existing)', base(undefined, []), other('y', []));
