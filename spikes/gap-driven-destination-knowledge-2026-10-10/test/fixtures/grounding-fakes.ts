import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeGeoName } from '../../../../be/src/modules/tours/utils/nominatim-match.util';
import { EvidenceCapture, KnowledgeGap, ProposedClaim, SupportLevel } from '../../src/contracts';
import { GeoResolver, IdentityResult } from '../../src/grounding/identity';
import { SupportVerifier, claimStatement } from '../../src/grounding/support-verifier';
import { COMPOSITION_POLICY } from '../../src/policy';
import { FetchedDocument, captureFromQuote, documentFromHtml } from '../../src/research/documents';
import { registrableDomain } from '../../src/research/domain';
import { WebTools } from '../../src/research/tools';
import { CatalogStore } from '../../src/stores';
import { DEST_ID, ENTITIES } from './world';

export const URLS = {
  editorial: 'https://www.fixture-guide.example/san-telmo',
  blog: 'https://someone.blog-host.example/ba-notes',
  gov: 'https://www.ciudad-fixture.gob.ar/barrios/san-telmo',
  osm: 'https://www.openstreetmap.org/way/123',
};

const page = (name: string) => readFileSync(join(__dirname, name), 'utf8');
export const DOCS: Record<string, FetchedDocument> = {
  [URLS.editorial]: documentFromHtml(URLS.editorial, page('editorial-page.html'), '2026-10-10T00:00:00Z'),
  [URLS.blog]: documentFromHtml(URLS.blog, page('blog-page.html'), '2026-10-10T00:00:00Z'),
  [URLS.gov]: documentFromHtml(URLS.gov, page('gov-page.html'), '2026-10-10T00:00:00Z'),
  [URLS.osm]: documentFromHtml(URLS.osm, '<html><body><p>Plaza Dorrego, a leisure=park in San Telmo, Buenos Aires.</p></body></html>', '2026-10-10T00:00:00Z'),
};

export function cap(url: string, quote: string, authority?: string): EvidenceCapture {
  const c = captureFromQuote(DOCS[url], quote, registrableDomain(url), authority);
  if (!c) throw new Error(`fixture quote not in ${url}: ${quote}`);
  return c;
}

export function fakeTools(overrides: Partial<Record<string, FetchedDocument | Error>> = {}): WebTools & { fetches: string[] } {
  const fetches: string[] = [];
  return {
    fetches,
    search: async () => [],
    fetch: async (url) => {
      fetches.push(url);
      const o = overrides[url];
      if (o instanceof Error) throw o;
      if (o) return o;
      const d = DOCS[url];
      if (!d) throw new Error('404');
      return d;
    },
  };
}

/** Name-matching resolver over the fixture world with programmable outcomes. */
export function fakeResolver(overrides: Record<string, IdentityResult> = {}): GeoResolver & { calls: string[] } {
  const calls: string[] = [];
  const byName = (mention: string, kind: string): IdentityResult => {
    calls.push(`${kind}:${mention}`);
    const o = overrides[normalizeGeoName(mention)];
    if (o) return o;
    const key = normalizeGeoName(mention.replace(/^calle\s+/i, ''));
    const entity = Object.values(ENTITIES).find((e) => e.kind === kind && normalizeGeoName(e.name) === key);
    return entity ? { status: 'RESOLVED', entity, rule: 'FIXTURE' } : { status: 'NOT_FOUND', detail: 'fixture' };
  };
  return {
    calls,
    resolveArea: async (m) => byName(m, 'AREA'),
    resolvePlace: async (m) => byName(m, 'PLACE'),
    resolveRoute: async (m) => byName(m, 'ROUTE'),
  };
}

/** Deterministic support verifier: a table keyed by capture text fragment. */
export function fakeVerifier(rule: (statement: string, text: string) => SupportLevel): SupportVerifier & { calls: number } {
  const v = {
    calls: 0,
    identity: { provider: 'fake', model: 'rules' },
    async judge(q: Parameters<SupportVerifier['judge']>[0], c: EvidenceCapture) {
      v.calls += 1;
      const text = c.capture.kind === 'PROSE_SPAN' ? c.capture.text : '';
      return { claimKey: q.claimKey, level: rule(claimStatement(q), text), verifier: v.identity };
    },
  };
  return v;
}

export const deps = (store: CatalogStore, tools = fakeTools(), resolver = fakeResolver(), verifier = fakeVerifier(() => 'EXPLICIT')) => ({
  store, tools, resolver, verifier, destination: ENTITIES[DEST_ID], policy: COMPOSITION_POLICY, now: () => '2026-10-10T12:00:00Z',
});

export const gapOf = (type: KnowledgeGap['type'], scope = DEST_ID, facet = 'theme:history'): KnowledgeGap => ({
  key: `${type}|scope=${scope}|facet=${facet}`, type, scopeGeoEntityId: scope, facetKey: facet, threshold: 1, observed: 0,
  knownAreaIds: [], relevantAreaIds: ['geo-san-telmo'],
});

export const claimOf = (c: Partial<ProposedClaim> & Pick<ProposedClaim, 'claimType' | 'subjectMention' | 'captures'>): ProposedClaim => ({
  proposedThemes: ['history'], ...c,
});
