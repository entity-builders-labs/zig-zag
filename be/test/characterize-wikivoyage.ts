import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { WikivoyageApiService } from '../src/modules/tours/services/wikivoyage-api.service';
import { WikivoyageAcquisitionProvider } from '../src/modules/tours/providers/wikivoyage-acquisition.provider';
import { StructuredExperienceCandidateSynthesizerService } from '../src/modules/tours/services/structured-experience-candidate-synthesizer.service';

interface QueryTarget {
  name: string;
  query: string;
  notes?: string;
}

const TARGETS: QueryTarget[] = [
  { name: 'San Telmo', query: 'San Telmo' },
  { name: 'La Boca', query: 'La Boca' },
  { name: 'Buenos Aires/Recoleta', query: 'Buenos Aires/Recoleta' },
  {
    name: 'Recoleta (unscoped)',
    query: 'Recoleta',
    notes: 'Testing namespace/disambiguation behavior',
  },
  { name: 'Palermo (Buenos Aires)', query: 'Palermo (Buenos Aires)' },
  {
    name: 'Palermo (unscoped)',
    query: 'Palermo',
    notes: 'Testing namespace/disambiguation behavior',
  },
];

async function runCharacterization() {
  console.log(
    '================================================================',
  );
  console.log('LIVE WIKIVOYAGE CHARACTERIZATION REPORT');
  console.log(
    '================================================================\n',
  );

  const configService = new ConfigService();
  const apiService = new WikivoyageApiService(configService);
  const provider = new WikivoyageAcquisitionProvider(apiService);
  const synthesizer = new StructuredExperienceCandidateSynthesizerService();

  for (const target of TARGETS) {
    console.log(`--- [Target: ${target.name}] Query: "${target.query}" ---`);
    if (target.notes) console.log(`Note: ${target.notes}`);

    // Direct HTTP request to inspect headers and precise timing
    const t0 = Date.now();
    let httpHeaders: Record<string, string> = {};
    let httpStatus = 0;
    try {
      const resp = await axios.get('https://es.wikivoyage.org/w/api.php', {
        params: {
          action: 'parse',
          page: target.query,
          prop: 'tocdata|wikitext',
          format: 'json',
          formatversion: 2,
          redirects: 1,
        },
        headers: {
          'User-Agent': 'ZigZagApp/1.0 (+https://github.com/jiseruk/zig-zag)',
          Accept: 'application/json',
        },
      });
      httpStatus = resp.status;
      httpHeaders = resp.headers as any;
    } catch (err: any) {
      httpStatus = err.response?.status || 0;
      httpHeaders = err.response?.headers || {};
    }
    const latency = Date.now() - t0;

    // Run through actual provider
    const tProvider0 = Date.now();
    const acqResult = await provider.acquire(target.query);
    const providerTime = Date.now() - tProvider0;

    const observations = acqResult.value;
    const candidates = synthesizer.synthesize(observations);

    // Compute metrics
    const totalEntries = observations.length;
    const withCoords = observations.filter(
      (o) => o.geo?.latitude !== undefined && o.geo?.longitude !== undefined,
    ).length;
    const withQid = observations.filter((o) => !!o.externalId).length;

    // Direct inspect API result
    const articleRes = await apiService.fetchArticle(target.query);

    console.log(
      `• Status: HTTP ${httpStatus}, Provider status: ${acqResult.status}`,
    );
    console.log(
      `• Latency: HTTP request ${latency}ms, Provider acquire ${providerTime}ms`,
    );
    console.log(
      `• Resolved title: "${articleRes.title || 'N/A'}" | Page ID: ${articleRes.pageid || 'N/A'}`,
    );
    console.log(`• Relevant Headers:`);
    console.log(`    cache-control: ${httpHeaders['cache-control'] || 'none'}`);
    console.log(`    etag: ${httpHeaders['etag'] || 'none'}`);
    console.log(`    server: ${httpHeaders['server'] || 'none'}`);
    console.log(`    x-cache: ${httpHeaders['x-cache'] || 'none'}`);
    console.log(
      `    x-ratelimit-remaining: ${httpHeaders['x-ratelimit-remaining'] || 'not exposed'}`,
    );

    console.log(`• Entries found: ${totalEntries}`);
    console.log(
      `• Coordinates coverage: ${withCoords}/${totalEntries} (${totalEntries ? Math.round((withCoords / totalEntries) * 100) : 0}%)`,
    );
    console.log(
      `• Wikidata QID coverage: ${withQid}/${totalEntries} (${totalEntries ? Math.round((withQid / totalEntries) * 100) : 0}%)`,
    );
    console.log(`• Synthesized Candidates: ${candidates.length}`);

    // Break down by evidenceType
    const byType: Record<string, number> = {};
    observations.forEach((o) => {
      byType[o.evidenceType] = (byType[o.evidenceType] || 0) + 1;
    });
    console.log(`• Evidence types breakdown:`, byType);

    // Samples
    if (observations.length > 0) {
      console.log(`• Sample entries:`);
      observations.slice(0, 3).forEach((o, idx) => {
        const c = candidates[idx];
        console.log(`    [${idx + 1}] "${o.title}" [${o.evidenceType}]`);
        console.log(
          `         coords: ${o.geo ? `${o.geo.latitude}, ${o.geo.longitude}` : 'none'}`,
        );
        console.log(`         QID: ${o.externalId || 'none'}`);
        console.log(`         evidenceKey: ${o.evidenceKey}`);
        console.log(
          `         hints: ${JSON.stringify(c.componentHints.map((h) => ({ role: h.role, kind: h.expectedKind })))}`,
        );
      });
    }
    console.log('\n');
  }
}

runCharacterization().catch(console.error);
