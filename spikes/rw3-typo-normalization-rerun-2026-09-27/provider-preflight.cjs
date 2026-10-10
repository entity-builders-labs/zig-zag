// RW3 anchor-handoff rerun, spike-only provider preflight. Resolves the
// COMPILED production provider selection (ai.config + the same selector
// functions tours.module uses) under the exact env the backend will boot
// with, BEFORE any live search/extraction call. Prints a secret-free JSON
// record and exits non-zero if the runtime would not be the canonical pair
// serper + cloudflare @cf/qwen/qwen3.8-27b.
const path = require('node:path');
const dist = path.resolve(__dirname, '../../be/dist/src');
const aiConfig = require(`${dist}/shared/ai/ai.config`).default;
const { selectGroundedSearchProvider } = require(`${dist}/modules/tours/services/grounded-search-provider-selection.util`);
const { selectDiscoveryExtractor } = require(`${dist}/modules/tours/services/discovery-extractor-selection.util`);

const config = aiConfig();
// Same resolution expression as the EXPERIENCE_GROUNDED_SEARCH_PROVIDER factory.
const groundedName = (
  config.groundedSearchProvider ||
  process.env.GROUNDED_SEARCH_PROVIDER ||
  (config.serpApiKey ? 'serpapi' : 'groq')
).toLowerCase();
const tag = (name) => ({ name });
const grounded = selectGroundedSearchProvider(groundedName, {
  serpapi: tag('serpapi'), serper: tag('serper'), groq: tag('groq'), tavily: tag('tavily'), gemini: tag('gemini'),
}).name;
const extractor = selectDiscoveryExtractor(config.discoveryExtractor.provider, {
  gemini: tag('gemini'), groq: tag('groq'), ollama: tag('ollama'), cloudflare: tag('cloudflare'),
}).name;
const out = {
  resolvedAt: new Date().toISOString(),
  groundedSearchProvider: grounded,
  discoveryExtractorProvider: extractor,
  discoveryExtractorModel: config.discoveryExtractor.cloudflare?.model,
  discoveryExtractorTimeoutMs: config.discoveryExtractor.cloudflare?.timeoutMs,
  classificationProvider: config.classification?.provider,
  classificationModel: config.classification?.[config.classification?.provider]?.model,
  aiProvider: config.provider,
  credentialsPresent: {
    serper: Boolean(process.env.SERPER_API_KEY),
    cloudflareAccount: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID),
    cloudflareToken: Boolean(process.env.CLOUDFLARE_API_TOKEN),
  },
};
out.canonicalPair =
  grounded === 'serper' && extractor === 'cloudflare' && out.discoveryExtractorModel === '@cf/qwen/qwen3.8-27b';
console.log(JSON.stringify(out, null, 2));
if (!out.canonicalPair) {
  console.error('PREFLIGHT FAILED: runtime is not serper + cloudflare @cf/qwen/qwen3.8-27b');
  process.exit(1);
}
