import { ExperienceDiscoveryRequest } from '../interfaces/experience-discovery.interface';
import { ExperienceGroundingEvidence } from '../interfaces/experience-grounding.interface';
import {
  CANONICAL_INTENT_KEYS,
  CANONICAL_THEME_KEYS,
} from '../utils/experience-candidate-facet-normalizer.util';

/**
 * The single *semantic* contract every Experience discovery extractor
 * (Gemini / Groq / Ollama / Cloudflare) speaks. Provider modules add only transport,
 * response-format wiring, and response parsing on top of this — they never
 * carry their own copy of the ExperienceCandidate / componentHint / facet
 * rules, and never their own tourism taxonomy. Canonical vocabularies come
 * from `preference-facet-vocabulary.ts` via the facet normalizer.
 *
 * The *structured JSON Schema* (`buildDiscoveryResponseJsonSchema`) is a
 * separate, narrower artifact: the two extractors that support schema-enforced
 * output — Gemini (`response_format`) and Ollama (`format`) — reuse it, while
 * Groq currently runs in JSON-object mode and leans on this semantic prompt
 * plus the deterministic backend normalizer. All three still converge on the
 * same domain contract because `normalizeExperienceCandidateFacets` is the
 * authority regardless of provider or model obedience.
 */

export { CANONICAL_THEME_KEYS, CANONICAL_INTENT_KEYS };

/** Role framing + geographic-identity anti-hallucination rules. */
export function buildDiscoverySystemPrompt(): string {
  return `You are an ExperienceCandidate extractor.

Your task is to convert grounded tourism research into structured ExperienceCandidate
candidates for a destination based on:
- the user's requested themes and soft Experience intents;
- exploration style;
- additional preferences;
- explicit coverage gaps;
- grounded search evidence supplied to you.

If day_trip is requested, only extract experiences supported by evidence as suitable
from the selected base destination and returning the same day. Do not return overnight
or weekend-only trips.

You are NOT responsible for trusted geographic identity.

The backend independently resolves all proposed entities through trusted geographic
providers before anything may be persisted.

Never provide or invent:
- coordinates;
- Google Place IDs;
- OpenStreetMap IDs;
- Wikidata IDs;
- provider-specific geographic identifiers;
- URLs or citations that were not supplied in the grounded evidence.`;
}

/** The `Destination / Themes / Requested intents / Preferences` header lines. */
export function buildDiscoveryRequestHeader(
  request: ExperienceDiscoveryRequest,
): string[] {
  return [
    `Destination: ${request.scope.destinationName ?? 'unknown'}`,
    `Themes: ${request.requestedThemes.join(', ') || 'none'}`,
    `Requested intents: ${request.requestedIntents?.join(', ') || 'none'}`,
    `Preferences: ${(request.semanticQuery || request.preferredTraits?.join(', ')) ?? 'none'}`,
    `Required evidence shape: ${request.evidenceRequirements?.includes('MULTI_COMPONENT_EXPERIENCE') ? 'MULTI_COMPONENT_EXPERIENCE' : request.evidenceRequirements?.length ? 'SINGLE_PLACE' : 'none'}`,
    ...buildDiscoveryAnchorContext(request.anchorNames),
  ];
}

/**
 * Anchor context for an acquisition that targets specific named places the
 * user asked about. It narrows WHICH evidence-supported Experiences are
 * relevant; it never licenses composition -- every source-support and
 * multi-component rule still applies. Empty when there is no anchor.
 */
export function buildDiscoveryAnchorContext(
  anchorNames: readonly string[] | undefined,
): string[] {
  const names = (anchorNames ?? [])
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) return [];
  return [
    `Named anchors: ${names.join(', ')}`,
    'This request is specifically about the named anchors. Extract only evidence-supported Experiences that are materially about at least one named anchor: a walk, route or visit along, through or at that anchor, or the anchor itself. Do not emit an Experience that the evidence does not connect to any named anchor, even if it matches the requested themes or intents.',
    'A named anchor never licenses composition: every rule below about source support, cited evidence and multi-component Experiences still applies. Never add the anchor, or places near it, as components unless the cited evidence itself supports them as part of that Experience.',
  ];
}

/** The shared body: ExperienceCandidate shape, componentHint semantics, evidence
 *  rules, the controlled-vs-open facet contract, day-trip and ordering rules. */
