import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Design C7 / task 37.1 architecture rule: the structured admission policy is
 * the single source of truth. No second admission whitelist or exclusion
 * authority may exist, and the canonical signal/exclusion vocabulary may be
 * defined only by the canonical policy and its provider adapters.
 *
 * Mechanical guards:
 *  1. the removed hand-maintained authorities (NON_EXPERIENCE_TOURISM_VALUES,
 *     INTEREST_ACQUISITION_CATEGORIES, CATALOG_ACQUISITION_TYPE_GROUPS and the
 *     unused catalog-acquisition-plan util) never reappear in production code;
 *  2. the canonical admission signal/exclusion-class string literals appear
 *     only in the canonical policy and the OSM/Wikidata adapter mappings.
 */

const SRC_ROOT = join(__dirname, '..', '..', '..');

function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return productionFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

const read = (path: string) => readFileSync(path, 'utf8');
const rel = (path: string) => relative(SRC_ROOT, path);

describe('structured admission authority (design C7, task 37.1)', () => {
  const modules = productionFiles(join(SRC_ROOT, 'modules'));

  it('removed hand-maintained admission authorities never reappear', () => {
    const forbidden = [
      /\bNON_EXPERIENCE_TOURISM_VALUES\b/,
      /\bINTEREST_ACQUISITION_CATEGORIES\b/,
      /\bCATALOG_ACQUISITION_TYPE_GROUPS\b/,
      /\bprimaryTypesForAcquisitionCategory\b/,
      /\bbuildCatalogAcquisitionPlan\b/,
    ];
    const offenders = modules.flatMap((path) => {
      const source = read(path);
      return forbidden
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${rel(path)}: ${pattern}`);
    });
    expect(offenders).toEqual([]);
  });

  it('canonical admission vocabulary is defined only by the policy and its adapters', () => {
    const allowed = new Set([
      'modules/tours/admission/structured-admission-policy.ts',
      'modules/integrations/osm/utils/osm-admission-adapter.ts',
      'modules/integrations/wikidata/utils/wikidata-admission-adapter.ts',
    ]);
    const vocabulary =
      /'(EXPLICIT_VISITOR_CLASSIFICATION|HISTORIC_CLASSIFICATION|HERITAGE_DESIGNATION|VISITABLE_PLACE_CLASS|ENCYCLOPEDIC_NOTABILITY|PROVIDER_PROMINENCE|ADMINISTRATIVE_OR_LOCALITY|ROAD_OR_ROUTE|INFORMATION_OR_SIGNAGE|SUB_FEATURE|TRANSPORT_SERVICE|TECHNICAL_INFRASTRUCTURE|ACCOMMODATION)'/;
    const offenders = modules
      .filter((path) => !allowed.has(rel(path)))
      .filter((path) => vocabulary.test(read(path)))
      .map((path) => rel(path));
    expect(offenders).toEqual([]);
  });
});
