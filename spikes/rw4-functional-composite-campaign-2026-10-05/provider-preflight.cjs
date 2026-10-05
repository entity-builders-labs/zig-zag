const path = require('node:path');
const dist = path.resolve(__dirname, '../../be/dist/src');
const aiConfig = require(`${dist}/shared/ai/ai.config`).default;
const { selectGroundedSearchProvider } = require(`${dist}/modules/tours/services/grounded-search-provider-selection.util`);
const { selectDiscoveryExtractor } = require(`${dist}/modules/tours/services/discovery-extractor-selection.util`);
const { selectWebSourceContentProvider } = require(`${dist}/modules/tours/services/web-source-content-provider-selection.util`);

const config = aiConfig();
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

const expectedContentProvider = process.env.WEB_SOURCE_CONTENT_PROVIDER;
let contentProvider = undefined;
if (expectedContentProvider) {
  contentProvider = selectWebSourceContentProvider(config.webSourceContent?.provider, {
    tavily: tag('tavily'), cloudflare: tag('cloudflare'),
  })?.name;
}

const activeExtractorModel =
  extractor === 'groq'
    ? config.discoveryExtractor.groq?.model
    : extractor === 'gemini'
      ? config.discoveryExtractor.gemini?.model
      : config.discoveryExtractor.cloudflare?.model;

const out = {
  resolvedAt: new Date().toISOString(),
  groundedSearchProvider: grounded,
  discoveryExtractorProvider: extractor,
  discoveryExtractorModel: activeExtractorModel,
  discoveryExtractorTimeoutMs:
    extractor === 'groq'
      ? config.timeout
      : config.discoveryExtractor.cloudflare?.timeoutMs,
  discoveryExtractorMaxCompletionTokens:
    extractor === 'cloudflare'
      ? config.discoveryExtractor.cloudflare?.maxCompletionTokens
      : undefined,
  webSourceContentProvider: contentProvider,
  classificationProvider: config.classification?.provider,
  classificationModel: config.classification?.[config.classification?.provider]?.model,
  aiProvider: config.provider,
  credentialsPresent: {
    serper: Boolean(process.env.SERPER_API_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
    cloudflareAccount: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID),
    cloudflareToken: Boolean(process.env.CLOUDFLARE_API_TOKEN),
    tavily: Boolean(process.env.TAVILY_API_KEY),
  },
};

out.canonicalSelection =
  grounded === 'serper' &&
  ((extractor === 'cloudflare' &&
    activeExtractorModel === '@cf/qwen/qwen3.8-27b' &&
    out.discoveryExtractorMaxCompletionTokens === 4096) ||
   (extractor === 'groq' && activeExtractorModel === 'qwen/qwen3.8-27b') ||
   // 2026-10-05, owner decision: Cloudflare's daily allocation was exhausted
   // and Groq caps output at 1000 tokens/minute, so the C3 re-run after the
   // RW4-EXTRACT-COMPLETENESS-1 fix uses the configured Gemini extractor.
   (extractor === 'gemini' && activeExtractorModel === 'gemini-3.5-flash-lite')) &&
  (!expectedContentProvider || contentProvider === expectedContentProvider);

console.log(JSON.stringify(out, null, 2));
if (!out.canonicalSelection) {
  console.error(`PREFLIGHT FAILED: runtime selection is invalid (grounded=${grounded}, extractor=${extractor}, model=${activeExtractorModel}, contentProvider=${contentProvider}, expected=${expectedContentProvider})`);
  process.exit(1);
}
