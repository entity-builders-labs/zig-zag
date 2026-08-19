import { Command, CommandRunner, Option } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { VariantTheme } from '@prisma/client';
import { ActivitiesService } from '@activities/services/activities.service';
import { OsmPlacesService } from '@integrations/osm/services/osm-places.service';
import { CompositeGenerationService } from '@tours/services/composite-generation.service';
import { formatActivityForPrompt } from '@tours/utils/activity-prompt-formatter.util';

interface GenerateTemplatesOptions {
  lat?: number;
  lng?: number;
  radius?: number;
  name?: string;
  themes?: string;
  updateExisting?: boolean;
}

// A neighborhood_walk is walkable by definition — same default scale as
// OVERPASS_MAX_RADIUS_METERS (osm-places.service.ts), not the tour's own
// general search radius.
const DEFAULT_RADIUS_METERS = 2000;

const DEFAULT_TEMPLATE_THEMES: VariantTheme[] = [
  VariantTheme.HISTORY,
  VariantTheme.FOOD,
  VariantTheme.ART,
  VariantTheme.QUICK,
];

function parseThemes(raw: string | undefined): VariantTheme[] {
  if (!raw) return DEFAULT_TEMPLATE_THEMES;

  const requested = raw.split(',').map((t) => t.trim().toUpperCase());
  const validThemes = new Set<string>(Object.values(VariantTheme));
  const invalid = requested.filter((t) => !validThemes.has(t));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid --themes value(s): ${invalid.join(', ')}. Must be one of: ${Object.values(VariantTheme).join(', ')}`,
    );
  }
  return requested as VariantTheme[];
}

/**
 * Pre-generates curated composite activity variants (neighborhood walks,
 * routes, experiences) for a named area, offline — one LLM proposal per
 * requested theme, reusing the exact same propose->verify->persist pipeline
 * as live tour generation (see CompositeGenerationService). Persisted
 * variants get `isCurated: true`, distinguishing them from the ones
 * generated ad hoc during a live tour.
 */
@Injectable()
@Command({
  name: 'generate-templates',
  description:
    'Pre-generate curated composite activity variants (walks/routes/experiences) for a named area',
})
export class GenerateTemplatesCommand extends CommandRunner {
  private readonly logger = new Logger(GenerateTemplatesCommand.name);

  constructor(
    private readonly osmPlacesService: OsmPlacesService,
    private readonly activitiesService: ActivitiesService,
    private readonly compositeGenerationService: CompositeGenerationService,
  ) {
    super();
  }

  async run(
    _inputs: string[],
    options: GenerateTemplatesOptions,
  ): Promise<void> {
    const { lat, lng, name, updateExisting } = options;
    const radius = options.radius || DEFAULT_RADIUS_METERS;

    if (lat == null || lng == null || !name) {
      throw new Error(
        'Usage: yarn script generate-templates --lat=<lat> --lng=<lng> --name="<area name>" [--radius=2000] [--themes=history,food] [--update-existing]',
      );
    }

    const themes = parseThemes(options.themes);
    this.logger.log(
      `Generating templates for "${name}" (${lat}, ${lng}, radius ${radius}m) — themes: ${themes.join(', ')}${updateExisting ? ' [update-existing]' : ''}`,
    );

    const areaCandidate = await this.osmPlacesService.findBoundaryByName(
      name,
      lat,
      lng,
      radius,
    );
    if (!areaCandidate) {
      this.logger.error(
        `Could not resolve an OSM boundary named "${name}" near (${lat}, ${lng}). Aborting — no templates generated.`,
      );
      return;
    }

    const nearbyActivities = await this.activitiesService.findAll(
      String(lat),
      String(lng),
      radius,
      20,
    );
    const candidateActivityIds = new Set(nearbyActivities.map((a) => a.id));
    const activitiesText = nearbyActivities
      .map((a: any) => formatActivityForPrompt(a))
      .join('\n');

    const streetCandidates = await this.osmPlacesService.findStreetsNear(
      lat,
      lng,
      radius,
    );
    const candidateOsmFeaturesById = new Map(
      streetCandidates.map((c) => [c.id, c]),
    );
    await this.compositeGenerationService.enrichCandidatesWithWikidata([
      ...streetCandidates,
      areaCandidate,
    ]);

    const osmFeaturesText = streetCandidates
      .map((c) => `id: ${c.id} - ${c.name} (${c.osmType})`)
      .join('\n');
    const areaText = `id: ${areaCandidate.id} - ${areaCandidate.name} (${areaCandidate.osmType})`;

    const tourChain = this.compositeGenerationService.createTourChain();

    for (const theme of themes) {
      this.logger.log(`Proposing a "${theme}" variant for "${name}"...`);

      let aiResponse: any;
      try {
        aiResponse = await tourChain.invoke({
          input:
            `Propose ONE themed composite experience (a neighborhood walk, route, ` +
            `or multi-stop experience) for the area "${areaCandidate.name}". The ` +
            `theme MUST be "${theme}". Return it in "compositeActivities" only — ` +
            `return an empty "activities" array, no flat activities are needed here.`,
          activities: activitiesText,
          osmFeatures: osmFeaturesText,
          area: areaText,
          themes: theme,
        });
      } catch (error: any) {
        this.logger.error(
          `LLM proposal failed for theme "${theme}": ${error.message}`,
        );
        continue;
      }

      const rawComposites: any[] = aiResponse.compositeActivities || [];
      if (rawComposites.length === 0) {
        this.logger.warn(
          `No composite proposed for theme "${theme}" — skipping.`,
        );
        continue;
      }

      const { persisted, invalidCompositeCount, hallucinatedWaypointCount } =
        await this.compositeGenerationService.verifyAndPersistComposites({
          rawComposites,
          candidateActivityIds,
          candidateOsmFeaturesById,
          areaCandidate,
          logContext: `template "${name}"/${theme}`,
          forceUpdateWaypoints: !!updateExisting,
        });

      if (invalidCompositeCount > 0 || hallucinatedWaypointCount > 0) {
        this.logger.warn(
          `Theme "${theme}": ${invalidCompositeCount} invalid proposal(s), ${hallucinatedWaypointCount} hallucinated waypoint id(s) dropped.`,
        );
      }
      for (const p of persisted) {
        this.logger.log(
          `Theme "${theme}": variant "${p.variant.name}" (${p.variant.id}) ${updateExisting ? 'updated' : 'created/reused'}.`,
        );
      }
    }

    this.logger.log(`Done generating templates for "${name}".`);
  }

  @Option({
    flags: '--lat <lat>',
    description: 'Latitude of the area to generate templates for',
  })
  parseLat(val: string): number {
    return Number(val);
  }

  @Option({
    flags: '--lng <lng>',
    description: 'Longitude of the area to generate templates for',
  })
  parseLng(val: string): number {
    return Number(val);
  }

  @Option({
    flags: '--radius <radius>',
    description: `Search radius in meters (default ${DEFAULT_RADIUS_METERS})`,
  })
  parseRadius(val: string): number {
    return Number(val);
  }

  @Option({
    flags: '--name <name>',
    description:
      'Name of the area/neighborhood to resolve via OSM (e.g. "San Telmo")',
  })
  parseName(val: string): string {
    return val;
  }

  @Option({
    flags: '--themes <themes>',
    description: `Comma-separated VariantTheme values (default: ${DEFAULT_TEMPLATE_THEMES.join(',')})`,
  })
  parseThemesOption(val: string): string {
    return val;
  }

  @Option({
    flags: '--update-existing',
    description:
      "Replace an already-existing variant's waypoints instead of leaving it untouched",
  })
  parseUpdateExisting(): boolean {
    return true;
  }
}
