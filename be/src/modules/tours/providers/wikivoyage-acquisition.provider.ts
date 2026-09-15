import { Injectable, Logger } from '@nestjs/common';
import {
  AcquisitionProviderResult,
  QualityEvidence,
  SourceObservation,
} from '../interfaces/experience-acquisition.interface';
import { WikivoyageApiService } from '../services/wikivoyage-api.service';

export interface WikivoyageAcquireOptions {
  sections?: ('SEE' | 'DO' | 'EAT')[];
  articleTargets?: string[];
}

/**
 * Adapter-boundary normalization (docs/architecture/
 * engineering-principles.md §1/§3): a Wikivoyage entry's mere existence in
 * a real, fetched article IS the editorial-listing signal -- decided here,
 * where the Wikivoyage-specific fetch already happened, never re-derived
 * downstream from `provider === 'wikivoyage'`.
 */
const WIKIVOYAGE_QUALITY_EVIDENCE: QualityEvidence = {
  editorialListing: { listed: true },
};

function slugify(text: string): string {
  return text
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

@Injectable()
export class WikivoyageAcquisitionProvider {
  private readonly logger = new Logger(WikivoyageAcquisitionProvider.name);

  constructor(private readonly apiService: WikivoyageApiService) {}

  async acquire(
    destination: string,
    options?: WikivoyageAcquireOptions,
  ): Promise<AcquisitionProviderResult<SourceObservation>> {
    const targets = [
      ...new Set(
        (options?.articleTargets?.length
          ? options.articleTargets
          : [destination]
        )
          .map((target) => target.trim())
          .filter(Boolean),
      ),
    ];
    const articleResults = await Promise.all(
      targets.map((target) => this.apiService.fetchArticle(target)),
    );
    const provenance: Record<string, unknown> = {
      requestedTitle: destination,
      requestedSections: options?.sections ?? ['SEE', 'DO', 'EAT'],
      targets: [],
    };
    const targetProvenance: unknown[] = [];
    const allObservations: SourceObservation[] = [];

    const allowedSections = options?.sections
      ? new Set(options.sections)
      : null;
    for (let i = 0; i < articleResults.length; i++) {
      const articleResult = articleResults[i];
      targetProvenance.push({
        requestedTitle: targets[i],
        article: {
          status:
            articleResult.status === 'found'
              ? 'found'
              : articleResult.status === 'not_found'
                ? 'not_found'
                : 'failed',
          resolvedTitle: articleResult.title,
          pageid: articleResult.pageid,
        },
        requestedSections: options?.sections ?? ['SEE', 'DO', 'EAT'],
        parser: articleResult.parserAudit,
        preFilterEntryCount: articleResult.entries.length,
        postSectionFilterEntryCount:
          articleResult.status === 'found'
            ? allowedSections
              ? articleResult.entries.filter((entry) =>
                  allowedSections.has(entry.sectionType as any),
                ).length
              : articleResult.entries.length
            : 0,
      });
      if (articleResult.status !== 'found') continue;
      const entries = allowedSections
        ? articleResult.entries.filter((entry) =>
            allowedSections.has(entry.sectionType as any),
          )
        : articleResult.entries;
      const articleSlug = slugify(articleResult.title || targets[i]);
      const occurrenceMap = new Map<string, number>();
      allObservations.push(
        ...entries.map((entry): SourceObservation => {
          const entrySlug = slugify(entry.name);
          const section = entry.sectionType.toLowerCase();
          const template = slugify(entry.templateName || 'entry');

          const groupKey = `${articleSlug}:${section}:${template}:${entrySlug}`;
          const occurrence = (occurrenceMap.get(groupKey) ?? 0) + 1;
          occurrenceMap.set(groupKey, occurrence);
          const evidenceKey = `wikivoyage:${articleSlug}:${section}:${template}:${entrySlug}:${occurrence}`;

          const rawQid = entry.wikidata?.trim();
          const isValidQid = !!rawQid && /^Q\d+$/i.test(rawQid);
          const normalizedQid = isValidQid ? rawQid!.toUpperCase() : rawQid;

          return {
            provider: 'wikivoyage',
            externalId: normalizedQid || undefined,
            title: entry.name,
            description: entry.description,
            geo:
              entry.lat !== undefined && entry.long !== undefined
                ? { latitude: entry.lat, longitude: entry.long }
                : undefined,
            evidenceType:
              entry.sectionType === 'DO' ? 'tourism_activity' : 'place',
            evidenceKey,
            originationCapabilities:
              entry.sectionType === 'DO' ? [] : ['SINGLE_PLACE'],
            qualityEvidence: WIKIVOYAGE_QUALITY_EVIDENCE,
            // Adapter-boundary normalization: this entry cites a real,
            // well-formed Wikidata QID -- resolved here, never re-derived
            // downstream from `provider === 'wikivoyage'` or by decoding
            // `externalId`/`evidenceKey`.
            canonicalIdentity: isValidQid
              ? { wikidataQid: normalizedQid }
              : undefined,
            // Task B1 -- previously computed (used above for the evidenceKey/
            // evidenceType derivation) but discarded before reaching the
            // observation itself.
            metadata: {
              sectionType: entry.sectionType,
              templateName: entry.templateName,
            },
          };
        }),
      );
    }

    provenance.targets = targetProvenance;
    if (articleResults.length === 1) {
      const articleResult = articleResults[0];
      provenance.article = {
        status: articleResult.status,
        resolvedTitle: articleResult.title,
        pageid: articleResult.pageid,
      };
      provenance.parser = articleResult.parserAudit;
      provenance.preFilterEntryCount = articleResult.entries.length;
      provenance.postSectionFilterEntryCount =
        articleResult.status === 'found'
          ? allowedSections
            ? articleResult.entries.filter((entry) =>
                allowedSections.has(entry.sectionType as any),
              ).length
            : articleResult.entries.length
          : 0;
    }
    const hasFailure = articleResults.some(
      (result) => result.status === 'failed',
    );

    return {
      status: hasFailure && allObservations.length === 0 ? 'failed' : 'success',
      value: allObservations,
      failureReason: hasFailure
        ? articleResults.find((result) => result.status === 'failed')
            ?.failureReason
        : undefined,
      provenance,
    };
  }
}
