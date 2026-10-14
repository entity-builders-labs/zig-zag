"""G-P7-U.A — preference-utility encoding: reference orderings evaluated on curated scenarios.

Pure stdlib, deterministic. Usage: python3 -I encoding.py  -> ../runs/encoding.json

Every policy is a way to ORDER the eligible Experiences of ONE request by preference. No policy here
introduces a coefficient; the two "current_*" policies reproduce the live code (with its constants) so
the defects can be measured, and "const_half" exists only to show why a fixed neutral value fails.
Weights are summed exactly (Fraction of the decimal string) so that ties are real ties, not float noise.
"""
import itertools
import json
import os
import statistics
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'runs', 'encoding.json')

# ---------------------------------------------------------------- request / candidate model


def F(x):
    return Fraction(str(x))


def facet(key, source, importance=1.0, confidence=1.0, provenance=None):
    """RequestedFacet as buildPreferenceSpec emits it: wizard = 1.0 x 1.0; free text = importance x confidence,
    importance from the interpreter's strength (strong 1.0 / medium 0.7 / weak 0.5, mapStrengthToImportance).
    provenance (owner rule 2026-10-14, PROVENANCE-1): wizard = DIRECT by construction; a free-text facet is DIRECT
    only when its quoted excerpt maps to the key through the versioned vocabulary/aliases, else INFERRED. The
    scenario states it; characterization/provenance-rule.characterization.spec.ts derives it on the live
    vocabulary for the owner's examples."""
    if source == 'wizard':
        assert provenance in (None, 'DIRECT')
        provenance = 'DIRECT'
    assert provenance in ('DIRECT', 'INFERRED')
    return {'key': key, 'source': source, 'importance': F(importance), 'confidence': F(confidence),
            'weight': F(importance) * F(confidence), 'provenance': provenance}


def cand(cid, matched=(), sim=None, quality=None, hard_excluded=False, access=None, anchor=False):
    """matched = requested facet keys this Experience STRONGLY matches (isStrongFacetMatch);
    sim = cosine similarity or None (UNKNOWN); quality = 0..5 or None (UNKNOWN);
    access = {need: 'YES'|'NO'|'UNKNOWN'} canonical accessibility facts (none exist in the schema today);
    anchor = the Experience resolves a SOFT venue anchor the user named (resolvedVenueSoftIds)."""
    return {'id': cid, 'matched': set(matched), 'sim': sim, 'quality': quality,
            'hard_excluded': hard_excluded, 'access': access or {}, 'anchor': anchor}


def eligible(req, cands):
    """Hard eligibility precedes utility: hard exclusions and accessibility NEEDS. UNKNOWN never satisfies a need."""
    out = []
    for c in cands:
        if c['hard_excluded']:
            continue
        if any(c['access'].get(n, 'UNKNOWN') != 'YES' for n in req.get('accessibility_needs', ())):
            continue
        out.append(c)
    return out


def dedupe_by_weight(facets):
    """Live dedupeFacetsByHighestEffectiveWeight: one facet per key, highest weight wins, first wins a tie."""
    best = {}
    for f in facets:
        if f['key'] not in best or f['weight'] > best[f['key']]['weight']:
            best[f['key']] = f
    return list(best.values())


def dedupe_by_provenance(facets):
    """Proposed: one facet per key, the highest provenance class wins (DIRECT over INFERRED), then the highest
    weight within that class. A same-key INFERRED facet never displaces, and never lends weight to, a DIRECT one."""
    rank = {'DIRECT': 1, 'INFERRED': 0}
    best = {}
    for f in facets:
        cur = best.get(f['key'])
        if cur is None or (rank[f['provenance']], f['weight']) > (rank[cur['provenance']], cur['weight']):
            best[f['key']] = f
    return list(best.values())


def wsum(facets, c, source=None, provenance=None, weight='weight'):
    return sum((f[weight] for f in facets if f['key'] in c['matched']
                and (source is None or f['source'] == source)
                and (provenance is None or f['provenance'] == provenance)), Fraction(0))


