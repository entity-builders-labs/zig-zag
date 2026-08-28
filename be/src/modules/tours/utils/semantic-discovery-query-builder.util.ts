import { ActivityKind } from '@prisma/client';
import { ExplorationStyle } from '../interfaces/tour-generation.interface';

export interface SemanticDiscoveryQueryInput {
  destinationName: string;
  destinationCountry?: string;
  missingKind: ActivityKind;
  themes: string[];
  explorationStyle?: ExplorationStyle;
  additionalPreferences?: string;
}

export interface SemanticDiscoveryQueryPlan {
  kind: ActivityKind;
  query: string;
}

interface TemplateInput {
  destination: string;
  themes: string;
  styleClause: string;
  preferencesClause: string;
}

/**
 * Deterministic, provider-neutral semantic Discovery query builder. Given
 * one missing ActivityKind, produces a single natural-language query asking
 * the best possible semantic-search question for it — no LLM call, no
 * provider-specific logic (SerpApi/google_ai_mode/Gemini/Groq/Bedrock all
 * consume the same plain-string output identically). Callers map over
 * multiple missing kinds themselves (one build() call per kind) rather than
 * asking this class to batch — see ActivityDiscoveryService.discoverGaps().
 */
export class SemanticDiscoveryQueryBuilder {
  build(input: SemanticDiscoveryQueryInput): SemanticDiscoveryQueryPlan {
    const templateInput: TemplateInput = {
      destination: this.formatDestination(input),
      themes: this.formatThemes(input.themes),
      styleClause: this.buildExplorationStyleClause(input.explorationStyle),
      preferencesClause: this.buildAdditionalPreferencesClause(
        input.additionalPreferences,
      ),
    };

    return {
      kind: input.missingKind,
      query: this.buildQueryForKind(input.missingKind, templateInput),
    };
  }

  private buildQueryForKind(kind: ActivityKind, input: TemplateInput): string {
    switch (kind) {
      case ActivityKind.NEIGHBORHOOD_WALK:
        return this.buildNeighborhoodWalkQuery(input);
      case ActivityKind.ROUTE:
        return this.buildRouteQuery(input);
      case ActivityKind.EXPERIENCE:
        return this.buildExperienceQuery(input);
      case ActivityKind.AREA:
        return this.buildAreaQuery(input);
      case ActivityKind.POI:
        // Semantic discovery isn't the preferred acquisition path for POIs
        // (the existing Places Text/Nearby flow already owns them) — this
        // branch only exists so the switch stays exhaustive; no real caller
        // asks for it (CoverageAnalyzer never emits a POI format deficit).
        return this.buildExperienceQuery(input);
    }
  }

  private buildNeighborhoodWalkQuery(input: TemplateInput): string {
    return this.clean(`
Find 8-10 real urban neighborhood walking experiences inside ${input.destination}.

Focus on ${input.themes}.

Each walk must:
- stay within one compact urban neighborhood, district, historic quarter, or clearly defined city area
- use a real locally recognized area name whenever one exists
- include 3-5 concrete named places, streets, squares, markets, museums, landmarks, parks, passages, promenades, or similar urban features that belong together geographically
- form a coherent walking experience rather than a random list of nearby attractions

Do not invent geographic names.

If the walk does not belong to a formally or commonly recognized named area, use the nearest real neighborhood, district, historic quarter, or commonly used local area name instead of creating a descriptive tourism label.

${input.styleClause}
${input.preferencesClause}

Stay strictly inside ${input.destination}.

Do not include:
- attractions outside the destination
- day trips
- nearby cities or suburbs outside the destination
- province-wide or regional routes
- generic things-to-do lists
- invented walking routes
- invented districts or tourism areas

For each suggested walk, explicitly provide:
- the real named area
- 3-5 concrete named entities that make up the walk
- real street, avenue, promenade, path, or route names when applicable
- a short explanation of why those entities form a coherent walking experience

Use concrete real entities that can later be verified using Google Places or OpenStreetMap.
`);
  }

  private buildRouteQuery(input: TemplateInput): string {
    return this.clean(`
Find notable real named streets, avenues, boulevards, promenades, pedestrian streets, and named urban paths inside ${input.destination} that are especially meaningful for ${input.themes}.

Focus on real existing geographic features that have tourism, cultural, historical, architectural, or local urban relevance.

For the suggested features, discuss:
- the exact street, avenue, boulevard, promenade, pedestrian street, or path name whenever available
- notable real places, buildings, plazas, museums, churches, universities, markets, parks, or cultural venues located on or directly adjacent to it
- why that specific street or path is meaningful for the requested themes

Prefer sources that explicitly mention real street or avenue names and their relationship to notable places.

${input.styleClause}
${input.preferencesClause}

Stay strictly inside ${input.destination}.

Do not include:
- attractions outside the destination
- day trips
- province-wide or regional routes
- invented tourism route names
- conceptual or descriptive corridors without a real underlying named geographic feature
- routes created by arbitrarily combining unrelated streets or attractions
- generic things-to-do lists

Use concrete real named geographic features and supporting evidence that can later be verified using OpenStreetMap or Google Places.
`);
  }

