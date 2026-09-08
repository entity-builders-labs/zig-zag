import { Injectable, Logger } from '@nestjs/common';
import {
  AcquisitionProviderResult,
  SourceObservation,
} from '../interfaces/experience-acquisition.interface';
import { WikivoyageApiService } from '../services/wikivoyage-api.service';

export interface WikivoyageAcquireOptions {
  sections?: ('SEE' | 'DO' | 'EAT')[];
}

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
    const articleResult = await this.apiService.fetchArticle(destination);

    if (articleResult.status === 'not_found') {
      return {
        status: 'success',
        value: [],
      };
    }

    if (articleResult.status === 'failed') {
      return {
        status: 'failed',
        value: [],
        failureReason: articleResult.failureReason,
      };
    }

    const allowedSections = options?.sections
      ? new Set(options.sections)
      : null;

    const entries = allowedSections
      ? articleResult.entries.filter((entry) =>
          allowedSections.has(entry.sectionType as any),
        )
      : articleResult.entries;

    const articleSlug = slugify(articleResult.title || destination);

    const occurrenceMap = new Map<string, number>();

    const observations: SourceObservation[] = entries.map((entry) => {
      const entrySlug = slugify(entry.name);
      const section = entry.sectionType.toLowerCase();
      const template = slugify(entry.templateName || 'entry');

      let evidenceKey: string;
      const qid = entry.wikidata?.trim();
      if (qid && /^Q\d+$/i.test(qid)) {
        evidenceKey = `wikivoyage:${articleSlug}:wikidata:${qid}`;
      } else {
        const groupKey = `${articleSlug}:${section}:${template}:${entrySlug}`;
        const occurrence = (occurrenceMap.get(groupKey) ?? 0) + 1;
        occurrenceMap.set(groupKey, occurrence);
        evidenceKey = `wikivoyage:${articleSlug}:${section}:${template}:${entrySlug}:${occurrence}`;
      }

      return {
        provider: 'wikivoyage',
        externalId: entry.wikidata,
        title: entry.name,
        description: entry.description,
        geo:
          entry.lat !== undefined && entry.long !== undefined
            ? { latitude: entry.lat, longitude: entry.long }
            : undefined,
        evidenceType: entry.sectionType === 'DO' ? 'tourism_activity' : 'place',
        evidenceKey,
      };
    });

    return {
      status: 'success',
      value: observations,
    };
  }
}