# ---------------------------------------------------------------- explicit-affinity encodings

# name -> (dedupe, explicit tuple). Every tuple is compared lexicographically, larger first.
EXPLICIT = {
    'E0_count': (dedupe_by_weight, lambda fs, c: (len(c['matched'] & {f['key'] for f in fs}),)),
    # canonical Preference-First weighted coverage (design 2026-09-10 §12.4, preferenceWeightForExperience)
    'E1_sum': (dedupe_by_weight, lambda fs, c: (wsum(fs, c),)),
    # UI-channel-tiered: wizard selections first, then free-text weight. REJECTED by the owner (2026-10-14, Q1):
    # the capture channel is not an authority tier. Kept as evaluated evidence only.
    'E2_source_tier': (dedupe_by_weight, lambda fs, c: (wsum(fs, c, 'wizard'), wsum(fs, c, 'free_text'))),
    # Owner rule (2026-10-14, confirmed with two adjustments): DIRECT evidence, then INFERRED evidence, then soft
    # venue-anchor affinity. Within DIRECT the weight is the user's stated importance only: interpreter confidence
    # never reduces a facet once deterministic validation has established DIRECT, and the channel is irrelevant.
    # Within INFERRED the canonical importance x confidence stays. No new coefficient.
    'P_prov': (dedupe_by_provenance,
               lambda fs, c: (wsum(fs, c, provenance='DIRECT', weight='importance'),
                              wsum(fs, c, provenance='INFERRED'), int(c['anchor']))),
    # P_prov over the LIVE dedupe (highest weight wins regardless of provenance): shows the dedupe must change too.
    'P_prov_live_dedupe': (dedupe_by_weight,
                           lambda fs, c: (wsum(fs, c, provenance='DIRECT', weight='importance'),
                                          wsum(fs, c, provenance='INFERRED'), int(c['anchor']))),
    # Rejected by the owner (decision 2): interpreter confidence also discounts DIRECT evidence.
    'P_prov_confidence_in_direct': (dedupe_by_provenance,
                                    lambda fs, c: (wsum(fs, c, provenance='DIRECT'), wsum(fs, c, provenance='INFERRED'),
                                                   int(c['anchor']))),
}

# ---------------------------------------------------------------- UNKNOWN handling for a nullable signal


def neutral_key(values, rule):
    """Returns f(value_or_None) -> sortable key for one explicit tier, or None when the signal is skipped."""
    known = [v for v in values if v is not None]
    if rule == 'zero':
        return lambda v: F(0) if v is None else F(v)
    if rule == 'lower_tier':
        return lambda v: (0, F(0)) if v is None else (1, F(v))
    if rule == 'const_half':
        return lambda v: F('0.5') if v is None else F(v)
    if rule == 'tier_skip':
        if any(v is None for v in values) or not known:
            return None
        return lambda v: F(v)
    if rule == 'median':
        if not known:
            return None
        m = statistics.median(F(v) for v in known)
        return lambda v: m if v is None else F(v)
    raise ValueError(rule)


def lexicographic(explicit, sem_rule, q_rule):
    """Total preorder: explicit tuple, then semantic (UNKNOWN per sem_rule, within the explicit tier),
    then generic quality (UNKNOWN per q_rule, within the same tier), then stable id."""
    dedupe, encode = EXPLICIT[explicit]

    def order(req, cands):
        fs = dedupe(req['facets'])
        ex = {c['id']: encode(fs, c) for c in cands}
        tiers = {}
        for c in cands:
            tiers.setdefault(ex[c['id']], []).append(c)
        keys = {}
        for tier, members in tiers.items():
            sk = neutral_key([m['sim'] for m in members], sem_rule) if req.get('semantic_query', True) else None
            qk = neutral_key([m['quality'] for m in members], q_rule) if q_rule else None
            for m in members:
                keys[m['id']] = (tier, sk(m['sim']) if sk else 0, qk(m['quality']) if qk else 0)
        # descending on preference, ascending id as the deterministic tie-break
        return sorted(cands, key=lambda c: (_neg(keys[c['id']]), c['id']))
    return order


