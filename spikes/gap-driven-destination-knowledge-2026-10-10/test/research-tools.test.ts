import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SerperApiService } from '../../../be/src/modules/integrations/serper/services/serper-api.service';
import { Recorder } from '../src/recording';
import { captureFromQuote, documentFromHtml, locateQuote } from '../src/research/documents';
import { isGovernmentHosted, registrableDomain } from '../src/research/domain';
import { catalogRead, liveWebTools } from '../src/research/tools';
import { DEST_ID, fixtureAssertion, grounding, worldStore } from './fixtures/world';

const html = readFileSync(join(__dirname, 'fixtures/editorial-page.html'), 'utf8');
const doc = documentFromHtml('https://www.fixture-guide.example/san-telmo', html, '2026-10-10T00:00:00Z');

describe('research tools and evidence capture (task 4.1)', () => {
  it('extracts visible text, title and JSON-LD; scripts and styles are not text', () => {
    expect(doc.title).toBe('San Telmo & Defensa | Fixture Travel Guide');
    expect(doc.text).toContain("San Telmo is Buenos Aires' oldest barrio");
    expect(doc.text).not.toContain('tracking');
    expect(doc.jsonLd).toHaveLength(1);
    expect(doc.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('builds a well-formed PROSE_SPAN capture whose offsets reproduce the span', () => {
    const c = captureFromQuote(doc, 'Walk down Calle Defensa from Plaza de Mayo to Parque Lezama', 'fixture-guide.example', 'editorial');
    expect(c).toBeDefined();
    if (!c || c.capture.kind !== 'PROSE_SPAN') throw new Error('expected span');
    expect(doc.text.slice(c.capture.start, c.capture.end)).toBe(c.capture.text);
    expect(c.locator).toEqual({ kind: 'URL', url: 'https://www.fixture-guide.example/san-telmo' });
    expect(c.contentFingerprint).toBe(doc.fingerprint);
    expect(c.proposedAuthorityClass).toBe('editorial');
    expect(c.provenanceSignals).toEqual([]);
  });

  it('matches typographic quote variants without changing offsets', () => {
    const at = locateQuote(doc.text, 'understand the city’s colonial history');
    expect(at).toBeDefined();
  });

  it('returns no capture when the quote is not in the document', () => {
    expect(captureFromQuote(doc, 'Defensa is the oldest street in Montevideo', 'x')).toBeUndefined();
    expect(captureFromQuote(doc, 'too short', 'x')).toBeUndefined();
  });

  it('computes registrable domains and the government-hosted signal', () => {
    expect(registrableDomain('https://turismo.buenosaires.gob.ar/es/x')).toBe('buenosaires.gob.ar');
    expect(registrableDomain('https://www.lonelyplanet.com/argentina')).toBe('lonelyplanet.com');
    expect(registrableDomain('https://en.wikivoyage.org/wiki/x')).toBe('wikivoyage.org');
    expect(isGovernmentHosted('buenosaires.gob.ar')).toBe(true);
    expect(isGovernmentHosted('lonelyplanet.com')).toBe(false);
  });

  it('search maps provider results and goes through the recorder', async () => {
    const recorder = new Recorder(mkdtempSync(join(tmpdir(), 'gddk-tools-')), 'record');
    const serper = {
      search: jest.fn().mockResolvedValue({ data: { organic: [{ title: 'T', link: 'https://a.example/x', snippet: 's' }, { title: 'no link' }] }, meta: {} }),
    } as unknown as SerperApiService;
    const tools = liveWebTools(recorder, serper, 'AR');
    await expect(tools.search('San Telmo history')).resolves.toEqual([{ title: 'T', url: 'https://a.example/x', snippet: 's' }]);
    expect(serper.search).toHaveBeenCalledWith({ q: 'San Telmo history', num: 10, gl: 'ar' });
    expect(recorder.counts.serper.live).toBe(1);
  });

  it('catalog-read returns a bounded excerpt of known knowledge for the gap', () => {
    const store = worldStore();
    store.upsertAssertion(grounding, fixtureAssertion('NOTABLE_WITHIN', { kind: 'PLACE_IN_AREA', placeGeoEntityId: 'geo-plaza-dorrego', areaGeoEntityId: 'geo-san-telmo' }, 'theme:history'));
    const excerpt = catalogRead(store.snapshot(), {
      key: 'k', type: 'NOTABLE_PLACES', scopeGeoEntityId: 'geo-san-telmo', facetKey: 'theme:history', threshold: 2, observed: 1,
      knownAreaIds: ['geo-san-telmo'], relevantAreaIds: ['geo-san-telmo'],
    }, DEST_ID);
    expect(excerpt).toEqual({
      destinationName: 'Ciudad Autónoma de Buenos Aires',
      gap: { type: 'NOTABLE_PLACES', facet: 'theme:history', scopeName: 'San Telmo' },
      knownRelevantAreas: ['San Telmo'],
      excludedAreas: [],
      knownPlacesInScope: ['Plaza Dorrego'],
      knownCorridors: [],
    });
  });
});
