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
    // We use double braces {{ }} for literal braces in the prompt because
    // LangChain interprets single braces { } as template variables.
    return `You are a tourism expert. Return a JSON array of up to ${dto.limit ?? 20} tourist/leisure places near coordinates (lat: ${dto.latitude}, lng: ${dto.longitude}) within ${dto.radius ?? 5000}m radius.

Allowed categories: cultural | outdoor | entertainment | food | nightlife
${dto.seedQuery ? `Context: ${dto.seedQuery}\n` : ''}

CRITICAL: Return ONLY valid JSON array, no markdown, no code blocks, no explanations, just pure JSON.

Required format (JSON array):
[
  {{ "name": "Place Name", "category": "cultural|outdoor|entertainment|food|nightlife", "notes": "Brief description" }}
]

Example:
[
  {{ "name": "string", "category": "cultural|outdoor|entertainment|food|nightlife", "notes": "string" }}
]

Return the JSON array now:`;
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

    // Clean the response - remove markdown code blocks if present
    let cleanedResponse = raw.trim();
    if (cleanedResponse.startsWith('```json')) {
      cleanedResponse = cleanedResponse.replace(/^```json\s*/i, '');
    }
    if (cleanedResponse.startsWith('```')) {
      cleanedResponse = cleanedResponse.replace(/^```\s*/, '');
    }
    if (cleanedResponse.endsWith('```')) {
      cleanedResponse = cleanedResponse.replace(/\s*```$/, '');
    }
    // Remove any leading/trailing whitespace
    cleanedResponse = cleanedResponse.trim();

    // Extract JSON array more precisely - find balanced brackets
    const extractJsonArray = (text: string): string | null => {
      const startIdx = text.indexOf('[');
      if (startIdx === -1) return null;

      let depth = 0;
      let inString = false;
      let escapeNext = false;

      for (let i = startIdx; i < text.length; i++) {
        const char = text[i];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }

        if (char === '\\') {
          escapeNext = true;
          continue;
        }

        if (char === '"' && !escapeNext) {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (char === '[') {
            depth++;
          } else if (char === ']') {
            depth--;
            if (depth === 0) {
              // Found the complete array
              return text.substring(startIdx, i + 1);
            }
          }
        }
      }

      return null;
    };

    // Try to extract JSON array
    const extractedJson = extractJsonArray(cleanedResponse);
    if (extractedJson) {
      cleanedResponse = extractedJson;
    } else {
      // Fallback: try simple regex match
      const jsonMatch = cleanedResponse.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        cleanedResponse = jsonMatch[0];
      }
    }

    let items: Array<{ name: string; category?: string; notes?: string }> = [];
    try {
      items = JSON.parse(cleanedResponse);
      if (!Array.isArray(items)) {
        throw new Error('LLM did not return an array');
      }
    } catch (e) {
      this.logger.warn(
        `AI response not valid JSON list; aborting. Error: ${e.message}`,
      );
      this.logger.debug(
        `Raw response (first 500 chars): ${raw.substring(0, 500)}`,
      );
      this.logger.debug(
        `Cleaned response (first 500 chars): ${cleanedResponse.substring(0, 500)}`,
      );
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