def _neg(t):
    if isinstance(t, tuple):
        return tuple(_neg(x) for x in t)
    return -t


def current_planner(req, cands):
    """Live planner: plannerRelevanceScore = 1*semanticScore + preferenceWeight + 0.5*quality/5,
    semanticScore = similarity ?? 0, quality ?? 0 (daily-planning-candidate-sort.util.ts, normalizer)."""
    fs = dedupe_by_weight(req['facets'])

    def score(c):
        return F(c['sim'] or 0) + wsum(fs, c) + F('0.5') * F(c['quality'] or 0) / 5
    return sorted(cands, key=lambda c: (-score(c), c['id']))


def current_composition_remainder(req, cands):
    """Live composeSet remainder order: sum(weight) desc, semanticSimilarity (missing -> 0 in the service), quality
    (null -> -Infinity), soft-anchor boost, id (composition-set-cover.util.ts byRemainderPriority)."""
    fs = dedupe_by_weight(req['facets'])
    return sorted(cands, key=lambda c: (-wsum(fs, c), -F(c['sim'] or 0),
                                        -(F(c['quality']) if c['quality'] is not None else F(-10 ** 9)),
                                        -int(c['anchor']), c['id']))


def pairwise_skip_cmp(req, a, b):
    """'Semantic breaks ties only when both are known, else fall through' as a pairwise comparator."""
    dedupe, encode = EXPLICIT['P_prov']
    fs = dedupe(req['facets'])
    ea, eb = encode(fs, a), encode(fs, b)
    if ea != eb:
        return 1 if ea > eb else -1
    if a['sim'] is not None and b['sim'] is not None and a['sim'] != b['sim']:
        return 1 if a['sim'] > b['sim'] else -1
    qa, qb = a['quality'], b['quality']
    if qa is not None and qb is not None and qa != qb:
        return 1 if qa > qb else -1
    return 0 if a['id'] == b['id'] else (1 if a['id'] < b['id'] else -1)


POLICIES = {
    'current_planner_additive': current_planner,
    'current_composition_remainder': current_composition_remainder,
    'E1_sum+median+median': lexicographic('E1_sum', 'median', 'median'),
    'E2_tier+zero+zero': lexicographic('E2_source_tier', 'zero', 'zero'),
    'E2_tier+lower_tier+median': lexicographic('E2_source_tier', 'lower_tier', 'median'),
    'E2_tier+const_half+median': lexicographic('E2_source_tier', 'const_half', 'median'),
    'E2_tier+tier_skip+median': lexicographic('E2_source_tier', 'tier_skip', 'median'),
    'E0_count+median+median': lexicographic('E0_count', 'median', 'median'),
    'E2_tier+median+median': lexicographic('E2_source_tier', 'median', 'median'),
    'P_prov+zero+zero': lexicographic('P_prov', 'zero', 'zero'),
    'P_prov+tier_skip+median': lexicographic('P_prov', 'tier_skip', 'median'),
    'P_prov_live_dedupe+median+median': lexicographic('P_prov_live_dedupe', 'median', 'median'),
    'P_prov_confidence_in_direct+median+median': lexicographic('P_prov_confidence_in_direct', 'median', 'median'),
    'P_prov+median+median': lexicographic('P_prov', 'median', 'median'),
}

# ---------------------------------------------------------------- scenarios (product vocabulary)
# Expectations are written from the stated product semantics, BEFORE looking at any policy's output:
#   ('>', a, b)        a must rank above b
#   ('absent', a)      a must not reach utility derivation (hard eligibility)
#   ('not_last', u, peers) / ('not_first', u, peers)   UNKNOWN evidence is neither punished nor rewarded
#   ('stable_known', u)   adding UNKNOWN candidate u must not change the relative order of the others

W = lambda k: facet(k, 'wizard')                                          # noqa: E731  DIRECT by construction
FTD = lambda k, imp, conf: facet(k, 'free_text', imp, conf, 'DIRECT')      # noqa: E731  excerpt maps via vocabulary
FTI = lambda k, imp, conf: facet(k, 'free_text', imp, conf, 'INFERRED')    # noqa: E731  needs inference

