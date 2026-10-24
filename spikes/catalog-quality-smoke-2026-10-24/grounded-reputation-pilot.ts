import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { parse } from "dotenv";
import { GroqGroundedSearchService } from "../../be/src/modules/tours/services/groq-grounded-search.service";

type ReputationEvidenceType =
  | "OFFICIAL_TOURISM_MENTION"
  | "REPEATED_TRAVEL_GUIDE_RECOMMENDATION"
  | "REPUTABLE_EDITORIAL_MENTION"
  | "CURRENT_VENUE_PRESENCE";

type ReputationKnowledge =
  | {
      status: "KNOWN";
      evidence: Array<{
        type: ReputationEvidenceType;
        sourceTitle: string;
        sourceUrl: string;
        citation: string;
      }>;
    }
  | { status: "UNKNOWN"; reason: string };

const SMOKE_PATH = path.join(__dirname, "catalog-smoke-after-39-13-14.json");
const FULL_ORDER_PATH = path.join(__dirname, "full-order-after-39-13-14.json");
const OUTPUT_PATH = path.join(__dirname, "grounded-reputation-pilot.json");
const SAMPLE = [
  { name: "Casa Rosada", stratum: "current top" },
  { name: "Plaza Dorrego", stratum: "middle / secondary" },
  { name: "Don Julio", stratum: "gastronomy" },
  { name: "El Hipopótamo", stratum: "gastronomy / secondary" },
  { name: "Obelisco", stratum: "low prominence diagnostic" },
  { name: "Teatro Colón", stratum: "diagnostic" },
  { name: "Museo Nacional de Bellas Artes", stratum: "diagnostic / art" },
  {
    name: "Museo de Arte Latinoamericano de Buenos Aires (MALBA)",
    stratum: "diagnostic / art",
  },
  { name: "Caminito", stratum: "diagnostic" },
];
const DIAGNOSTICS = [
  "Teatro Colón",
  "Obelisco",
  "Museo Nacional de Bellas Artes",
  "Museo de Arte Latinoamericano de Buenos Aires (MALBA)",
  "Café Tortoni",
  "Don Julio",
  "Caminito",
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function returnedSources(message: any) {
  return (message.executed_tools ?? []).flatMap((tool: any) =>
    (tool.search_results?.results ?? []).map((source: any) => ({
      tool: tool.name,
      toolIndex: tool.index,
      title: source.title,
      url: source.url,
      excerpt: String(source.content ?? tool.output ?? "")
        .replace(/\s+/g, " ")
        .slice(0, 360),
    })),
  );
}

async function main() {
  const rootEnv = parse(readFileSync(path.join(__dirname, "../../.env")));
  const apiKey = process.env.GROQ_API_KEY || rootEnv.GROQ_API_KEY;
  if (!apiKey) throw new Error("Groq key unavailable; no queries were made.");

  const smoke = JSON.parse(readFileSync(SMOKE_PATH, "utf8"));
  const composedNames = new Set(
    JSON.parse(readFileSync(FULL_ORDER_PATH, "utf8")) as string[],
  );
  const candidates = SAMPLE.filter((candidate) =>
    composedNames.has(candidate.name),
  );
  const excludedDiagnostics = DIAGNOSTICS.filter(
    (name) => !composedNames.has(name),
  );
  if (!candidates.length) throw new Error("No admitted sample candidates.");

  Logger.overrideLogger([]);
  const service = new GroqGroundedSearchService(
    new ConfigService({ ai: { groqApiKey: apiKey } }),
  );
  const records: any[] = [];
  for (const candidate of candidates) {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const result = await service.search({
      destinationName: candidate.name,
      destinationCountry: "Argentina",
      destinationCountryCode: "AR",
      requestedThemes: [],
      query: `For the exact independently admitted visitor place ${candidate.name} in Buenos Aires, Argentina, find grounded evidence only for official tourism recommendation, repeated travel-guide recommendation, reputable editorial mention, or current official venue presence. State the exact evidence and cite every factual claim with browser source citations. State no evidence when unsupported. Do not give a numeric quality score.`,
    });
    const raw = (result.rawOutput ?? {}) as any;
    const message = raw.choices?.[0]?.message ?? {};
    const answer = String(message.content ?? "");
    const citations = [...answer.matchAll(/【(\d+)†(L\d+-L\d+)】/g)].map(
      (match) => ({ sourceIndex: Number(match[1]), lines: match[2] }),
    );
    records.push({
      candidate: candidate.name,
      stratum: candidate.stratum,
      admittedBeforeQuery: true,
      startedAt,
      latencyMs: Date.now() - start,
      provider: result.provider,
      model: result.model,
      groundingStatus: result.groundingStatus,
      failureReason: result.failureReason,
      usage: raw.usage ?? null,
      providerReportedCost: null,
      citationMarkers: citations,
      sources: returnedSources(message),
      groundedAnswer: answer,
      reputationKnowledge: {
        status: "UNKNOWN",
        reason:
          "Awaiting source-to-citation identity review; model assertions alone are not ranking evidence.",
      } satisfies ReputationKnowledge,
    });
    if (candidate !== candidates[candidates.length - 1]) await sleep(55_000);
  }

  writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        label: "bounded-groq-grounded-reputation-pilot",
        smokeHead: smoke.head,
        selectedProvider: "groq",
        serviceModel: records[0]?.model ?? "openai/gpt-oss-120b",
        tool: "browser_search",
        candidateLimit: SAMPLE.length,
        candidatesRequested: candidates.length,
        eligibleCandidatesNotQueried: excludedDiagnostics,
        cache: { available: false, hits: 0, misses: records.length },
        records,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      output: OUTPUT_PATH,
      requested: records.length,
      excludedDiagnostics,
    }),
  );
}

void main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Reputation pilot failed",
  );
  process.exitCode = 1;
});
