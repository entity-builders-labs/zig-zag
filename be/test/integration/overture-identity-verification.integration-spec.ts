import { PrismaService } from 'src/core/database/prisma.service';
import {
  OverturePlaceImportRecord,
  OverturePlacesIndexService,
  OvertureCoverageCompleteness,
} from 'src/modules/integrations/overture/overture-places-index.service';
import { IdentityVerifier } from 'src/modules/tours/services/identity-verifier.service';
import { buildLocalIdentityEvidence } from 'src/modules/tours/utils/identity-evidence-builder.util';
import {
  IdentityEvidence,
  VerificationDecision,
} from 'src/modules/tours/interfaces/experience-resolution.interface';
import { closeDb, getPrisma, resetDb } from './support/test-db';
import { assertDisposableDatabase } from '../support/assert-disposable-database';

/**
 * Overture index -> local identity evidence -> IdentityVerifier on a real
 * Postgres, with the real Overture 2026-09-23.1 records characterized in
 * spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/
 * identity-characterization/overture/*.json. Each record is ONE upstream
 * row: its name, category and location are not independent confirmations.
 */
const RELEASE = '2026-09-23.1';
const meta = (upstreamRecordId: string) => ({
  upstreamDataset: 'meta',
  upstreamRecordId,
  license: 'CDLA-Permissive-2.0',
});

const ALFA_CRUX: OverturePlaceImportRecord = {
  featureId: '79eb9ee4-0591-49f3-a077-51a7926a3ada',
  countryCode: 'AR',
  name: 'Alfa Crux',
  latitude: -33.8040574593,
  longitude: -69.119154850671,
  address: 'El Cepillo',
  ...meta('113197860037852'),
};
const SUPERUCO: OverturePlaceImportRecord = {
  featureId: '753ed444-8e83-4178-8ad3-a05e9a28b7c5',
  countryCode: 'AR',
  name: 'SuperUco',
  latitude: -33.60353978,
  longitude: -69.22870399,
  address: 'Ruta Nacional 94 11',
  ...meta('276131252581993'),
};
// Same brand, two facilities: the Tupungato winery and the Tunuyan store
// (shared website and phone).
const LA_AZUL_WINERY: OverturePlaceImportRecord = {
  featureId: 'd97a65d2-7613-41eb-ab26-fc577699f26d',
  countryCode: 'AR',
  name: 'Bodega La Azul',
  latitude: -33.46941806,
  longitude: -69.22094381,
  address: 'Caminos del Vino',
  ...meta('1893816807339177'),
};
const LA_AZUL_STORE: OverturePlaceImportRecord = {
  featureId: '673c6cb8-b314-4650-a5c1-ef10d59be7c0',
  countryCode: 'AR',
  name: 'Bodega la Azul',
  latitude: -33.57818742,
  longitude: -69.01609022,
  address: 'Avenida Gral San Martin 1131',
  ...meta('323045118358807'),
};
// One physical winery, two unconflated upstream rows (Meta + Microsoft).
const A16_META: OverturePlaceImportRecord = {
  featureId: '8a73108f-cdd4-4b19-8a24-7cc78f14fbd2',
  countryCode: 'AR',
  name: 'Bodega A16',
  latitude: -33.091156,
  longitude: -68.90458,
  address: 'Cobos 5890',
  ...meta('1396967760585038'),
};
const A16_MICROSOFT: OverturePlaceImportRecord = {
  featureId: '7eaf553c-dfdb-4462-ab4e-1f3d6656f3f1',
  countryCode: 'AR',
  name: 'Bodega A16',
  latitude: -33.0917642,
  longitude: -68.9144161,
  address: 'Calle Cobos',
  upstreamDataset: 'Microsoft',
  upstreamRecordId: '1407374888439853',
  license: 'CDLA-Permissive-2.0',
};
const AOI_RECORDS = [
  ALFA_CRUX,
  SUPERUCO,
  LA_AZUL_WINERY,
  LA_AZUL_STORE,
  A16_META,
  A16_MICROSOFT,
];