SCENARIOS = [
    {'id': 'A1', 'title': 'explicit beats semantic — architecture + history (wizard)',
     'req': {'facets': [W('history'), W('architecture')]},
     'cands': [cand('A', {'history', 'architecture'}, .60, 3.5), cand('B', {'history'}, .98, 5.0), cand('C', (), .99, 5.0)],
     'expect': [('>', 'A', 'B'), ('>', 'A', 'C'), ('>', 'B', 'C')]},
    {'id': 'A2', 'title': 'explicit beats semantic — "historia y arquitectura" (free text DIRECT, medium, confidence 0.6)',
     'req': {'facets': [FTD('history', .7, .6), FTD('architecture', .7, .6)]},
     'cands': [cand('A', {'history', 'architecture'}, .60, 3.5), cand('B', {'history'}, .98, 5.0), cand('C', (), .99, 5.0)],
     'expect': [('>', 'A', 'B'), ('>', 'A', 'C'), ('>', 'B', 'C')]},
    {'id': 'B1', 'title': 'semantic refines equal explicit affinity — modern art',
     'req': {'facets': [W('modern_art')]},
     'cands': [cand('A', {'modern_art'}, .71, 3.2), cand('B', {'modern_art'}, .44, 4.8)],
     'expect': [('>', 'A', 'B')]},
    {'id': 'B2', 'title': 'semantic refines before quality (small semantic gap, large quality gap) — modern art',
     'req': {'facets': [W('modern_art')]},
     'cands': [cand('A', {'modern_art'}, .48, 3.2), cand('B', {'modern_art'}, .44, 4.8)],
     'expect': [('>', 'A', 'B')]},
    {'id': 'C1', 'title': 'missing embedding is neutral — food and markets',
     'req': {'facets': [W('food'), W('markets')]},
     'cands': [cand('K1', {'food', 'markets'}, .62, 4.0), cand('K2', {'food', 'markets'}, .41, 4.2),
               cand('K3', {'food', 'markets'}, .30, 3.6), cand('U', {'food', 'markets'}, None, 4.5)],
     'expect': [('>', 'K1', 'K2'), ('>', 'K2', 'K3'), ('not_last', 'U', ['K1', 'K2', 'K3']),
                ('not_first', 'U', ['K1', 'K2', 'K3']), ('stable_known', 'U')]},
    {'id': 'C2', 'title': 'missing embedding never outranks stronger explicit evidence — food and markets',
     'req': {'facets': [W('food'), W('markets')]},
     'cands': [cand('K', {'food'}, .95, 4.9), cand('U', {'food', 'markets'}, None, 3.1)],
     'expect': [('>', 'U', 'K')]},
    {'id': 'C3', 'title': 'missing embedding is neutral on a low-range cosine model — food and markets',
     'req': {'facets': [W('food'), W('markets')]},
     'cands': [cand('K1', {'food', 'markets'}, .33, 4.0), cand('K2', {'food', 'markets'}, .24, 4.2),
               cand('K3', {'food', 'markets'}, .18, 3.6), cand('U', {'food', 'markets'}, None, 4.5)],
     'expect': [('>', 'K1', 'K2'), ('>', 'K2', 'K3'), ('not_last', 'U', ['K1', 'K2', 'K3']),
                ('not_first', 'U', ['K1', 'K2', 'K3']), ('stable_known', 'U')]},
    {'id': 'D1', 'title': 'quality is tertiary — family-friendly + "parques" (no semantic query)',
     'req': {'facets': [W('family_friendly'), FTD('parks', 1.0, .9)], 'semantic_query': False},
     'cands': [cand('A', {'family_friendly', 'parks'}, None, 3.1), cand('B', {'family_friendly'}, None, 4.9),
               cand('C', {'family_friendly'}, None, 4.0)],
     'expect': [('>', 'A', 'B'), ('>', 'A', 'C'), ('>', 'B', 'C')]},
    # ---- mixed-source cases: the channel is not an authority tier; provenance is.
    {'id': 'E1d', 'title': 'wizard pick vs four weak DIRECT free-text facets — same class, weighted coverage decides (4 x 0.30 > 1.0)',
     'req': {'facets': [W('history'), FTD('street_art', .5, .6), FTD('cafes', .5, .6), FTD('bookshops', .5, .6), FTD('parks', .5, .6)]},
     'cands': [cand('A', {'history'}, .50, 4.0), cand('B', {'street_art', 'cafes', 'bookshops', 'parks'}, .80, 4.5)],
     'expect': [('>', 'B', 'A')]},
    {'id': 'E1i', 'title': 'wizard pick vs four weak INFERRED free-text facets ("algo bohemio") — DIRECT outranks any INFERRED sum',
     'req': {'facets': [W('history'), FTI('street_art', .5, .6), FTI('cafes', .5, .6), FTI('bookshops', .5, .6), FTI('parks', .5, .6)]},
     'cands': [cand('A', {'history'}, .50, 4.0), cand('B', {'street_art', 'cafes', 'bookshops', 'parks'}, .80, 4.5)],
     'expect': [('>', 'A', 'B')]},
    {'id': 'E2d', 'title': 'wizard pick vs "me encanta la arquitectura y el arte" (two confident DIRECT facets) — 1.9 > 1.0',
     'req': {'facets': [W('history'), FTD('architecture', 1.0, .95), FTD('modern_art', 1.0, .95)]},
     'cands': [cand('A', {'history'}, .50, 4.0), cand('B', {'architecture', 'modern_art'}, .50, 4.0)],
     'expect': [('>', 'B', 'A')]},
    {'id': 'E2i', 'title': 'wizard pick vs "los edificios de Gaudí y el MALBA" (two confident INFERRED facets)',
     'req': {'facets': [W('history'), FTI('architecture', 1.0, .95), FTI('modern_art', 1.0, .95)]},
     'cands': [cand('A', {'history'}, .50, 4.0), cand('B', {'architecture', 'modern_art'}, .50, 4.0)],
     'expect': [('>', 'A', 'B')]},
    {'id': 'E3', 'title': 'stated importance, not count — strong museums + medium markets (1.7) vs three weak DIRECT facets (1.5)',
     'req': {'facets': [FTD('museums', 1.0, .9), FTD('markets', .7, .9), FTD('cafes', .5, .9), FTD('parks', .5, .9),
                        FTD('bookshops', .5, .9)]},
     'cands': [cand('A', {'museums', 'markets'}, .40, 4.0), cand('B', {'cafes', 'parks', 'bookshops'}, .40, 4.0)],
     'expect': [('>', 'A', 'B')]},
    {'id': 'K1', 'title': 'confidence is not provenance — weak low-confidence DIRECT vs strong high-confidence INFERRED',
     'req': {'facets': [FTD('history', .5, .5), FTI('architecture', 1.0, .95)]},
     'cands': [cand('A', {'history'}, .30, 3.5), cand('B', {'architecture'}, .90, 4.9)],
     'expect': [('>', 'A', 'B')]},
    {'id': 'K2', 'title': 'same key DIRECT (weak) and INFERRED (strong) — DIRECT survives dedupe ("algo de historia" + "la ESMA")',
     'req': {'facets': [FTD('history', .7, .9), FTI('history', 1.0, .95), FTD('architecture', .5, .6)]},
     'cands': [cand('A', {'history'}, .40, 4.0), cand('B', {'architecture'}, .40, 4.0)],
     'expect': [('>', 'A', 'B')]},
    {'id': 'K3a', 'title': 'channel neutrality — wizard history vs certain DIRECT free-text architecture (confidence 1.0): semantic decides',
     'req': {'facets': [W('history'), FTD('architecture', 1.0, 1.0)]},
     'cands': [cand('X', {'history'}, .50, 4.0), cand('Y', {'architecture'}, .70, 4.0)],
     'expect': [('>', 'Y', 'X')]},
    {'id': 'K3b', 'title': 'channel neutrality — K3a with the channels swapped gives the same order',
     'req': {'facets': [FTD('history', 1.0, 1.0), W('architecture')]},
     'cands': [cand('X', {'history'}, .50, 4.0), cand('Y', {'architecture'}, .70, 4.0)],
     'expect': [('>', 'Y', 'X')]},
    {'id': 'K4', 'title': 'confidence never discounts DIRECT — wizard history vs strong DIRECT free-text architecture at confidence 0.6: same authority, semantic decides',
     'req': {'facets': [W('history'), FTD('architecture', 1.0, .6)]},
     'cands': [cand('X', {'history'}, .50, 4.0), cand('Y', {'architecture'}, .70, 4.0)],
     'expect': [('>', 'Y', 'X')]},
    {'id': 'K5', 'title': 'confidence still matters within INFERRED — strong INFERRED at 0.9 vs strong INFERRED at 0.5',
     'req': {'facets': [FTI('history', 1.0, .9), FTI('architecture', 1.0, .5)]},
     'cands': [cand('A', {'history'}, .40, 4.0), cand('B', {'architecture'}, .80, 4.0)],
     'expect': [('>', 'A', 'B')]},
    # ---- soft venue anchors: after INFERRED evidence, before semantic similarity.
    {'id': 'J1', 'title': 'soft anchor never outranks DIRECT evidence',
     'req': {'facets': [W('history')]},
     'cands': [cand('A', {'history'}, .30, 3.5), cand('S', (), .95, 4.9, anchor=True)],
     'expect': [('>', 'A', 'S')]},
    {'id': 'J2', 'title': 'soft anchor never outranks INFERRED evidence',
     'req': {'facets': [FTI('history', 1.0, .8)]},
     'cands': [cand('A', {'history'}, .30, 3.5), cand('S', (), .95, 4.9, anchor=True)],
     'expect': [('>', 'A', 'S')]},
    {'id': 'J3', 'title': 'soft anchor outranks semantic similarity and quality at equal facet evidence',
     'req': {'facets': [W('food')]},
     'cands': [cand('A', {'food'}, .90, 4.9), cand('S', {'food'}, .40, 3.5, anchor=True)],
     'expect': [('>', 'S', 'A')]},
    {'id': 'F1', 'title': 'hard exclusion — local neighbourhoods avoiding churches',
     'req': {'facets': [W('local_neighbourhoods')]},
     'cands': [cand('CH', {'local_neighbourhoods'}, .95, 4.8, hard_excluded=True), cand('N', {'local_neighbourhoods'}, .40, 3.5)],
     'expect': [('absent', 'CH')]},
    {'id': 'G1', 'title': 'accessibility NEED (wheelchair) — UNKNOWN fails eligibility',
     'req': {'facets': [W('museums')], 'accessibility_needs': ['wheelchair']},
     'cands': [cand('X', {'museums'}, .50, 4.0, access={'wheelchair': 'YES'}), cand('Y', {'museums'}, .90, 4.9),
               cand('Z', {'museums'}, .70, 4.5, access={'wheelchair': 'NO'})],
     'expect': [('absent', 'Y'), ('absent', 'Z')]},
    {'id': 'G2', 'title': 'accessibility PREFERENCE — every candidate stays eligible',
     'req': {'facets': [W('museums')]},
     'cands': [cand('X', {'museums'}, .50, 4.0, access={'wheelchair': 'YES'}), cand('Y', {'museums'}, .90, 4.9)],
     'expect': [('>', 'Y', 'X')]},
    {'id': 'H1', 'title': 'no embeddings at all (provider unavailable) — architecture + history',
     'req': {'facets': [W('history'), W('architecture')]},
     'cands': [cand('A', {'history', 'architecture'}, None, 3.5), cand('B', {'history'}, None, 4.9),
               cand('C', {'history'}, None, 4.0), cand('D', (), None, 5.0)],
     'expect': [('>', 'A', 'B'), ('>', 'B', 'C'), ('>', 'C', 'D')]},
    {'id': 'I1', 'title': 'no explicit facets — "quiet green spaces with views" (semantic leads, quality follows)',
     'req': {'facets': []},
     'cands': [cand('P', (), .55, 3.0), cand('Q', (), .31, 4.9), cand('R', (), None, 4.0), cand('S', (), None, None)],
     'expect': [('>', 'P', 'Q'), ('not_last', 'R', ['P', 'Q']), ('not_first', 'R', ['P', 'Q'])]},
]