export function buildDiscoveryInstructions(): string[] {
  return [
    'When MULTI_COMPONENT_EXPERIENCE is requested, only emit a multi-component candidate when grounded evidence explicitly supports at least two non-area real geographic components as belonging to that same real Experience.',
    'Never combine independent POIs merely because they appear in adjacent paragraphs, under the same neighborhood heading, or in the same search answer.',
    'A multi-component candidate is allowed only when the evidence itself describes one real walk, tour, itinerary, route or visiting sequence containing those components.',
    'Generic labels such as "Official City Tour", "Private Tour", "Small Group Tour" and "Walking Tour" are not geographic ROUTE entities. Do not emit them as componentHints unless grounded evidence names a real geographic route by that name.',
    'If evidence proves that a walk/tour exists but does not name at least two real geographic components, emit no candidate for MULTI_COMPONENT_EXPERIENCE. Never invent stops to satisfy the requested shape.',
    'componentHints[].name must be the identity of an entity the grounded evidence explicitly supports. When the evidence clearly refers to one specific real named place, you MAY normalize or translate that SAME entity to the official local-language name used by that country\'s mapping data (for Argentina and most of Latin America this is Spanish — e.g. evidence "El Leoncito National Park" becomes "Parque Nacional El Leoncito"), or correct an obvious typographical error in the source wording to the well-known canonical name of that SAME entity, but ONLY when you are confident it is the same entity, so the backend can match it against a local-language map database. When extracting stops for destinations where mapping data is in a local language (e.g. Spanish for Argentina/Buenos Aires), you SHOULD translate or normalize well-known place names to their canonical local-language name (e.g. "Volunteer Firefighters Plaza" -> "Plazoleta Bomberos Voluntarios de La Boca", "Boca Juniors stadium" -> "La Bombonera", "Benito Quinquela Martín Museum" -> "Museo Benito Quinquela Martín"), always setting sourceName to the literal evidence wording and normalizationKind to TRANSLATION or CANONICAL_NAME. When componentHints[].name is normalized or corrected from an obvious typo in the evidence, componentHints[].sourceName must record the literal entity wording from the cited evidence, and componentHints[].normalizationKind should indicate the kind (TYPO_CORRECTION, TRANSLATION, or CANONICAL_NAME). Never use typo correction or normalization to introduce a different entity, add an entity absent from the evidence, infer a nearby place, turn a place or business category into a concrete venue, add coordinates or provider IDs, or invent an official name you are unsure of. If you are uncertain, keep the exact name the evidence uses and let the backend geographic resolver decide the canonical identity.',
    'Return JSON with a candidates array. Each candidate must contain name, description, themes, traits, intents, suggestedDurationMinutes, componentHints, evidenceKeys, shortReason and orderedByEvidence. Each componentHints entry must contain key (a short slug), name, role (one of area, waypoint, route, venue), expectedKind (one of PLACE, AREA, ROUTE), evidenceKeys (a non-empty array of the exact evidence keys that name it), supportSpan (see below), and optionally sourceName (the literal entity wording from the cited evidence when name was normalized or typo-corrected; omit when identical to name), normalizationKind (one of TYPO_CORRECTION, TRANSLATION, CANONICAL_NAME), and addressHint (a street address, ONLY when the same cited evidence explicitly states one for this exact entity — e.g. "Junín 1760" or "on Armenia street, number 1366"; omit entirely when evidence gives no address, never invent or guess one from the venue name or general area). Never invent other role or expectedKind values.',
    "supportSpan is mandatory for every componentHint: copy a short phrase or sentence VERBATIM (exact characters, no paraphrasing, no translation) from the text of one of that componentHint's own cited evidenceKeys, proving that specific cited evidence actually names or describes this component. The backend independently verifies supportSpan is a real substring of the cited evidence text and rejects any componentHint whose supportSpan cannot be verified this way — never invent, translate, or approximate a supportSpan; if you cannot quote real supporting text from the cited evidence, do not emit that componentHint at all. `name` may still be normalized/translated to the canonical local-language identity as described elsewhere in this prompt; supportSpan must stay in the evidence's own original wording regardless.",
    'Some evidence entries are the full text of a source article, not just a short snippet — when one describes a walk/route with multiple named stops (specific streets, plazas, landmarks, markets), enumerate EACH real stop it names as its own componentHint (role "venue" for a point, "route" for a named street/path, "area" for a district), citing the exact evidence key(s) that name it. Do not collapse a multi-stop route into a single componentHint just because it shares one candidate name.',
    'A componentHints[].name for role "venue" must be the actual named place or business (e.g. a milonga, café, museum, restaurant) — never a street name, cross-street, or address fragment mentioned only to locate it. If evidence gives an address like "Armenia 1366" or says a venue is "on Armenia street", the venue name is whatever business/place it names (e.g. "La Viruta"), never "Armenia" itself — instead, put that same address string in addressHint for that componentHint, so the backend can use it as an independent, non-name-based confirmation signal. Only use role "route" naming a street when the street itself, not a venue located on it, is what the candidate describes.',
    'Every componentHint must be a specific, real, resolvable geographic entity. Never invent a generic pseudo-entity from a category the evidence only mentions in general — e.g. do NOT emit a role "venue" expectedKind "PLACE" hint named "Specialty Coffee Shop", "Coffee Shop", "Local Brewery", "Craft Beer Bar", "Wine Store" or "Historic Restaurant" just because the evidence says a place "has many specialty coffee shops" or "small local breweries". If the evidence names no concrete business, either omit that componentHint, cite a real named area (role "area", expectedKind "AREA") the evidence does name, or keep the concept only in the candidate description/traits. Do not resolve geography yourself.',
    'orderedByEvidence must be true only when the cited evidence explicitly describes a visiting sequence for this candidate\'s components (e.g. "start at X, then walk to Y"); otherwise false. Never infer an order from componentHints array order.',
    `themes must be drawn ONLY from this controlled vocabulary: ${CANONICAL_THEME_KEYS.join(', ')}. intents must be drawn ONLY from this controlled vocabulary: ${CANONICAL_INTENT_KEYS.join(', ')}. Use the exact canonical key, never a localized or synonym form. traits is the open-ended dimension: put descriptive properties that are NOT one of those canonical themes/intents here (e.g. "craft beer", "rooftop", "family friendly", "specialty coffee"). Never put a canonical theme or canonical intent inside traits. themes and intents are separate, independent controlled dimensions: the same canonical key MAY appear in both themes and intents when it legitimately represents both roles and the request or evidence supports both — do not deduplicate across themes and intents.`,
    'intents are soft Experience facets such as visit, walk, food, route_like or day_trip; never structural proposal kinds.',
    'For day_trip, only return evidence-backed same-day experiences from the selected base; exclude overnight or weekend-only trips.',
    'Do not output coordinates, provider IDs, URLs, or entities not directly supported by evidence.',
  ];
}

