const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const SPIKE = __dirname;
const REPO = path.resolve(SPIKE, '..', '..');

for (const f of [path.join(REPO, '.env'), path.join(REPO, 'be', '.env')]) {
  if (fs.existsSync(f)) dotenv.config({ path: f });
}

const { TavilyWebSourceContentProvider } = require('../../be/dist/src/modules/tours/services/tavily-extract.service');
const { CloudflareWebSourceContentProvider } = require('../../be/dist/src/modules/tours/services/cloudflare-web-source-content.provider');
const { CloudflareDiscoveryProvider } = require('../../be/dist/src/modules/tours/services/cloudflare-discovery.provider');
const { candidateSatisfiesEvidenceRequirement } = require('../../be/dist/src/modules/tours/utils/acquisition-candidate-requirement.util');

const URLS = [
  'https://buenosairesfreewalks.com/la-boca-tour/',
  'https://bafreetour.com/what-to-do-in-caminito/',
];

const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const cfApiToken = process.env.CLOUDFLARE_API_TOKEN;
const tavilyApiKey = process.env.TAVILY_API_KEY;
const model = process.env.CLOUDFLARE_DISCOVERY_MODEL || '@cf/qwen/qwen3.8-27b';

if (!cfAccountId || !cfApiToken) {
  console.error('Missing Cloudflare credentials');
  process.exit(1);
}

const mockAiCache = {
  getCachedResponse: async () => null,
  cacheResponse: async () => {},
};

const tavilyConfig = {
  get: (key) => {
    if (key === 'ai.tavily.apiKey') return tavilyApiKey;
    if (key === 'ai.tavily.timeoutMs') return 30000;
    return undefined;
  },
};

const cfConfig = {
  webSourceContent: {
    cloudflare: {
      accountId: cfAccountId,
      apiToken: cfApiToken,
      timeoutMs: 30000,
      minRequestIntervalMs: 12000, // Enforce >= 10s between calls
    },
  },
};

const discoveryConfig = {
  discoveryExtractor: {
    cloudflare: {
      accountId: cfAccountId,
      apiToken: cfApiToken,
      model,
      timeoutMs: 60000,
    },
  },
};

const tavilyProvider = new TavilyWebSourceContentProvider(tavilyConfig, mockAiCache);
const cfContentProvider = new CloudflareWebSourceContentProvider(cfConfig, mockAiCache);
const discoveryExtractor = new CloudflareDiscoveryProvider(discoveryConfig);

const extractionRequest = {
  scope: {
    destinationName: 'Buenos Aires',
  },
  requestedThemes: ['history'],
  semanticQuery: 'Buenos Aires Caminito walking tours walks walking Caminito to see representative places',
  coverageGaps: ['craft beer', 'history'],
  breadth: 'focused',
  maxCandidates: 4,
  evidenceRequirements: ['MULTI_COMPONENT_EXPERIENCE'],
  anchorNames: ['Caminito'],
};

async function run() {
  console.log('=== RW3 Frozen Source Content Retrieval Characterization ===');
  console.log(`Cloudflare Model for Extraction: ${model}`);
  const dossier = {
    evaluatedUrls: URLS,
    providers: {},
  };

  for (const providerName of ['tavily', 'cloudflare']) {
    console.log(`\n=========================================`);
    console.log(`Evaluating Provider: ${providerName.toUpperCase()}`);
    console.log(`=========================================`);
    const provider = providerName === 'tavily' ? tavilyProvider : cfContentProvider;
    dossier.providers[providerName] = {};

    for (const url of URLS) {
      console.log(`\nRetrieving: ${url}`);
      const t0 = Date.now();
      const res = await provider.retrieve({
        urls: [url],
        maxContentChars: 6000,
      });
      const latencyMs = Date.now() - t0;
      const item = res.items[0];

      console.log(`Status: ${item?.status}, ContentChars: ${item?.contentChars}, Truncated: ${item?.truncated}, Latency: ${latencyMs}ms`);

      const urlSlug = url.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
      const contentFile = path.join(SPIKE, `${providerName}-${urlSlug}.md`);
      if (item?.content) {
        fs.writeFileSync(contentFile, item.content, 'utf8');
      }

      // Now test extraction yield with Cloudflare Qwen 27B
      let extractionOutcome = {
        candidatesCount: 0,
        admittedCount: 0,
        candidates: [],
        validationErrors: [],
      };

      if (item?.content && item.status === 'retrieved') {
        console.log(`Feeding retrieved markdown into discoveryExtractor (${model})...`);
        const searchResult = {
          provider: 'serper',
          groundingStatus: 'applied',
          evidence: [
            {
              key: 'ev-1',
              source: url,
              title: 'La Boca / Caminito Tour Guide',
              snippet: item.content,
              url,
              evidenceQuality: 'original_content',
            },
          ],
          rawOutput: item.content,
        };

        const tExtract0 = Date.now();
        try {
          const extractRes = await discoveryExtractor.extractExperiences(
            extractionRequest,
            searchResult,
            { bypassCache: true },
          );
          const extractLatencyMs = Date.now() - tExtract0;
          console.log(`Extraction latency: ${extractLatencyMs}ms`);
          console.log(`Extracted candidates: ${extractRes.candidates.length}`);
          console.log(`Validation errors: ${extractRes.validationErrors?.length || 0}`);

          const admitted = extractRes.candidates.filter((c) =>
            candidateSatisfiesEvidenceRequirement(c, 'MULTI_COMPONENT_EXPERIENCE'),
          );
          console.log(`Admitted candidates: ${admitted.length}`);

          for (const cand of extractRes.candidates) {
            console.log(`  - Candidate: "${cand.name}" (${cand.componentHints?.length || 0} components)`);
            cand.componentHints?.forEach((hint, idx) => {
              console.log(`      Stop ${idx + 1}: ${hint.name} [role=${hint.role}] span="${hint.supportSpan || ''}"`);
            });
          }

          extractionOutcome = {
            latencyMs: extractLatencyMs,
            candidatesCount: extractRes.candidates.length,
            admittedCount: admitted.length,
            candidates: extractRes.candidates,
            validationErrors: extractRes.validationErrors,
            rawOutput: extractRes.rawOutput,
          };
        } catch (err) {
          console.error(`Extraction failed: ${err.message}`);
          extractionOutcome = { error: err.message };
        }
      }

      dossier.providers[providerName][url] = {
        retrieval: {
          status: item?.status,
          failureReason: item?.failureReason,
          failureDetail: item?.failureDetail,
          contentChars: item?.contentChars,
          truncated: item?.truncated,
          latencyMs,
          contentType: item?.contentType,
        },
        extraction: extractionOutcome,
      };

      // Space requests by 12s to comfortably respect Cloudflare Browser Run limits
      console.log('Sleeping 12s to respect provider rate limits...');
      await new Promise((r) => setTimeout(r, 12000));
    }
  }

  const dossierFile = path.join(SPIKE, 'characterization-dossier.json');
  fs.writeFileSync(dossierFile, JSON.stringify(dossier, null, 2), 'utf8');
  console.log(`\nCharacterization complete. Dossier saved to ${dossierFile}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
