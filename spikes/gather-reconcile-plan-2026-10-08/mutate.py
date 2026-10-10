#!/usr/bin/env python3
"""Apply one mutation at a time, run the targeted tests, record, restore."""
import os, re, shutil, subprocess, sys

BE = '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be'
GEN = 'src/modules/tours/services/experience-generation.service.ts'
CAT = 'src/modules/tours/services/experience-catalog.service.ts'
POL = 'src/modules/tours/utils/source-knowledge-reconciliation.policy.ts'
UNIT = 'npx jest {spec}'
INTEG = 'npx jest -c test/jest-integration.json {spec}'
GRP = 'test/integration/tour-generation/gather-reconcile-plan.integration-spec.ts'
SKR = 'test/integration/tour-generation/source-knowledge-reconciliation.integration-spec.ts'
SEAM = 'src/modules/tours/services/experience-generation.gather-reconcile-plan.spec.ts'
POLSPEC = 'src/modules/tours/utils/source-knowledge-reconciliation.policy.spec.ts'

REFILL_REREAD = """        snapshot = await readSnapshot('GATHER');
        selection = await composeSnapshot(snapshot);
        semanticRankingOutcome = selection.semanticRanking;
        plan = await this.planFromSelection("""

MUTATIONS = [
    ('M1 final candidate set reuses the pre-gather array', GEN, REFILL_REREAD,
     REFILL_REREAD.replace("snapshot = await readSnapshot('GATHER');",
                           'snapshot = { ...snapshot, acquisitionEpoch };'),
     [INTEG.format(spec=GRP)]),
    ('M2 refill-persisted Experience omitted from the final snapshot', GEN, REFILL_REREAD,
     REFILL_REREAD.replace("snapshot = await readSnapshot('GATHER');",
                           "snapshot = await readSnapshot('GATHER');\n        snapshot = { ...snapshot, experiences: snapshot.experiences.filter((e) => !gatherExecutions.some((x) => x.workUnit === 'PLANNER_CAPACITY' && x.outcomes.some((o) => o.experienceId === e.id))) };"),
     [INTEG.format(spec=GRP)]),
    ('M3 SAME enrichment does not copy a newly resolved member', CAT,
     "if (member.change !== 'RESOLVED_BY_OBSERVATION') continue;",
     'continue;', [INTEG.format(spec=SKR)]),
    ('M4 enrichment overwrites a conflicting resolution', POL,
     'conflict ||= classConflict;', 'conflict ||= false && classConflict;',
     [UNIT.format(spec=POLSPEC)]),
    ('M5 source discovery order changes the final candidate universe', GEN,
     """      experiences: [...byId.values()].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),""", '      experiences: [...byId.values()],', [UNIT.format(spec=SEAM)]),
    ('M6 final ranking skipped after gather', GEN, REFILL_REREAD,
     REFILL_REREAD.replace('        selection = await composeSnapshot(snapshot);\n', ''),
     [INTEG.format(spec=GRP)]),
    ('M7 stale semantic document/embedding treated as current', CAT,
     'await tx.$executeRaw`UPDATE "experience" SET "embedding" = NULL WHERE "id" = ${same.id}`;',
     '/* mutated: embedding kept */', [INTEG.format(spec=SKR)],
     ("""            embeddingProvider: null,
            embeddingModel: null,
            embeddingDimensions: null,
            embeddingDocumentVersion: null,
            embeddedAt: null,
          },
          include: { components: true, evidence: true, traits: true },""", """          },
          include: { components: true, evidence: true, traits: true },""")),
    ('M8 provisional (pre-refill) plan leaks into the Tour', GEN,
     """      let plan = await this.planFromSelection(
        selection,
        planningBase,
        preferenceSpec,
      );""",
     """      let plan = await this.planFromSelection(
        selection,
        planningBase,
        preferenceSpec,
      );
      const provisionalPlanForMutation = plan;""",
     [INTEG.format(spec=GRP)], ("      } = plan;\n      planningSolution.metadata.convergence", "      } = provisionalPlanForMutation;\n      planningSolution.metadata.convergence")),
]

env = dict(os.environ)
results = []
ONLY = os.environ.get('ONLY')
for name, rel, old, new, cmds, *extra in MUTATIONS:
    if ONLY and not name.startswith(ONLY):
        continue
    path = os.path.join(BE, rel)
    backup = path + '.mutbak'
    shutil.copy(path, backup)
    try:
        src = open(path).read()
        assert src.count(old) == 1, f'{name}: anchor count {src.count(old)}'
        src = src.replace(old, new, 1)
        for a, b in extra:
            assert src.count(a) == 1, f'{name}: extra anchor count {src.count(a)}'
            src = src.replace(a, b, 1)
        open(path, 'w').write(src)
        failed = []
        for cmd in cmds:
            run = subprocess.run(cmd, shell=True, cwd=BE, env=env,
                                 capture_output=True, text=True)
            out = run.stdout + run.stderr
            summary = re.findall(r'Tests:.*', out)
            killed = run.returncode != 0
            failing = re.findall(r'✕ (.*?) \(', out)
            failed.append((cmd.split()[-1].split('/')[-1], killed, summary[-1] if summary else 'no summary (compile error?)', failing[:4]))
        results.append((name, failed))
    finally:
        shutil.move(backup, path)

for name, failed in results:
    status = 'KILLED' if all(k for _, k, _, _ in failed) else 'SURVIVED'
    print(f'{status}: {name}')
    for spec, killed, summary, failing in failed:
        print(f'    {spec}: {summary}')
        for test in failing:
            print(f'      ✕ {test}')
