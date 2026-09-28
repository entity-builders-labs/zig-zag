#!/usr/bin/env node
/**
 * Sequence integrity machine check for RW3 COLD -> WARM runs.
 * Verifies: cold/db-after.json == warm/db-before.json (ignoring capturedAt timestamp).
 * Exits 0 on exact match; exits 1 with detailed mismatch report if not identical.
 */
const fs = require('fs');
const path = require('path');

const coldPath = path.resolve(__dirname, 'cold', 'db-after.json');
const warmPath = path.resolve(__dirname, 'warm', 'db-before.json');

if (!fs.existsSync(coldPath)) {
  console.error(`[SEQUENCE INTEGRITY] ERROR: Missing ${coldPath}`);
  process.exit(1);
}
if (!fs.existsSync(warmPath)) {
  console.error(`[SEQUENCE INTEGRITY] ERROR: Missing ${warmPath}`);
  process.exit(1);
}

const cold = JSON.parse(fs.readFileSync(coldPath, 'utf8'));
const warm = JSON.parse(fs.readFileSync(warmPath, 'utf8'));

// Delete capturedAt timestamp before comparison
delete cold.capturedAt;
delete warm.capturedAt;

const coldStr = JSON.stringify(cold);
const warmStr = JSON.stringify(warm);

if (coldStr === warmStr) {
  console.log('[SEQUENCE INTEGRITY] PASS: cold/db-after matches warm/db-before exactly.');
  console.log(`  Database: ${cold.database}`);
  console.log(`  GeoEntities: ${cold.geoEntity}`);
  console.log(`  Experiences: ${cold.experience}`);
  console.log(`  GeoEntityIdentities: ${cold.geoEntityIdentity}`);
  console.log(`  ExperienceComponents: ${cold.experienceComponent}`);
  process.exit(0);
} else {
  console.error('[SEQUENCE INTEGRITY] FAIL: cold/db-after DOES NOT MATCH warm/db-before!');
  console.error('Differences detected:');
  const allKeys = Array.from(new Set([...Object.keys(cold), ...Object.keys(warm)]));
  for (const k of allKeys) {
    const cVal = JSON.stringify(cold[k]);
    const wVal = JSON.stringify(warm[k]);
    if (cVal !== wVal) {
      console.error(`  - Key "${k}":`);
      console.error(`      cold/db-after: ${cVal}`);
      console.error(`      warm/db-before: ${wVal}`);
    }
  }
  process.exit(1);
}