/**
 * JSON Schema for the ExperienceCandidate envelope, shared by every extractor
 * that supports structured output (Gemini `response_format`, Ollama `format`).
 * `themes` / `intents` are `enum`-constrained to the central controlled
 * vocabularies; `traits` stays open. This is transport wiring, not a second
 * copy of the domain contract — `extractExperienceCandidates` +
 * `normalizeExperienceCandidateFacets` remain authoritative for anything a
 * schema-less path (or a disobedient model) produces.
 */
export function buildDiscoveryResponseJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            themes: {
              type: 'array',
              items: { type: 'string', enum: [...CANONICAL_THEME_KEYS] },
            },
            traits: { type: 'array', items: { type: 'string' } },
            intents: {
              type: 'array',
              items: { type: 'string', enum: [...CANONICAL_INTENT_KEYS] },
            },
            componentHints: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  name: { type: 'string' },
                  role: {
                    type: 'string',
                    enum: ['area', 'waypoint', 'route', 'venue'],
                  },
                  expectedKind: {
                    type: 'string',
                    enum: ['PLACE', 'AREA', 'ROUTE'],
                  },
                  evidenceKeys: { type: 'array', items: { type: 'string' } },
                  supportSpan: {
                    type: 'string',
                    description:
                      "A short phrase/sentence copied VERBATIM from the text of one of this componentHint's own cited evidenceKeys, proving that evidence actually names/describes this component. Never translated, paraphrased, or invented; verified independently by the backend against the cited evidence text.",
                  },
                  addressHint: { type: 'string' },
                  sourceName: {
                    type: 'string',
                    description:
                      'The literal entity wording from the cited evidence when name was normalized or typo-corrected. Omit when identical to name.',
                  },
                  normalizationKind: {
                    type: 'string',
                    enum: ['TYPO_CORRECTION', 'TRANSLATION', 'CANONICAL_NAME'],
                    description:
                      'Optional classification of why name differs from sourceName.',
                  },
                },
                required: [
                  'key',
                  'name',
                  'role',
                  'expectedKind',
                  'evidenceKeys',
                  'supportSpan',
                ],
              },
            },
            suggestedDurationMinutes: { type: 'integer' },
            shortReason: { type: 'string' },
            evidenceKeys: { type: 'array', items: { type: 'string' } },
            orderedByEvidence: {
              type: 'boolean',
              description:
                "True only when the cited evidence explicitly describes a visiting sequence for this candidate's components. Never inferred from componentHints array order.",
            },
          },
          required: [
            'name',
            'description',
            'themes',
            'traits',
            'intents',
            'componentHints',
            'suggestedDurationMinutes',
            'shortReason',
            'evidenceKeys',
            'orderedByEvidence',
          ],
        },
      },
    },
    required: ['candidates'],
  };
}

/** The `Grounded evidence:` header plus one line per evidence item. */
export function buildDiscoveryEvidenceBlock(
  evidence: ExperienceGroundingEvidence[],
): string[] {
  return [
    'Grounded evidence:',
    ...evidence.map(
      (item) => `[${item.key}] ${item.title || item.source}: ${item.snippet}`,
    ),
  ];
}

/** Full user prompt = header + instructions + evidence block. */
export function buildDiscoveryUserPrompt(
  request: ExperienceDiscoveryRequest,
  evidence: ExperienceGroundingEvidence[],
): string {
  return [
    ...buildDiscoveryRequestHeader(request),
    ...buildDiscoveryInstructions(),
    ...buildDiscoveryEvidenceBlock(evidence),
  ].join('\n');
}