def check(order_fn, sc):
    req = sc['req']
    elig = eligible(req, sc['cands'])
    ranked = [c['id'] for c in order_fn(req, elig)]
    pos = {cid: i for i, cid in enumerate(ranked)}
    results = []
    for e in sc['expect']:
        kind = e[0]
        if kind == '>':
            ok = e[1] in pos and e[2] in pos and pos[e[1]] < pos[e[2]]
        elif kind == 'absent':
            ok = e[1] not in pos
        elif kind == 'not_last':
            ok = any(pos[e[1]] < pos[p] for p in e[2])
        elif kind == 'not_first':
            ok = any(pos[e[1]] > pos[p] for p in e[2])
        elif kind == 'stable_known':
            without = [c['id'] for c in order_fn(req, [c for c in elig if c['id'] != e[1]])]
            ok = [x for x in ranked if x != e[1]] == without
        else:
            raise ValueError(kind)
        results.append({'expect': list(map(str, e)), 'pass': ok})
    return ranked, results


# ---------------------------------------------------------------- structural demonstrations


def pairwise_skip_cycle():
    """A comparator that skips semantics when either side is UNKNOWN is not transitive -> not a valid order."""
    req = {'facets': [W('food')]}
    cs = [cand('A', {'food'}, None, 3.0), cand('B', {'food'}, .90, 2.0), cand('C', {'food'}, .20, 4.0)]
    cycles = []
    for x, y, z in itertools.permutations(cs, 3):
        if pairwise_skip_cmp(req, x, y) > 0 and pairwise_skip_cmp(req, y, z) > 0 and pairwise_skip_cmp(req, z, x) > 0:
            cycles.append([x['id'], y['id'], z['id']])
    return {'candidates': 'A(sim UNKNOWN, q3.0) B(sim .90, q2.0) C(sim .20, q4.0), equal explicit affinity',
            'cycles': cycles, 'transitive': not cycles}


