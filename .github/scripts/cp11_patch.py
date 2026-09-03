from pathlib import Path

# Preserve deterministic solver routing evidence in the persisted trace.
builder = Path('be/src/modules/tours/utils/generation-trace-builder.util.ts')
text = builder.read_text()
routing_marker = "      routing: solution.metadata.routing,"
if routing_marker not in text:
    anchor = "      score: solution.score,\n      days: solution.days.map((day) => ({"
    daily = text.index('    dailyPlanning: {')
    pos = text.index(anchor, daily)
    text = text[:pos] + text[pos:].replace(
        anchor,
        "      score: solution.score,\n      routing: solution.metadata.routing,\n      days: solution.days.map((day) => ({",
        1,
    )
builder.write_text(text)

# Wire the canonical V3 trace builder into the real generation runtime.
service = Path('be/src/modules/tours/services/experience-generation.service.ts')
text = service.read_text()
old_import = "import { redactTracePayload } from '../utils/trace-redaction.util';"
new_import = old_import + "\nimport {\n  buildExecutionSummary,\n  buildGenerationTraceV3,\n} from '../utils/generation-trace-v3.util';"
if "buildGenerationTraceV3" not in text:
    assert old_import in text
    text = text.replace(old_import, new_import, 1)

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

      const generationTrace = buildGenerationTraceV3({
        canonicalRequest: request,
        steps: traceSteps,
        tourCompleteness: {
          ...completeness,
          retryAttempted: correctiveRetryAttempted,
        },
        materializedTourExperiences,
      });"""
if "const materializedTourExperiences" not in text:
    assert old_trace in text, 'generation trace success anchor not found'
    text = text.replace(old_trace, new_trace, 1)

if "const executionSummary = buildExecutionSummary({" not in text:
    start = text.index('      const executionSummary = {', text.index('const completedMessage'))
    end = text.index('      const completedTour =', start)
    new_summary = """      const executionSummary = buildExecutionSummary({
        status: 'completed',
        steps: traceSteps,
        materialized: materializedTourExperiences,
        acceptedExperiences: Math.max(
          selectedExperiences.length,
          traceStepList
            .filter((step: any) => step.stage === 'entity_resolution')
            .reduce(
              (sum: number, step: any) =>
                sum + Number((step.resolution as any)?.acceptedCount ?? 0),
              0,
            ),
        ),
        rejectedProposals: traceStepList
          .filter((step: any) => step.stage === 'entity_resolution')
          .reduce(
            (sum: number, step: any) =>
              sum + Number((step.resolution as any)?.rejectedCount ?? 0),
            0,
          ),
        selectedExperiences: selectedExperiences.length,
      });
"""
    text = text[:start] + new_summary + text[end:]

old_failure = """                  executionSummary: {
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
new_failure = """                  version: 3,
                  canonicalRequest: redactTracePayload(
                    (latestTour?.metadata as any)?.generationRequest ??
                      metadata?.generationRequest ??
                      {},
                  ),
                  executionSummary: buildExecutionSummary({
                    status: 'failed',
                    steps: traceSteps,
                    failure: error?.message || String(error),
                  }),"""
if old_failure in text:
    text = text.replace(old_failure, new_failure, 1)
service.write_text(text)

# Strengthen the real 320-row PostgreSQL E2E with V3 evidence and exact
# deterministic repeat. This does not import ranking/coverage/planner internals.
e2e = Path('be/test/experience-selection-scale.e2e-spec.ts')
text = e2e.read_text()
if 'const generationRequest = {' not in text:
    send_anchor = """    const createResponse = await request(app.getHttpServer())
      .post('/tours/generate-tour')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({"""
    assert send_anchor in text
    text = text.replace(send_anchor, '    const generationRequest = {', 1)
    end_request = """        categories: [],
      })
      .expect(201);"""
    assert end_request in text
    text = text.replace(
        end_request,
        """        categories: [],
      };

    const createResponse = await request(app.getHttpServer())
      .post('/tours/generate-tour')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(generationRequest)
      .expect(201);""",
        1,
    )

if 'generationTrace.version).toBe(3)' not in text:
    trace_anchor = '    const traceSteps = tour.metadata.generationTrace.steps;'
    assert trace_anchor in text
    text = text.replace(
        trace_anchor,
        """    expect(tour.metadata.generationTrace.version).toBe(3);
    expect(tour.metadata.generationTrace.canonicalRequest).toMatchObject({
      destination: { label: 'Obelisco, Buenos Aires' },
      days: 2,
      intent: { interests: ['tango'] },
    });
    expect(tour.metadata.generationTrace.materializedTourExperiences).toHaveLength(
      tour.experiences.length,
    );
    const traceSteps = tour.metadata.generationTrace.steps;""",
        1,
    )

if "stage: 'tour_experience_materialization'" not in text:
    completion = """    expect(tour.metadata.executionSummary.selectedExperiences).toBe(
      tour.experiences.length,
    );"""
    assert completion in text
    text = text.replace(
        completion,
        completion + """
    expect(tour.metadata.executionSummary.orderedStages.at(-1)).toMatchObject({
      stage: 'tour_experience_materialization',
      outcome: 'TOUR_EXPERIENCES_PERSISTED',
    });
    const planningTrace = traceSteps.find(
      (step: any) => step.stage === 'daily_planning',
    );
    expect(planningTrace.dailyPlanning.routing.providerCounts.geoapify).toBeGreaterThan(0);
    expect(planningTrace.dailyPlanning.routing.externalEstimateCount).toBeGreaterThan(0);""",
        1,
    )

if 'const normalizePlan = (value: any)' not in text:
    replay_anchor = """    expect(storedGenerationEvent?.status).toBe('PUBLISHED');
  });"""
    assert replay_anchor in text
    text = text.replace(
        replay_anchor,
        """    expect(storedGenerationEvent?.status).toBe('PUBLISHED');

    const secondCreate = await request(app.getHttpServer())
      .post('/tours/generate-tour')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(generationRequest)
      .expect(201);
    const secondTourId = secondCreate.body.id;
    expect(secondTourId).not.toBe(tourId);

    const secondGenerationEvent = await prisma.outboxEvent.findFirst({
      where: {
        eventType: 'TourGenerationRequested',
        payload: { path: ['tourId'], equals: secondTourId },
      },
    });
    expect(secondGenerationEvent).toBeTruthy();
    await outboxPublisher.processNextBatch();

    const secondTourResponse = await request(app.getHttpServer())
      .get(`/tours/${secondTourId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const secondTour = secondTourResponse.body;
    expect(secondTour.metadata.generationStatus).toBe('completed');

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
  });""",
        1,
    )
e2e.write_text(text)

# There must be one execution-summary implementation, not two subtly
# different audit contracts.
for duplicate in [
    Path('be/src/modules/tours/utils/generation-execution-summary.util.ts'),
    Path('be/src/modules/tours/utils/generation-execution-summary.util.spec.ts'),
]:
    if duplicate.exists():
        duplicate.unlink()
