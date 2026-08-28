import {
  EntityHint,
  GroundedTextBlock,
  GroundingEvidence,
} from '../interfaces/activity-discovery.interface';

const CAP_WORD = "[A-ZÁÉÍÓÚÑÜ][A-Za-zÁÉÍÓÚÑÜáéíóúñü'-]*";
const CONNECTOR_WORDS = ['de', 'del', 'la', 'los', 'las', 'y'];
const CONNECTOR = `(?:${CONNECTOR_WORDS.join('|')})`;
const NAME_CONTINUATION = `(?:${CAP_WORD}|${CONNECTOR})`;

// Real linear-feature type words, Spanish (this codebase's primary live
// destinations, per this session's La Rioja/Buenos Aires/Salta/Mendoza/
// Córdoba testing) and English. A route name always starts with one of
// these — bare capitalized phrases elsewhere in the text (a museum name, a
// person's name) are deliberately not matched; PR 8 is the real identity
// authority, this only proposes candidates worth asking it about.
const STREET_TYPE_PREFIXES: Record<string, string> = {
  Calle: 'street',
  Street: 'street',
  Avenida: 'avenue',
  'Av\\.': 'avenue',
  'Avda\\.?': 'avenue',
  Avenue: 'avenue',
  Bulevar: 'boulevard',
  Boulevard: 'boulevard',
  'Blvd\\.?': 'boulevard',
  Paseo: 'promenade',
  Promenade: 'promenade',
  Rambla: 'promenade',
  Pasaje: 'passage',
  Peatonal: 'pedestrian_street',
  Corredor: 'corridor',
  Road: 'road',
};

const STREET_PREFIX_PATTERN = Object.keys(STREET_TYPE_PREFIXES).join('|');
const STREET_NAME_RE = new RegExp(
  `\\b(${STREET_PREFIX_PATTERN})\\s+(${CAP_WORD}(?:\\s+${NAME_CONTINUATION}){0,4})`,
  'g',
);

interface RawMatch {
  name: string;
  expectedType: string;
}

function findStreetNames(text: string): RawMatch[] {
  const matches: RawMatch[] = [];
  for (const match of text.matchAll(STREET_NAME_RE)) {
    const [, prefixLiteral, nameBody] = match;
    const prefixKey = Object.keys(STREET_TYPE_PREFIXES).find((key) =>
      new RegExp(`^${key}$`).test(prefixLiteral),
    );
    const expectedType = prefixKey ? STREET_TYPE_PREFIXES[prefixKey] : 'street';
    const words = nameBody.trim().split(/\s+/);
    while (
      words.length > 0 &&
      CONNECTOR_WORDS.includes(words[words.length - 1])
    ) {
      words.pop();
    }
    if (words.length === 0) continue;
    matches.push({
      name: `${prefixLiteral} ${words.join(' ')}`,
      expectedType,
    });
  }
  return matches;
}

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * ROUTE's query is deliberately loose prose (see SemanticDiscoveryQueryBuilder
 * — a rigid "Exact Route Name:" field proved unreliable live), so a real
 * street/avenue name can appear anywhere: a text block's running narrative,
 * or a supplementary evidence item's title/snippet. This scans both and
 * proposes candidate EntityHints — never resolved or trusted as identity
 * here; PR 8's OSM/Nominatim/Overpass resolution remains the sole authority
 * on whether any of these are real.
 */
export function extractRouteHints(result: {
  evidence: GroundingEvidence[];
  textBlocks?: GroundedTextBlock[];
}): EntityHint[] {
  const byNormalizedName = new Map<
    string,
    { name: string; expectedType: string; evidenceKeys: Set<string> }
  >();

  const record = (raw: RawMatch, evidenceKeys: string[]) => {
    const key = normalize(raw.name);
    const existing = byNormalizedName.get(key);
    if (existing) {
      evidenceKeys.forEach((evidenceKey) =>
        existing.evidenceKeys.add(evidenceKey),
      );
      return;
    }
    byNormalizedName.set(key, {
      name: raw.name,
      expectedType: raw.expectedType,
      evidenceKeys: new Set(evidenceKeys),
    });
  };

  for (const block of result.textBlocks ?? []) {
    for (const raw of findStreetNames(block.text)) {
      record(raw, block.evidenceKeys);
    }
  }

  for (const evidence of result.evidence) {
    const haystack = [evidence.title, evidence.snippet]
      .filter((value): value is string => Boolean(value))
      .join(' ');
    for (const raw of findStreetNames(haystack)) {
      record(raw, [evidence.key]);
    }
  }

  return [...byNormalizedName.values()].map(
    ({ name, expectedType, evidenceKeys }) => ({
      key: `route-${normalize(name).replace(/\s+/g, '-')}`,
      name,
      role: 'route' as const,
      expectedType,
      required: true,
      evidenceKeys: [...evidenceKeys],
    }),
  );
}