def cross_request_normalization():
    """Within one request, ordering by matchedWeight equals ordering by matchedWeight/possibleWeight (possible is
    constant per request), so normalization is irrelevant to A; it matters only to B (utility vs travel across
    requests). Both quantities are emitted so B can normalize without re-deriving."""
    reqs = {'one_strong_wizard_facet': [W('history')],
            'five_weak_free_text_facets': [FTD(k, .5, .5) for k in ('a', 'b', 'c', 'd', 'e')]}
    out = {}
    for name, facets in reqs.items():
        keys = [f['key'] for f in facets]
        cs = [cand(f'm{i}', keys[:i]) for i in range(len(keys) + 1)]
        possible = sum((f['weight'] for f in facets), Fraction(0))
        by_abs = sorted(cs, key=lambda c: (-wsum(facets, c), c['id']))
        by_rel = sorted(cs, key=lambda c: (-(wsum(facets, c) / possible), c['id']))
        out[name] = {'possibleWeight': str(possible), 'sameOrder': [c['id'] for c in by_abs] == [c['id'] for c in by_rel],
                     'maxMatchedFraction': str(max(wsum(facets, c) for c in cs) / possible)}
    return out


def scalarization():
    """Any strictly increasing map from preference rank to a per-candidate prize preserves the per-candidate order,
    but the routing objective SUMS prizes over the visited set. Different order-preserving maps disagree on sets,
    so the per-candidate order does not determine a scalar prize: the cardinal values are part B."""
    # rank 2 = higher explicit tier (one Experience), rank 1 = lower tier (two Experiences); same travel.
    maps = {'prize = rank': {2: 2, 1: 1}, 'prize = rank^2': {2: 4, 1: 1}, 'prize = rank + 1': {2: 3, 1: 2}}
    out = {}
    for name, m in maps.items():
        one_high, two_low = m[2], 2 * m[1]
        out[name] = {'perCandidateOrderPreserved': m[2] > m[1], 'oneHigher': one_high, 'twoLower': two_low,
                     'setPreferred': 'one higher-tier' if one_high > two_low else ('tie' if one_high == two_low else 'two lower-tier')}
    # mixed radix: digit base > pool size makes one higher-tier Experience beat ANY number of lower-tier ones and
    # any travel saving expressed in a lower digit -> a set-level lexicographic policy, i.e. itself a B decision.
    out['mixedRadixNote'] = ('base > n (pool size) is lossless per candidate and lexicographic over sets; it also '
                             'makes every preference digit dominate travel, which is the preference-vs-travel '
                             'exchange rate that part B must decide, not A.')
    return out


