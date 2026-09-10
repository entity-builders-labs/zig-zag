/**
 * Deterministic multi-axis semantic oracle for the competitive engine-quality
 * benchmark (Checkpoint G).
 *
 * Stored Experience embeddings and query embeddings are BOTH built from an
 * axis-weight vector by the same closed-form projection, so:
 *
 *   cosine(projectAxisVector(P), projectAxisVector(Q)) === cosine(P, Q)
 *
 * (each axis owns a disjoint 16-dim band filled with a constant; the ×16 band
 * factor cancels in the cosine). pgvector's `1 - (a <=> b)` computes exactly
 * this. The consequence the benchmark relies on: a different user profile
 * produces a different query string → a different query vector, while the
 * persisted row vectors are written ONCE by the seeder and never rewritten.
 */

export const AXES = [
  'history',
  'architecture',
  'iconic',
  'local',
  'hidden_history',
  'tango',
  'performance',
  'class',
  'food',
  'craft_beer',
  'specialty_coffee',
  'family',
  'interactive',
  'relaxed',
  'nightlife',
  'religion',
] as const;

export type Axis = (typeof AXES)[number];
export type AxisWeights = Partial<Record<Axis, number>>;

const AXIS_INDEX: Record<Axis, number> = Object.fromEntries(
  AXES.map((axis, index) => [axis, index]),
) as Record<Axis, number>;

const BAND = 16;
export const EMBEDDING_DIMENSIONS = AXES.length * BAND; // 256

/** Identity columns written on every seeded row + returned by the fake service. */
export const INDEX_IDENTITY = {
  provider: 'e2e-competitive',
  model: 'axis-oracle-v1',
  dimensions: EMBEDDING_DIMENSIONS,
  documentVersion: 1,
} as const;

/** Band-uniform, L2-normalized projection of an axis-weight vector. */
export function projectAxisVector(weights: AxisWeights): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const axis of AXES) {
    const weight = weights[axis];
    if (!weight) continue;
    const base = AXIS_INDEX[axis] * BAND;
    for (let d = 0; d < BAND; d++) vector[base + d] = weight;
  }
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) || 1;
  return vector.map((x) => x / norm);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb) || 1;
  return dot / denom;
}

/** cosine of the raw axis-weight vectors — equal to cosine of the projections. */
export function axisCosine(p: AxisWeights, q: AxisWeights): number {
  return cosine(rawAxisVector(p), rawAxisVector(q));
}

function rawAxisVector(weights: AxisWeights): number[] {
  return AXES.map((axis) => weights[axis] ?? 0);
}

/* ------------------------------------------------------------------ *
 * Query → axis weights (parses `buildSemanticTourQuery` output)
 * ------------------------------------------------------------------ */

const INTEREST_AXIS: Record<string, AxisWeights> = {
  history: { history: 1 },
  architecture: { architecture: 1 },
  art: { history: 0.7 },
  culture: { history: 0.6 },
  food: { food: 1 },
  gastronomy: { food: 1 },
  tango: { tango: 1, performance: 0.6 },
  music: { performance: 1 },
  entertainment: { performance: 0.8 },
  family: { family: 1 },
  nightlife: { nightlife: 1 },
  photography: { iconic: 0.3 },
};

const STYLE_AXIS: Record<string, AxisWeights> = {
  iconic: { iconic: 1 },
  'local deep dive': { local: 1, hidden_history: 1 },
  balanced: {},
};

const PHRASE_AXIS: Array<[RegExp, AxisWeights]> = [
  [/craft beer|cerveza artesanal|brewer|taproom/i, { craft_beer: 1 }],
  [
    /specialty coffee|caf[eé] de especialidad|roaster/i,
    { specialty_coffee: 1 },
  ],
  [
    /hidden history|historia oculta|historias barriales|offbeat/i,
    { hidden_history: 1, local: 0.5 },
  ],
  [/iconic must-see|imperdibles|famous landmark|must see/i, { iconic: 0.8 }],
  [/local neighbou?rhood|barrio|residential street/i, { local: 0.8 }],
  [/\btango\b/i, { tango: 0.6 }],
  [/relaxed|tranquilo|relajado|leisurely/i, { relaxed: 1 }],
  [/\bclass\b|lesson|clase|workshop|taller/i, { class: 1 }],
  [/interactive|hands-on|interactivo/i, { interactive: 1 }],
  [/religious|religioso/i, { religion: 1 }],
];

function bump(into: AxisWeights, from: AxisWeights): void {
  for (const axis of Object.keys(from) as Axis[]) {
    into[axis] = Math.max(into[axis] ?? 0, from[axis]!);
  }
}

export function queryToAxisWeights(query: string): AxisWeights {
  const out: AxisWeights = {};
  for (const rawLine of query.split('\n')) {
    const line = rawLine.trim();
    const lower = line.toLowerCase();
    if (lower.startsWith('interests:')) {
      line
        .slice(line.indexOf(':') + 1)
        .split(',')
        .map((token) => token.trim().toLowerCase())
        .forEach((token) => bump(out, INTEREST_AXIS[token] ?? {}));
    } else if (lower.startsWith('exploration style:')) {
      const style = lower.slice(lower.indexOf(':') + 1).trim();
      bump(out, STYLE_AXIS[style] ?? {});
    } else if (lower.startsWith('additional preferences:')) {
      for (const [pattern, weights] of PHRASE_AXIS) {
        if (pattern.test(line)) bump(out, weights);
      }
    }
  }
  return out;
}

/**
 * Document → axis weights. Only exercised if `embedDocuments` is ever called
 * (the tour flow never calls it — row vectors are written directly by the
 * seeder). Parses a `AXES: history=1;architecture=1` tag if present.
 */
export function docToAxisWeights(text: string): AxisWeights {
  const match = /AXES:\s*([^\n]+)/i.exec(text ?? '');
  if (!match) return {};
  const out: AxisWeights = {};
  for (const pair of match[1].split(';')) {
    const [axis, value] = pair.split('=').map((s) => s.trim());
    if ((AXES as readonly string[]).includes(axis)) {
      out[axis as Axis] = Number(value) || 0;
    }
  }
  return out;
}
