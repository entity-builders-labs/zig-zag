#!/usr/bin/env node
// COLD #11 summary: work units, per-unit acquisition, candidate
// authorization, compact component identity, geography, persistence.
//   node cold11-summary.cjs <cold11-dir>
'use strict';
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const trace = JSON.parse(
  fs.readFileSync(path.join(dir, 'generation-trace.json'), 'utf8'),
);
const steps = trace.steps ?? [];
const byParent = new Map();
for (const s of steps) {
  if (!s.parentId) continue;
  if (!byParent.has(s.parentId)) byParent.set(s.parentId, []);
  byParent.get(s.parentId).push(s);
}
const children = (id, name) =>
  (byParent.get(id) ?? []).filter((s) => !name || s.name === name);

const routing = steps
  .filter((s) => s.name === 'acquisition.routing')
  .map((s) =>
    (s.output?.workUnits ?? []).map((u) => ({
      kind: u.kind,
      deficit: u.deficit
        ? `${u.deficit.dimension}:${u.deficit.key}`
        : (u.deficits ?? []).map((d) =>
            d.origin === 'global_capacity' ? 'global_capacity' : `${d.dimension}:${d.key}`,
          ),
      anchor: u.anchor?.rawName,
      grant: u.geographicGrant,
    })),
  );

const arwSteps = steps
  .filter((s) => s.name === 'acquisition.area_route_walk')
  .map((s) => ({
    intentKey: s.input?.intentKey,
    anchor: s.input?.anchor?.rawName,
    outcome: s.output?.outcome,
    reason: s.output?.reason,
    diagnostics: s.output?.diagnostics?.materialization,
  }));

const passes = steps
  .filter((s) => s.name === 'acquisition.pass')
  .map((pass) => {
    const f = pass.facts ?? {};
    const web = children(pass.id, 'acquisition.web_search').map((w) => ({
      query: w.facts?.query,
      status: w.decision?.outcome,
      evidenceCount: w.facts?.evidenceCount,
    }));
    const retrieval = children(pass.id, 'acquisition.source_retrieval').map(
      (r) => ({
        retrieved: r.facts?.retrievedUrls,
        failed: (r.facts?.failedUrls ?? []).map((u) => u.url ?? u),
      }),
    );
    const extraction = children(pass.id, 'acquisition.semantic_extraction').map(
      (e) => ({
        extracted: e.facts?.extractedCandidateCount,
        admitted: e.facts?.candidateCount,
        attempts: (e.facts?.extractionAttempts ?? []).map((a) => ({
          inputKind: a.inputKind,
          sourceUrl: a.sourceUrl,
          window: a.windowOrdinal ? `${a.windowOrdinal}/${a.windowCount}` : undefined,
          extracted: a.extractedCandidateCount,
          admitted: a.admittedCandidateCount,
          scanDecision: a.scanDecision,
          failureReason: a.failureReason,
          decisions: (a.candidateDecisions ?? []).map((d) => ({
            name: d.name,
            components: d.componentHintCount,
            accepted: d.accepted,
            shape: d.candidateShapeMatches,
          })),
        })),
        subjects: (e.subjects ?? []).map((x) => ({
          name: x.subject?.label,
          outcome: x.decision?.outcome,
        })),
      }),
    );
    const geography = children(pass.id, 'geography.validation').flatMap((g) =>
      (g.facts?.geographicValidationAudit ?? []).map((a) => ({
        candidate: a.candidateName,
        accepted: a.accepted,
        strategy: a.strategy,
        authorization: a.geographicAuthorization,
        reasons: a.rejectionReasons,
      })),
    );
    const entity = children(pass.id, 'resolution.entity').map((e) => ({
      truncated: e.facts?.truncated === true,
      originalChars: e.facts?.originalChars,
      subjects: (e.subjects ?? []).map((x) => ({
        name: x.subject?.label,
        outcome: x.decision?.outcome,
        reason: x.decision?.reason,
      })),
    }));
    const compact = children(pass.id, 'resolution.component_identity').map(
      (c) => ({
        chars: JSON.stringify(c).length,
        candidate: c.facts?.candidateName,
        authorization: c.facts?.geographicAuthorization,
        candidateStatus: c.facts?.candidateStatus,
        rejectionReasons: c.facts?.rejectionReasons,
        components: (c.facts?.components ?? []).map((k) => ({
          hintKey: k.hintKey,
          name: k.name,
          strategies: k.strategiesAttempted,
          candidateAcquired: k.candidateAcquired,
          selected: k.selectedCandidate,
          identityVerdict: k.identityVerdict,
          destinationCompatibility: k.destinationCompatibility,
          finalStatus: k.finalStatus,
          finalReason: k.finalReason,
          placeSearchScopes: (k.attempts ?? [])
            .map((a) => a.placeSearch?.searchScope?.kind)
            .filter(Boolean),
        })),
      }),
    );
    const materialization = children(pass.id, 'catalog.materialization').map(
      (m) => ({
        outcome: m.decision?.outcome,
        references: m.references,
        subjects: (m.subjects ?? []).map((x) => ({
          name: x.subject?.label,
          outcome: x.decision?.outcome,
        })),
      }),
    );
    return {
      id: pass.id,
      strategy: f.strategy,
      workUnit: f.workUnit
        ? {
            kind: f.workUnit.kind,
            deficit: f.workUnit.deficit
              ? `${f.workUnit.deficit.dimension ?? f.workUnit.deficit.origin}:${f.workUnit.deficit.key ?? ''}`
              : (f.workUnit.deficits ?? []).map((d) => `${d.dimension}:${d.key}`),
            anchor: f.workUnit.anchor?.rawName,
          }
        : undefined,
      grant: f.geographicGrant,
      webQuery: f.webQuery,
      requestedIntents: f.requestedIntents,
      requestedThemes: f.requestedThemes,
      anchorNames: f.anchorNames,
      evidenceRequirements: f.evidenceRequirements,
      candidateCount: f.candidateCount,
      web,
      retrieval,
      extraction,
      entity,
      compact,
      geography,
      materialization,
    };
  });

const truncatedSteps = steps
  .filter((s) => s.facts?.truncated === true)
  .map((s) => ({ name: s.name, originalChars: s.facts?.originalChars }));

console.log(
  JSON.stringify(
    {
      runtime: trace.runtime,
      result: trace.result
        ? { status: trace.result.status, outcome: trace.result.outcome, reason: trace.result.reason }
        : undefined,
      routing,
      arwSteps,
      passes,
      truncatedSteps,
    },
    null,
    2,
  ),
);