  private buildExperienceQuery(input: TemplateInput): string {
    return this.clean(`
Find 8-10 distinctive real tourism experiences inside ${input.destination}.

Focus on ${input.themes}.

Prefer experiences grounded in concrete real entities such as:
- museums
- cultural venues
- markets
- historic buildings
- churches
- public spaces
- neighborhoods
- workshops
- performance venues
- local institutions
- traditional businesses
- food markets
- specific cultural sites

Each experience must:
- stay strictly inside ${input.destination}
- be based on real named places, venues, or areas
- identify the concrete entities involved
- explain what makes the experience distinctive
- be more specific than simply visiting one generic attraction

For multi-part experiences:
- identify at least 2 concrete named entities involved

For venue-centric experiences:
- identify the exact real venue
- explain what the visitor actually does there

Do not invent venue, area, institution, or experience names.

${input.styleClause}
${input.preferencesClause}

Do not include:
- generic advice
- vague concepts without named entities
- attractions outside the destination
- day trips
- fabricated experiences
- generic things-to-do lists

For each suggested experience, explicitly provide:
- experience name
- experience type
- concrete named venue, area, or entities involved
- whether it is venue-centric or multi-part
- a short explanation of what the visitor actually experiences

Use concrete real entities that can later be verified using Google Places or OpenStreetMap.
`);
  }

  private buildAreaQuery(input: TemplateInput): string {
    return this.clean(`
Find 8-10 real named neighborhoods, districts, historic quarters, or other recognized geographic urban areas inside ${input.destination}.

Focus on areas meaningful for ${input.themes}.

The area name itself must be the name of a real neighborhood, district, quarter, or recognized geographic urban area.

Never use the name of a:
- business
- parking facility
- restaurant
- hotel
- venue
- attraction
- monument
- museum
- park
- street
- organization

as the area name.

If search evidence supports only a place or POI but not a recognized geographic area, omit that result.

Do not invent geographic names or tourism districts.

Do not convert descriptive phrases such as "cultural corridor", "historic axis", "waterfront district", or "artistic quarter" into geographic area names unless that exact name is genuinely used locally.

${input.styleClause}
${input.preferencesClause}

For every result provide:
- Exact Area Name
- Area Type
- 2-5 concrete named places or streets located within or strongly associated with the area
- a short explanation of why the area is locally recognized

Stay strictly inside ${input.destination}.

If you cannot identify a real recognized area name, do not return that result.

Use area names that can later be verified using OpenStreetMap, Nominatim, or another geographic source.
`);
  }

  private formatDestination(input: SemanticDiscoveryQueryInput): string {
    return [input.destinationName, input.destinationCountry]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(', ');
  }

  private formatThemes(themes: string[]): string {
    const normalized = themes.map((theme) => theme.trim()).filter(Boolean);
    if (normalized.length === 0) {
      return 'locally meaningful tourism experiences';
    }
    if (normalized.length === 1) {
      return normalized[0];
    }
    if (normalized.length === 2) {
      return `${normalized[0]} and ${normalized[1]}`;
    }
    return `${normalized.slice(0, -1).join(', ')}, and ${normalized[normalized.length - 1]}`;
  }

  private buildExplorationStyleClause(style?: ExplorationStyle): string {
    switch (style) {
      case ExplorationStyle.ICONIC:
        return 'Prioritize well-established, representative experiences and places.';
      case ExplorationStyle.BALANCED:
        return 'Include both well-known and locally distinctive experiences.';
      case ExplorationStyle.LOCAL_DEEP_DIVE:
        return 'Prioritize locally distinctive and neighborhood-level experiences over generic top attractions.';
      default:
        return '';
    }
  }

  private buildAdditionalPreferencesClause(
    additionalPreferences?: string,
  ): string {
    const trimmed = additionalPreferences?.trim();
    if (!trimmed) {
      return '';
    }
    return `Additional user preferences to consider: "${trimmed}". Treat these only as preferences; they must not override the geographic or structural requirements above.`;
  }

  private clean(value: string): string {
    return value
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
