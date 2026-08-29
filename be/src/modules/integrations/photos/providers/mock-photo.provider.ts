import { Injectable, Logger } from '@nestjs/common';
import {
  ActivityEnrichmentResult,
  ActivityPhoto,
  IPhotoEnrichmentProvider,
  PhotoEnrichmentQuery,
} from '../interfaces/photo-enrichment.interface';

@Injectable()
export class MockPhotoProvider implements IPhotoEnrichmentProvider {
  readonly providerName = 'mock';
  private readonly logger = new Logger(MockPhotoProvider.name);

  async enrichActivity(
    query: PhotoEnrichmentQuery,
  ): Promise<ActivityEnrichmentResult> {
    const photos: ActivityPhoto[] = [
      {
        url: `https://images.unsplash.com/photo-1589909202802-8f4aadce1849?q=80&w=1200&auto=format&fit=crop`,
        thumbnail: `https://images.unsplash.com/photo-1589909202802-8f4aadce1849?q=80&w=400&auto=format&fit=crop`,
        author: 'Local Contributor',
        license: 'CC BY-SA 4.0',
        caption: `Vista principal de ${query.name}`,
        sourceProvider: 'mock',
      },
    ];

    const highlights = [
      `Punto emblemático de interés en ${query.destinationName || 'la ciudad'}`,
      `Experiencia destacada para categoría ${query.category || 'cultural'}`,
      `Ubicación accesible sobre ${query.formattedAddress || 'zona céntrica'}`,
    ];

    const curatorTip = `Visitalo temprano para evitar aglomeraciones y disfrutar con calma.`;

    return {
      photos,
      highlights,
      curatorTip,
      status: 'enriched',
      provider: this.providerName,
    };
  }

  async enrichBatch(
    queries: PhotoEnrichmentQuery[],
  ): Promise<Map<string, ActivityEnrichmentResult>> {
    const results = new Map<string, ActivityEnrichmentResult>();
    for (const q of queries) {
      const key = q.id || q.name;
      results.set(key, await this.enrichActivity(q));
    }
    return results;
  }
}
