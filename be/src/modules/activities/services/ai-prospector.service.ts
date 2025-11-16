// @ts-nocheck
import { Injectable, Logger } from '@nestjs/common';
import { LangChainService } from '../../../shared/ai/langchain.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ActivitiesService } from './activities.service';
import { PrismaService } from '../../../core/database/prisma.service';
import { AiDiscoverDto } from '../dto/ai-discover.dto';

@Injectable()
export class AiProspectorService {
  private readonly logger = new Logger(AiProspectorService.name);

  constructor(
    private readonly ai: LangChainService,
    private readonly config: ConfigService,
    private readonly activities: ActivitiesService,
    private readonly prisma: PrismaService,
  ) {}

  private buildPrompt(dto: AiDiscoverDto) {
    return `Devuelve una lista JSON de hasta ${dto.limit ?? 20} lugares (nombre y categoria) relevantes para turismo/ocio cerca de (lat: ${dto.latitude}, lng: ${dto.longitude}) en un radio de ${dto.radius ?? 5000}m.
Categorias permitidas: cultural | outdoor | entertainment | food | nightlife.
${dto.seedQuery ? `Contexto: ${dto.seedQuery}\n` : ''}
Formato estricto (solo JSON, sin texto extra):
[
  {{ "name": "string", "category": "cultural|outdoor|entertainment|food|nightlife", "notes": "string" }}
]
`;
  }

  private async resolveWithPlaces(name: string, dto: AiDiscoverDto) {
    const apiKey = this.config.get<string>('GOOGLE_MAPS_API_KEY');
    const text = `${name}`;
    const resp = await axios.post(
      'https://places.googleapis.com/v1/places:searchText',
      {
        textQuery: text,
        maxResultCount: 5,
        locationBias: {
          circle: {
            center: { latitude: dto.latitude, longitude: dto.longitude },
            radius: dto.radius ?? 5000,
          },
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey!,
          'X-Goog-FieldMask': [
            'places.id',
            'places.displayName',
            'places.formattedAddress',
            'places.location',
            'places.rating',
            'places.userRatingCount',
            'places.types',
            'places.websiteUri',
          ].join(','),
        },
      },
    );

    const candidates = (resp.data?.places || []).map((p: any) => ({
      id: p.id,
      name: p.displayName?.text || p.displayName || '',
      address: p.formattedAddress,
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      rating: p.rating,
      ratingCount: p.userRatingCount,
      types: p.types || [],
      website: p.websiteUri,
    }));

    // score: distance asc, then rating weighted
    const R = 4.0;
    const M = 50;
    const scored = candidates.map((c: any) => {
      const d = this.distanceKm(dto.latitude, dto.longitude, c.lat, c.lng);
      const v = Number(c.ratingCount || 0);
      const r = Number(c.rating || 0);
      const score = v + M > 0 ? (v / (v + M)) * r + (M / (v + M)) * R : 0;
      return { ...c, d, score };
    });

    scored.sort((a: any, b: any) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.d - b.d;
    });
    return scored[0] || null;
  }

  private distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  async discover(dto: AiDiscoverDto) {
    const prompt = this.buildPrompt(dto);
    const raw = await this.ai.generateCompletionResponse(prompt);
    let items: Array<{ name: string; category?: string; notes?: string }> = [];
    try {
      items = JSON.parse(raw);
      if (!Array.isArray(items)) throw new Error('LLM did not return an array');
    } catch (e) {
      this.logger.warn('AI response not valid JSON list; aborting');
      return { created: 0, duplicates: 0, rejected: 0, activities: [] };
    }

    const sourceId = await this.ensureAiSource();
    let created = 0;
    let duplicates = 0;
    let rejected = 0;
    const createdActivities: any[] = [];

    for (const item of items.slice(0, dto.limit ?? 20)) {
      try {
        const match = await this.resolveWithPlaces(item.name, dto);
        if (!match) {
          rejected++;
          continue;
        }

        // dedupe
        const exists = await this.prisma.activity.findUnique({
          where: { sourceId_externalId: { sourceId, externalId: match.id } },
        });
        if (exists) {
          duplicates++;
          continue;
        }

        // Category: prefer LLM category else default
        const category = (item.category || '').toLowerCase();
        const knownCategory = [
          'cultural',
          'outdoor',
          'entertainment',
          'food',
          'nightlife',
        ].includes(category)
          ? category
          : undefined;

        const createDto: any = {
          name: match.name,
          description: match.website || '',
          type: knownCategory || 'cultural',
          duration: 2.0,
          price: 0,
          maxGroupSize: 15,
          latitude: match.lat,
          longitude: match.lng,
          rating: match.rating,
          ratingCount: match.ratingCount,
          formattedAddress: match.address,
          website: match.website,
          knownActivityTypeName: knownCategory || 'cultural',
          location: { latitude: match.lat, longitude: match.lng },
          sourceId,
          externalId: match.id,
          metadata: {
            discoveredBy: 'ai',
            seedQuery: dto.seedQuery || null,
            aiNotes: item.notes || null,
            googleTypes: match.types || [],
            verificationMethod: 'places:searchText',
          },
        };

        const createdOne = await this.activities.create(createDto);
        createdActivities.push(createdOne);
        created++;
      } catch (e) {
        this.logger.warn(`Skipping candidate due to error: ${e.message}`);
        rejected++;
      }
    }

    if (createdActivities.length > 0) {
      try {
        await this.ai.saveActivityEmbedding(createdActivities as any);
      } catch {}
    }

    return { created, duplicates, rejected, activities: createdActivities };
  }

  private async ensureAiSource(): Promise<string> {
    const existing = await this.prisma.source.findUnique({
      where: { name: 'ai-seeded' },
    });
    if (existing) return existing.id;
    const created = await this.prisma.source.create({
      data: {
        name: 'ai-seeded',
        type: 'prospector',
        baseUrl: 'local-llm',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return created.id;
  }
}
