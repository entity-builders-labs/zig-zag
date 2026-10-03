const fs = require('fs');
const path = require('path');

function analyzeRun(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'run-manifest.json'), 'utf8'));
  const trace = JSON.parse(fs.readFileSync(path.join(dir, 'generation-trace.json'), 'utf8'));
  const dbBefore = JSON.parse(fs.readFileSync(path.join(dir, 'db-before.json'), 'utf8'));
  const dbAfter = JSON.parse(fs.readFileSync(path.join(dir, 'db-after.json'), 'utf8'));
  const tour = JSON.parse(fs.readFileSync(path.join(dir, 'terminal-tour.json'), 'utf8'));

  let providerRequests = {};
  const reqPath = path.join(dir, 'provider-requests.ndjson');
  if (fs.existsSync(reqPath)) {
    const lines = fs.readFileSync(reqPath, 'utf8').trim().split('\n').filter(Boolean);
    for (const l of lines) {
      const item = JSON.parse(l);
      const k = item.key || 'other';
      providerRequests[k] = (providerRequests[k] || 0) + 1;
    }
  }

  const steps = trace.steps || [];
  const coverage1 = steps.find(s => s.name === 'coverage.analysis');
  const coverageLast = [...steps].reverse().find(s => s.name === 'coverage.analysis');

  const tourExperiences = (tour.experiences || []).map(e => ({
    name: e.experience?.canonicalName || e.experience?.name,
    id: e.experienceId,
    order: e.order,
    day: e.dayNumber
  }));

  const analysis = {
    tourId: manifest.tourId,
    generationStatus: manifest.generationStatus,
    pollElapsedMs: manifest.pollElapsedMs,
    traceVersion: trace.version,
    totalSteps: steps.length,
    dbBefore: {
      geoEntities: dbBefore.geoEntity,
      experiences: dbBefore.experience,
      identities: dbBefore.geoEntityIdentity,
      components: dbBefore.experienceComponent
    },
    dbAfter: {
      geoEntities: dbAfter.geoEntity,
      experiences: dbAfter.experience,
      identities: dbAfter.geoEntityIdentity,
      components: dbAfter.experienceComponent,
      duplicateExperienceNames: dbAfter.duplicateExperienceNames,
      duplicateIdentities: dbAfter.duplicateIdentityRows
    },
    providerRequests,
    initialCoverage: coverage1 ? {
      sufficient: coverage1.output?.sufficient,
      outcome: coverage1.decision?.outcome,
      deficits: coverage1.output?.deficits
    } : null,
    finalCoverage: coverageLast ? {
      sufficient: coverageLast.output?.sufficient,
      outcome: coverageLast.decision?.outcome,
      deficits: coverageLast.output?.deficits
    } : null,
    scheduledExperiences: tourExperiences
  };

  fs.writeFileSync(path.join(dir, 'analysis.json'), JSON.stringify(analysis, null, 2));
  console.log(`Analysis written to ${path.join(dir, 'analysis.json')}`);
  return analysis;
}

const cold = analyzeRun(path.join(__dirname, 'cold'));
if (fs.existsSync(path.join(__dirname, 'warm', 'run-manifest.json'))) {
  const warm = analyzeRun(path.join(__dirname, 'warm'));
  console.log('WARM analysis summary:', JSON.stringify(warm, null, 2));
}
console.log('COLD analysis summary:', JSON.stringify(cold, null, 2));

