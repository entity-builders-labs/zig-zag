/*
 * Characterization spike (diagnostic, never a gate): does prompt-only
 * extraction (A0 current shared prompt, A1 strengthened) or the bounded
 * recovery prompt (B) surface the real SolSalute caption as a locality
 * statement for Ojo de Agua? Real providers, the captured COLD #11 window.
 *   cd be && npx ts-node -T ../spikes/.../spike.ts <provider> <variant> <run>
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  buildDiscoveryResponseJsonSchema,
  buildDiscoverySystemPrompt,
  buildDiscoveryUserPrompt,
} from '../../../../../be/src/modules/tours/prompts/experience-discovery-extraction.prompt';
import {
  buildLocalityRecoveryResponseJsonSchema,
  buildLocalityRecoverySystemPrompt,
  buildLocalityRecoveryUserPrompt,
} from '../../../../../be/src/modules/tours/prompts/component-locality-recovery.prompt';
import {
  sourceStatements,
  textNamesLiterally,
} from '../../../../../be/src/modules/tours/utils/literal-source-text.util';

const [provider, variant, run] = process.argv.slice(2);
const ROOT = path.resolve(__dirname, '../../../../..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const WINDOW = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'be/src/modules/tours/fixtures/rw4-solsalute-deep-source-window.json'), 'utf8'),
);
const evidence = [{
  key: 'ev-1', source: 'web', url: WINDOW.sourceUrl,
  title: 'The Best Wineries in Mendoza, A Wine Tasting Guide',
  snippet: WINDOW.content, evidenceQuality: 'original_content',
}] as any;
const request = {
  scope: { destinationName: 'Mendoza', destinationCountryCode: 'AR' },
  requestedThemes: [], requestedIntents: ['route_like'],
  anchorNames: ['Ruta del Vino de Mendoza'],
  semanticQuery: 'Ciudad de Mendoza Ruta del Vino de Mendoza scenic routes tours wine route mendoza wineries representative tasting',
  breadth: 'focused', maxCandidates: 5, evidenceRequirements: ['MULTI_COMPONENT_EXPERIENCE'],
} as any;

const A1_EXTRA =
  'Before returning, for EVERY componentHint scan the WHOLE cited evidence, including image captions and sentences outside its itinerary entry, for one sentence or caption that names this component together with the town, district or department it is in, and when one exists ALWAYS return it as localityAssertion (locality copied verbatim, supportSpan the verbatim sentence or caption).';

// B input: the components the real Gemini replay (run-gemini-1) extracted,
// with their verified entries; statements are selected deterministically.
const COMPONENTS: Array<[string, string]> = [
  ['Alfa Crux', 'Alfa Crux – 10 am – This winery is the furthest, so start here and work your way back up.'],
  ['SuperUco', 'SuperUco – 12 pm – It will take you 40 minutes to drive here from Alfa Crux so you’ll need to schedule SuperUco for no earlier than noon.'],
  ['Bodega Azul', 'Bodega Azul – 2:30 pm for lunch – You’ll spend the remaining hours of your afternoon hours here, so sit back and enjoy the meal.'],
  ['A16', 'A16 – 10 am – Start your day with a tasting and a tour at A16.'],
  ['Ojo de Agua', 'Ojo de Agua – 1:30 pm for a winery lunch – It took us about 15-20 minutes to drive to Ojo de Agua from Melipal'],
];

async function gemini(system: string, user: string, schema: object): Promise<string> {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/interactions?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: `models/${process.env.GEMINI_DISCOVERY_MODEL}`, system_instruction: system, input: user, response_format: schema }),
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!resp.ok) throw new Error(`gemini ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data: any = await resp.json();
  return data.steps.find((s: any) => s.type === 'model_output').content.find((c: any) => c.type === 'text').text;
}

async function groq(system: string, user: string): Promise<string> {
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.GROQ_DISCOVERY_MODEL, temperature: 0, max_completion_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!resp.ok) throw new Error(`groq ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data: any = await resp.json();
  return data.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

async function main() {
  let system: string, user: string, schema: object;
  if (variant === 'B') {
    const statements = sourceStatements(WINDOW.content);
    let next = 0;
    const components = COMPONENTS.map(([name, entry], i) => ({
      id: `c${i + 1}`, name, entry,
      statements: statements.filter((s) => textNamesLiterally(s, name)).map((text) => ({ id: `s${++next}`, text })),
    }));
    system = buildLocalityRecoverySystemPrompt();
    user = buildLocalityRecoveryUserPrompt(components);
    schema = buildLocalityRecoveryResponseJsonSchema(components);
  } else {
    system = buildDiscoverySystemPrompt();
    user = buildDiscoveryUserPrompt(request, evidence) + (variant === 'A1' ? `\n${A1_EXTRA}` : '');
    schema = buildDiscoveryResponseJsonSchema();
  }
  const started = Date.now();
  let raw: string, error: string | undefined;
  try {
    raw = provider === 'gemini' ? await gemini(system, user, schema) : await groq(system, user);
  } catch (e: any) { raw = ''; error = e.message; }
  let summary: unknown;
  try {
    const parsed = JSON.parse(raw);
    if (variant === 'B') summary = parsed.reports;
    else summary = (parsed.candidates ?? []).map((c: any) => ({
      name: c.name,
      components: (c.componentHints ?? []).map((h: any) => ({ name: h.name, localityAssertion: h.localityAssertion ?? null })),
    }));
  } catch { summary = 'UNPARSEABLE'; }
  const out = { provider, model: provider === 'gemini' ? process.env.GEMINI_DISCOVERY_MODEL : process.env.GROQ_DISCOVERY_MODEL, variant, run, ms: Date.now() - started, error, summary, raw };
  fs.writeFileSync(path.join(__dirname, `${provider}-${variant}-${run}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ provider, variant, run, error, summary }));
}
main();