describe('Overture identity lookup -> IdentityVerifier (real Postgres)', () => {
  let prisma: PrismaService;
  let index: OverturePlacesIndexService;
  const verifier = new IdentityVerifier();

  beforeAll(async () => {
    assertDisposableDatabase();
    prisma = await getPrisma();
    index = new OverturePlacesIndexService(prisma);
  });
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await resetDb();
    await closeDb();
  });

  async function publish(
    id: string,
    countryCode: string,
    completeness: OvertureCoverageCompleteness,
    records: OverturePlaceImportRecord[],
  ): Promise<void> {
    await index.beginImport({
      id,
      release: RELEASE,
      sourceUri: `s3://overturemaps-us-west-2/release/${RELEASE}/theme=places/type=place/`,
      countryCode,
      partitionKey: id,
      completeness,
      expectedSourceCoverage:
        completeness === 'COMPLETE_COUNTRY'
          ? 'COUNTRY_ENUMERATED'
          : 'OPERATIONAL_AOI',
      expectedPageKeys: ['page-1'],
    });
    await index.importBatch({ sessionId: id, pageKey: 'page-1', records });
    await index.finalizeImport(id, { release: RELEASE });
  }

  async function decide(hintName: string, countryCode = 'AR') {
    const lookup = await index.lookupExactPlace({
      hintKey: hintName,
      hintName,
      countryCode,
      role: 'venue',
    });
    // Every pool member carries the same pool-level name multiplicity, so
    // the decision without source context is the same for each of them.
    const candidate = lookup.candidates[0];
    if (!candidate) {
      return {
        lookup,
        candidate: undefined,
        evidence: [] as IdentityEvidence[],
        decision: undefined as VerificationDecision | undefined,
      };
    }
    const evidence = buildLocalIdentityEvidence({ name: hintName }, candidate);
    const decision = verifier.verify(
      { name: hintName },
      { strategy: 'OVERTURE_IDENTITY', candidate, evidence },
    );
    return { lookup, candidate, evidence, decision };
  }

  it('Alfa Crux / SuperUco from the published AOI snapshot: exact but multiplicity UNKNOWN -> INSUFFICIENT_EVIDENCE, provenance carried', async () => {
    await publish('ar-uco-aoi', 'AR', 'PARTIAL_PARTITION', AOI_RECORDS);

    for (const record of [ALFA_CRUX, SUPERUCO]) {
      const { lookup, candidate, evidence, decision } = await decide(
        record.name,
      );
      expect(lookup.coverage).toBe('PARTIAL_OR_UNKNOWN');
      expect(candidate?.externalId).toBe(record.featureId);
      expect(candidate?.upstreamDatasets).toEqual(['meta']);
      expect(candidate?.structuralKind).toBe('UNKNOWN');
      expect(candidate?.persistenceMetadata).toMatchObject({
        overture: {
          release: RELEASE,
          upstreamDataset: 'meta',
          upstreamRecordId: record.upstreamRecordId,
          license: 'CDLA-Permissive-2.0',
        },
      });
      expect(evidence).toEqual([
        { type: 'EXACT_NAME', identityMultiplicity: 'UNKNOWN' },
      ]);
      expect(decision).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });
    }
  });

  it('a complete-country snapshot establishes uniqueness: the same Alfa Crux record verifies on EXACT_NAME + SINGLE', async () => {
    await publish('ar-complete', 'AR', 'COMPLETE_COUNTRY', AOI_RECORDS);

    const { evidence, decision } = await decide('Alfa Crux');
    expect(evidence).toEqual([
      { type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' },
    ]);
    expect(decision).toEqual({ status: 'VERIFIED' });
  });

  it('same brand, different physical facility: "Bodega La Azul" winery + store stay AMBIGUOUS even in a complete snapshot', async () => {
    await publish('ar-complete', 'AR', 'COMPLETE_COUNTRY', AOI_RECORDS);

    const { lookup, decision } = await decide('Bodega La Azul');
    expect(lookup.resultCount).toBe(2);
    // The whole pool reaches candidate selection, not an arbitrary row.
    expect(lookup.candidates).toHaveLength(2);
    expect(
      new Set(lookup.candidates.map((candidate) => candidate.externalId)).size,
    ).toBe(2);
    expect(decision).toEqual({ status: 'AMBIGUOUS' });
  });

  it('Bodega Azul (source name) is never matched to a "Bodega La Azul" record: no candidate', async () => {
    await publish('ar-complete', 'AR', 'COMPLETE_COUNTRY', AOI_RECORDS);

    const { lookup, decision } = await decide('Bodega Azul');
    expect(lookup.resultCount).toBe(0);
    expect(lookup.candidates).toEqual([]);
    expect(decision).toBeUndefined();
  });

  it('A16 negative control: no exact record, and the two unconflated "Bodega A16" rows are AMBIGUOUS', async () => {
    await publish('ar-complete', 'AR', 'COMPLETE_COUNTRY', AOI_RECORDS);

    const a16 = await decide('A16');
    expect(a16.lookup.resultCount).toBe(0);
    expect(a16.lookup.candidates).toEqual([]);

    const bodegaA16 = await decide('Bodega A16');
    expect(bodegaA16.lookup.resultCount).toBe(2);
    expect(bodegaA16.decision).toEqual({ status: 'AMBIGUOUS' });
  });

  it('another country never reaches the request: a same-name record in a different-country snapshot neither resolves nor counts toward multiplicity', async () => {
    await publish('ar-uco-aoi', 'AR', 'PARTIAL_PARTITION', AOI_RECORDS);
    // SYNTHETIC negative control (not an observed Overture record): an
    // unrelated-category "SuperUco" in another country's complete snapshot.
    await publish('cl-complete', 'CL', 'COMPLETE_COUNTRY', [
      {
        featureId: 'synthetic-cl-superuco',
        countryCode: 'CL',
        name: 'SuperUco',
        latitude: -33.45,
        longitude: -70.66,
        address: 'synthetic',
      },
    ]);

    const ar = await decide('SuperUco', 'AR');
    expect(ar.lookup.resultCount).toBe(1);
    expect(ar.candidate?.externalId).toBe(SUPERUCO.featureId);
    expect(ar.decision).toEqual({ status: 'INSUFFICIENT_EVIDENCE' });

    const unknownCountry = await decide('SuperUco', 'UY');
    expect(unknownCountry.lookup.candidates).toEqual([]);
  });
});
