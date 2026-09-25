// Spike-only, read-only: calls the REAL planner/facet retrieval boundaries
// (ExperienceCatalogService.findVerifiedWithin / findVerifiedWithinForMatching,
// both `status = VERIFIED`) on one spike DB and prints what they return.
// Usage (from be/): DATABASE_URL=... node <this> <lat> <lng> <radiusMeters>
const path = require('node:path');
const dist = path.resolve(process.cwd(), 'dist/src');
const { PrismaService } = require(`${dist}/core/database/prisma.service.js`);
const {
  ExperienceCatalogService,
} = require(`${dist}/modules/tours/services/experience-catalog.service.js`);
(async () => {
  const [lat, lng, radius] = process.argv.slice(2).map(Number);
  const prisma = new PrismaService({ get: () => process.env.DATABASE_URL });
  const catalog = new ExperienceCatalogService(prisma, {});
  const planner = await catalog.findVerifiedWithin(lat, lng, radius, 1000);
  const matching = await catalog.findVerifiedWithinForMatching(lat, lng, radius);
  const describe = (rows) =>
    rows.map((row) => ({
      id: row.id,
      name: row.canonicalName ?? row.name,
      componentGeoEntityIds: (row.components ?? [])
        .map((c) => c.geoEntityId ?? c.geoEntity?.id)
        .sort(),
    }));
  console.log(
    JSON.stringify(
      { findVerifiedWithin: describe(planner), findVerifiedWithinForMatching: describe(matching) },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
