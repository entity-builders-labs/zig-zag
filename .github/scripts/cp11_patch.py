from pathlib import Path

# Preserve deterministic solver routing evidence in the trace.
p = Path('be/src/modules/tours/utils/generation-trace-builder.util.ts')
s = p.read_text()
anchor = """      score: solution.score,
      days: solution.days.map((day) => ({"""
replacement = """      score: solution.score,
      routing: solution.metadata.routing,
      days: solution.days.map((day) => ({"""
daily = s.index('    dailyPlanning: {')
pos = s.index(anchor, daily)
s = s[:pos] + s[pos:].replace(anchor, replacement, 1)
p.write_text(s)

p = Path('be/src/modules/tours/services/experience-generation.service.ts')
s = p.read_text()
import_anchor = "import { redactTracePayload } from '../utils/trace-redaction.util';\n"
import_line = "import { buildGenerationExecutionSummary } from '../utils/generation-execution-summary.util';\n"
if import_line not in s:
    assert import_anchor in s
    s = s.replace(import_anchor, import_anchor + import_line, 1)

old_trace = """      const generationTrace = redactTracePayload({
        steps: traceSteps,
        tourCompleteness: {
          ...completeness,
          retryAttempted: correctiveRetryAttempted,
        },
      });"""
new_trace = """      const materializedTourExperiences = selectedExperiences
        .filter((selected) =>
          experienceEntities.some(
            (experience) => experience.id === selected.experienceId,
          ),
        )
        .map((selected) => {
          const experience = experienceEntities.find(
            (candidate) => candidate.id === selected.experienceId,
          )!;
          return {
            experienceId: selected.experienceId,
            dayNumber: selected.dayNumber,
            order: selected.order,
            startTime: selected.startTime?.toISOString(),
            durationHours: selected.duration,
            componentCount: experience.components.length,
          };
        });

      const generationTrace = redactTracePayload({
        version: 3,
        canonicalRequest: request,
        steps: traceSteps,
        materializedTourExperiences,
        tourCompleteness: {
          ...completeness,
          retryAttempted: correctiveRetryAttempted,
        },
      });"""
assert old_trace in s
s = s.replace(old_trace, new_trace, 1)

start = s.index('      const executionSummary = {', s.index('const completedMessage'))
end = s.index('      const completedTour =', start)
new_summary = """      const acceptedExperiences = Math.max(
        selectedExperiences.length,
        traceStepList
          .filter((step: any) => step.stage === 'entity_resolution')
          .reduce(
            (sum: number, step: any) =>
              sum + Number((step.resolution as any)?.acceptedCount ?? 0),
            0,
          ),
      );
      const rejectedProposals = traceStepList
        .filter((step: any) => step.stage === 'entity_resolution')
        .reduce(
          (sum: number, step: any) =>
            sum + Number((step.resolution as any)?.rejectedCount ?? 0),
          0,
        );
      const executionSummary = buildGenerationExecutionSummary({
        status: 'completed',
        steps: traceStepList,
        materializedTourExperiences,
        acceptedExperiences,
        rejectedProposals,
      });
"""
s = s[:start] + new_summary + s[end:]

failure = """                  executionSummary: {
                    status: 'failed',
                    steps: traceSteps
                      .map((step) => step.summary)
                      .filter(Boolean),
                    narrative: traceSteps
                      .map((step, index) => `${index + 1}. ${step.summary}`)
                      .filter(Boolean)
                      .join('\\n'),
                    failure: error?.message || String(error),
                  },"""
failure_new = """                  version: 3,
                  canonicalRequest:
                    (latestTour?.metadata as any)?.generationRequest ??
                    metadata?.generationRequest ??
                    {},
                  executionSummary: buildGenerationExecutionSummary({
                    status: 'failed',
                    steps: traceSteps,
                    failure: error?.message || String(error),
                  }),"""
assert failure in s
s = s.replace(failure, failure_new, 1)
p.write_text(s)

# Strengthen the real 320-row E2E with V3 evidence and exact repeat determinism.
p = Path('be/test/experience-selection-scale.e2e-spec.ts')
s = p.read_text()
send_anchor = """    const createResponse = await request(app.getHttpServer())
      .post('/tours/generate-tour')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({"""
assert send_anchor in s
s = s.replace(send_anchor, '    const generationRequest = {', 1)
end_request = """        categories: [],
      })
      .expect(201);"""
assert end_request in s
s = s.replace(end_request, """        categories: [],
      };

    const createResponse = await request(app.getHttpServer())
      .post('/tours/generate-tour')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(generationRequest)
      .expect(201);""", 1)
trace_anchor = '    const traceSteps = tour.metadata.generationTrace.steps;'
assert trace_anchor in s
s = s.replace(trace_anchor, """    expect(tour.metadata.generationTrace.version).toBe(3);
    expect(tour.metadata.generationTrace.materializedTourExperiences).toHaveLength(
      tour.experiences.length,
    );
    const traceSteps = tour.metadata.generationTrace.steps;""", 1)
completion = """    expect(tour.metadata.executionSummary.selectedExperiences).toBe(
      tour.experiences.length,
    );"""
assert completion in s
s = s.replace(completion, completion + """
    expect(tour.metadata.executionSummary.orderedStages.at(-1)).toMatchObject({
      stage: 'tour_experience_materialization',
      outcome: 'TOUR_EXPERIENCES_PERSISTED',
    });
    const planningTrace = traceSteps.find(
      (step: any) => step.stage === 'daily_planning',
    );
    expect(planningTrace.dailyPlanning.routing.providerCounts.geoapify).toBeGreaterThan(0);""", 1)
replay_anchor = """    expect(storedGenerationEvent?.status).toBe('PUBLISHED');
  });"""
assert replay_anchor in s
s = s.replace(replay_anchor, """    expect(storedGenerationEvent?.status).toBe('PUBLISHED');

    const secondCreate = await request(app.getHttpServer())
      .post('/tours/generate-tour')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(generationRequest)
      .expect(201);
    const secondTourId = secondCreate.body.id;
    await outboxPublisher.processNextBatch();
    const secondTourResponse = await request(app.getHttpServer())
      .get(`/tours/${secondTourId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const secondTour = secondTourResponse.body;
    const normalizePlan = (value: any) =>
      value.experiences.map((item: any) => ({
        experienceId: item.experienceId,
        dayNumber: item.dayNumber,
        order: item.order,
        startTime: item.startTime,
        duration: item.duration,
        components: item.components.map((component: any) => ({
          geoEntityId: component.geoEntityId,
          order: component.order,
          role: component.role,
          required: component.required,
        })),
      }));
    expect(normalizePlan(secondTour)).toEqual(normalizePlan(tour));
    expect(secondTour.metadata.generationTrace.version).toBe(3);
  });""", 1)
p.write_text(s)