def unknown_is_projection_only():
    """The median is an ORDERING projection only. The typed assessment of an UNKNOWN candidate stays UNKNOWN: no
    imputed cosine is stored or reported. Shown on C1 under the adopted policy."""
    sc = next(x for x in SCENARIOS if x['id'] == 'C1')
    req, cands = sc['req'], eligible(sc['req'], sc['cands'])
    ranked = [c['id'] for c in POLICIES['P_prov+median+median'](req, cands)]
    assessment = {c['id']: {'semanticAffinity': 'UNKNOWN' if c['sim'] is None else {'KNOWN': c['sim']}} for c in cands}
    return {'ranked': ranked, 'assessment': assessment,
            'unknownReportedAsValue': any(isinstance(a['semanticAffinity'], dict) and a['semanticAffinity']['KNOWN'] is None
                                          for a in assessment.values())}


def main():
    report = {'policies': list(POLICIES), 'scenarios': [], 'summary': {}}
    for sc in SCENARIOS:
        row = {'id': sc['id'], 'title': sc['title'], 'byPolicy': {}}
        for name, fn in POLICIES.items():
            ranked, res = check(fn, sc)
            row['byPolicy'][name] = {'ranked': ranked, 'checks': res}
        report['scenarios'].append(row)
    for name in POLICIES:
        checks = [c for r in report['scenarios'] for c in r['byPolicy'][name]['checks']]
        failed = [f"{r['id']}:{' '.join(c['expect'][:3]) if c['expect'][0] != 'not_last' and c['expect'][0] != 'not_first' else ' '.join(c['expect'][:2])}"
                  for r in report['scenarios'] for c in r['byPolicy'][name]['checks'] if not c['pass']]
        report['summary'][name] = {'pass': sum(c['pass'] for c in checks), 'total': len(checks), 'failed': failed}
    report['pairwiseSkipTransitivity'] = pairwise_skip_cycle()
    report['crossRequestNormalization'] = cross_request_normalization()
    report['scalarization'] = scalarization()
    report['unknownIsProjectionOnly'] = unknown_is_projection_only()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as fh:
        json.dump(report, fh, indent=1, default=str)
    for name, s in report['summary'].items():
        print(f"{name:34s} {s['pass']:2d}/{s['total']}  failed: {', '.join(s['failed']) or '-'}")
    k4 = report['scenarios'][[r['id'] for r in report['scenarios']].index('K4')]['byPolicy']
    print('K4 (confidence within DIRECT):', {n: k4[n]['ranked'] for n in ('P_prov+median+median', 'P_prov_confidence_in_direct+median+median')})
    print('UNKNOWN projection only:', report['unknownIsProjectionOnly'])
    print('pairwise-skip cycles:', report['pairwiseSkipTransitivity']['cycles'][:1])
    print('normalization:', report['crossRequestNormalization'])
    for k, v in report['scalarization'].items():
        print('scalar', k, v)


if __name__ == '__main__':
    main()
