import { ExperienceDiscoveryRequest } from '../interfaces/experience-discovery.interface';
import {
  INITIAL_DIMENSION_VOCABULARY,
  PREFERENCE_DIMENSIONS,
} from '../preferences/preference-facet-vocabulary';
import {
  buildDiscoveryAnchorContext,
  buildDiscoveryEvidenceBlock,
  buildDiscoveryInstructions,
  buildDiscoveryRequestHeader,
  buildDiscoverySystemPrompt,
  buildDiscoveryUserPrompt,
  buildExperienceCompositionRules,
  CANONICAL_INTENT_KEYS,
  CANONICAL_THEME_KEYS,
} from './experience-discovery-extraction.prompt';

describe('experience discovery extraction prompt (shared contract)', () => {
  it('re-exports the canonical vocabularies from the central source of truth', () => {
    expect(CANONICAL_THEME_KEYS).toEqual(
      INITIAL_DIMENSION_VOCABULARY[PREFERENCE_DIMENSIONS.THEME],
    );
    expect(CANONICAL_INTENT_KEYS).toEqual(
      INITIAL_DIMENSION_VOCABULARY[PREFERENCE_DIMENSIONS.INTENT],
    );
  });

  it('system prompt frames the role and forbids inventing geographic identifiers', () => {
    const sys = buildDiscoverySystemPrompt();
    expect(sys).toMatch(/ExperienceCandidate extractor/i);
    expect(sys).toMatch(/Never provide or invent/i);
    expect(sys).toMatch(/Google Place IDs/);
    expect(sys).toMatch(/OpenStreetMap IDs/);
  });

  describe('instructions', () => {
    const lines = buildDiscoveryInstructions();
    const text = lines.join('\n');

    it('names the controlled vocabularies, derived centrally', () => {
      expect(text).toContain(CANONICAL_THEME_KEYS.join(', '));
      expect(text).toContain(CANONICAL_INTENT_KEYS.join(', '));
    });

    it('states the controlled-vs-open facet contract', () => {
      expect(text).toMatch(/traits is the open-ended dimension/i);
      expect(text).toMatch(
        /never put a canonical theme or canonical intent inside traits/i,
      );
      expect(text).toMatch(
        /themes and intents are separate, independent controlled dimensions/i,
      );
      expect(text).toMatch(
        /same canonical key MAY appear in both themes and intents/i,
      );
      expect(text).toMatch(/do not deduplicate across themes and intents/i);
      // no over-reaching global "one array only" rule
      expect(text).not.toMatch(/same concept in more than one/i);
    });

    it('forbids materialising a generic category as a concrete componentHint', () => {
      expect(text).toMatch(/generic pseudo-entity/i);
      expect(text).toMatch(/Specialty Coffee Shop/);
      expect(text).toMatch(/Local Brewery/);
      expect(text).toMatch(/If the evidence names no concrete business/i);
    });

    it('keeps the multi-stop, ordering and evidence-only rules', () => {
      expect(text).toMatch(/enumerate EACH real stop/i);
      expect(text).toMatch(/orderedByEvidence must be true only when/i);
      expect(text).toMatch(/day_trip/);
      expect(text).toMatch(/Do not output coordinates, provider IDs, URLs/i);
    });

    it('scopes local-language name normalization to the SAME evidenced entity, not model knowledge', () => {
      // allowed: normalize/translate the SAME entity to its official local-language form
      expect(text).toMatch(/official local-language name/i);
      expect(text).toMatch(/that SAME entity/);
      expect(text).toMatch(
        /only when you are confident it is the same entity/i,
      );
      // uncertainty -> keep the evidenced name, resolver decides identity
      expect(text).toMatch(
        /keep the exact name the evidence uses and let the backend geographic resolver decide/i,
      );
      // the LLM is not a geographic-identity authority
      expect(text).toMatch(
        /must be the identity of an entity the grounded evidence explicitly supports/i,
      );
      expect(text).toMatch(/invent an official name you are unsure of/i);
      // the old open-ended wording is gone
      expect(text).not.toMatch(/rely on your own knowledge/i);
    });
  });

  describe('Experience vs GeoEntity composition contract (RW4)', () => {
    const text = buildDiscoveryInstructions().join('\n');

    it('A: a route_like/walk intent is semantic and never requires a ROUTE component', () => {
      expect(text).toMatch(
        /intents such as walk or route_like describe how the traveller experiences/i,
      );
      expect(text).toMatch(/do NOT require a ROUTE or AREA componentHint/);
      expect(text).toMatch(
        /valid with several PLACE componentHints and zero ROUTE componentHints/i,
      );
      expect(text).toMatch(
        /expectedKind describes the independently identifiable geographic nature of a component, never the semantic type of the Experience/i,
      );
      // no structural Experience kind is reintroduced
      expect(text).toMatch(/never structural proposal kinds/i);
    });

    it('B: a source-backed physical street/trail/path remains a valid ROUTE component', () => {
      expect(text).toMatch(
        /role "route" \/ expectedKind "ROUTE" only when the cited evidence describes a real geographic route entity whose identity exists independently of the tourism product/i,
      );
      expect(text).toMatch(
        /street, trail, path, road, physical route or recognized geographic corridor/i,
      );
      expect(text).toMatch(/remains a valid ROUTE componentHint/i);
      expect(text).toMatch(
        /Never emit a ROUTE componentHint merely because the source calls the Experience a route, wine route, tour, walk, circuit, itinerary or excursion/i,
      );
    });

    it('C: forbids inserting the Experience/product identity itself as a componentHint', () => {
      expect(text).toMatch(
        /The Experience identity itself is NOT automatically a componentHint/,
      );
      expect(text).toMatch(
        /never copy candidate\.name, the tour\/product name or the tourism concept .* into componentHints merely to give the Experience a geographic shape or to reach a component count/i,
      );
      // a legitimate single-place visit / real named street keeps its name
      expect(text).toMatch(
        /only when that name independently denotes a real geographic entity/i,
      );
    });

    it('D: forbids merging components of distinct source-defined variants', () => {
      expect(text).toMatch(
        /One candidate must represent ONE coherent source-backed composition/,
      );
      expect(text).toMatch(/Monday route vs a Friday route/);
      expect(text).toMatch(/Route A vs Route B/);
      expect(text).toMatch(/different geographic subroutes/);
      expect(text).toMatch(
        /never merge components from different variants into one candidate/i,
      );
      expect(text).toMatch(
        /unless the source itself explicitly defines that combined set as one itinerary/i,
      );
      expect(text).toMatch(/emit one separate candidate per variant/i);
      expect(text).toMatch(/only the single best-supported coherent variant/i);
    });

    it('E: distinguishes A + B composition from alternatives/optional stops', () => {
      expect(text).toMatch(/Alternatives are not mandatory membership/);
      expect(text).toMatch(/"A and B".*is composition/);
      expect(text).toMatch(/"A or B"/);
      expect(text).toMatch(/"choose up to N of A\/B\/C\/D"/);
      expect(text).toMatch(/"optional stop A"/);
      expect(text).toMatch(
        /Never flatten alternatives or optional stops into the componentHints of one candidate/i,
      );
    });

    it('F: a source-defined itinerary is an exhaustive ordered sequence (RW4-EXTRACT-COMPLETENESS-1)', () => {
      expect(text).toMatch(/Source-defined itinerary completeness/);
      expect(text).toMatch(/extract it EXHAUSTIVELY/);
      expect(text).toMatch(
        /including every numbered stop, from its first stop to its last, in the source's own order/,
      );
      expect(text).toMatch(
        /not a selection of highlights or representative places/,
      );
      expect(text).toMatch(
        /never drop a directed stop because it is close to another stop, similar to another stop/,
      );
      // Completeness never licenses invention or flattening alternatives.
      expect(text).toMatch(/never add a stop the evidence does not name/);
      expect(text).toMatch(
        /a place mentioned only in passing .* is not a stop: do not emit it/,
      );
      expect(text).toMatch(/follows the alternatives rule and is not a member/);
      expect(text).toMatch(
        /A place recommended only for eating or drinking .* is a suggestion, not a stop/,
      );
      expect(text).toMatch(
        /A place the source numbers as a stop or directs the traveller to visit stays a stop/,
      );
    });

    it('G: a source-stated motorized transfer splits the itinerary into parts, none dropped', () => {
      expect(text).toMatch(
        /take motorized transport \(bus, taxi, train, ferry, car\)/,
      );
      expect(text).toMatch(/Itinerary parts come first/);
      expect(text).toMatch(
        /Each part is a separate candidate with its own componentHints, and the place the transfer reaches starts the next part/,
      );
      expect(text).toMatch(
        /Never put stops from both sides of such a transfer into one candidate/,
      );
      expect(text).toMatch(/never drop a later part/);
    });

    it('H: consecutive parts of one itinerary are not variants and are never trimmed', () => {
      expect(text).toMatch(
        /a morning tour vs an afternoon tour offered as alternatives/,
      );
      expect(text).not.toMatch(/a morning vs an afternoon itinerary/);
      expect(text).toMatch(
        /Consecutive parts of ONE itinerary .* are not alternative variants/,
      );
      expect(text).toMatch(
        /the stops of one itinerary are never trimmed to keep extraction small/,
      );
    });

    it('MULTI_COMPONENT_EXPERIENCE never licenses self-duplication, fake ROUTEs or variant unions', () => {
      expect(text).toMatch(
        /Never duplicate the Experience identity, invent a geographic ROUTE, or merge different variants\/options merely to reach the component count required by MULTI_COMPONENT_EXPERIENCE/,
      );
      expect(text).toMatch(/return no such candidate/i);
      expect(text).toMatch(/fail closed/i);
    });

    it('states the rules once, in the shared user prompt every extractor sends', () => {
      const request: ExperienceDiscoveryRequest = {
        scope: { destinationName: 'Mendoza' },
        requestedThemes: ['wine'],
        requestedIntents: ['route_like'],
        evidenceRequirements: ['MULTI_COMPONENT_EXPERIENCE'],
        breadth: 'focused',
        maxCandidates: 8,
      };
      const prompt = buildDiscoveryUserPrompt(request, []);
      for (const line of buildDiscoveryInstructions()) {
        expect(prompt).toContain(line);
      }
      expect(prompt).not.toMatch(/[{}]/);
    });
  });

  it('request header renders destination / themes / intents / preferences', () => {
    const header = buildDiscoveryRequestHeader({
      scope: { destinationName: 'Buenos Aires' },
      requestedThemes: ['history', 'architecture'],
      requestedIntents: ['walk'],
      breadth: 'focused',
      maxCandidates: 8,
    } as any);
    expect(header).toEqual([
      'Destination: Buenos Aires',
      'Themes: history, architecture',
      'Requested intents: walk',
      'Preferences: none',
      'Required evidence shape: none',
    ]);
  });

  describe('structured anchor context (C2/C3)', () => {
    const anchored = {
      scope: { destinationName: 'Buenos Aires' },
      requestedThemes: [],
      requestedIntents: ['walk'],
      anchorNames: ['Caminito'],
      evidenceRequirements: ['MULTI_COMPONENT_EXPERIENCE'],
      breadth: 'focused',
      maxCandidates: 8,
    } as any;

    it('exposes the typed anchor names in the shared request header', () => {
      const header = buildDiscoveryRequestHeader(anchored);
      expect(header).toContain('Named anchors: Caminito');
      expect(header.join('\n')).toMatch(
        /Named anchors are research-targeting context/,
      );
    });

    it('keeps anchors from licensing composition or fabricated stops', () => {
      const context = buildDiscoveryAnchorContext(['Caminito']).join('\n');
      expect(context).toMatch(/never licenses composition/);
      expect(context).toMatch(/unless the cited evidence itself supports them/);
      // RW4: a tourism-concept anchor is never turned into a component
      expect(context).toMatch(
        /A named anchor that is a tourism concept .* is never a componentHint/,
      );
    });

    it('reaches the full user prompt every extractor sends', () => {
      const prompt = buildDiscoveryUserPrompt(anchored, []);
      expect(prompt).toContain('Named anchors: Caminito');
      // The anchor context sits before the unchanged shared rules.
      expect(prompt.indexOf('Named anchors: Caminito')).toBeLessThan(
        prompt.indexOf('When MULTI_COMPONENT_EXPERIENCE is requested'),
      );
    });

    it('adds nothing when there is no anchor (no invented default)', () => {
      expect(buildDiscoveryAnchorContext(undefined)).toEqual([]);
      expect(buildDiscoveryAnchorContext([])).toEqual([]);
      expect(buildDiscoveryAnchorContext(['  '])).toEqual([]);
      expect(
        buildDiscoveryUserPrompt({ ...anchored, anchorNames: undefined }, []),
      ).not.toContain('Named anchors');
    });
  });

  describe('anchor = relevance context, never evidence authority (RW4 live-6)', () => {
    const context = buildDiscoveryAnchorContext([
      'Ruta del Vino de Mendoza',
    ]).join('\n');

    it('A: the anchor is research context, not a required phrase or exact identity', () => {
      expect(context).toContain('Named anchors: Ruta del Vino de Mendoza');
      expect(context).toMatch(/Named anchors are research-targeting context/);
      expect(context).toMatch(
        /do not treat anchor text as a required evidence phrase or exact Experience identity/i,
      );
      expect(context).toMatch(/Do not require literal anchor-name occurrence/);
      // the previous hard lexical/identity gate is gone
      expect(context).not.toMatch(/materially about at least one named anchor/);
      expect(context).not.toMatch(
        /Do not emit an Experience that the evidence does not connect to any named anchor/,
      );
      expect(context).not.toMatch(/is the subject of the Experience/);
    });

    it('B: a narrower/translated/product-named source Experience stays relevant under its source identity', () => {
      expect(context).toMatch(
        /translated, localized, narrower, variant, subroute, tour, itinerary or product name/,
      );
      expect(context).toMatch(
        /Do not rename the discovered Experience to the anchor/,
      );
      expect(context).toMatch(
        /never claim that the discovered Experience IS the named anchor unless the cited evidence itself gives it that identity/i,
      );
    });

    it('C: identity, membership, themes and intents come from evidence, never from the anchor', () => {
      expect(context).toMatch(
        /identity, component membership, themes and intents must still come from the cited evidence and normal deterministic backend validation/,
      );
      expect(context).toMatch(
        /anchor context may determine relevance; it never establishes fact/i,
      );
    });

    it('D: a candidate merely sharing a generic theme with the request stays excluded', () => {
      expect(context).toMatch(
        /merely shares a generic theme with the request but has no meaningful relationship to the anchor context or destination must still be excluded/,
      );
      // softening relevance never relaxes the evidence/composition rules
      expect(context).toMatch(
        /every rule below about source support, cited evidence and multi-component Experiences still applies/,
      );
    });

    it('E: introduces no anchor taxonomy -- one generic anchorNames list only', () => {
      // The typed request contract carries anchors as a plain name list; no
      // mode/kind/type discriminant reaches the extraction contract.
      const request: ExperienceDiscoveryRequest = {
        scope: { destinationName: 'Mendoza' },
        requestedThemes: ['wine'],
        requestedIntents: ['route_like'],
        anchorNames: ['Ruta del Vino de Mendoza'],
        evidenceRequirements: ['MULTI_COMPONENT_EXPERIENCE'],
        breadth: 'focused',
        maxCandidates: 8,
      };
      const prompt = buildDiscoveryUserPrompt(request, []);
      expect(prompt).not.toMatch(/anchor ?(mode|kind|type)\b/i);
      // the anchor context depends on the names alone
      expect(buildDiscoveryAnchorContext(request.anchorNames)).toEqual(
        buildDiscoveryAnchorContext(['Ruta del Vino de Mendoza']),
      );
    });

    it('preserves every composition rule unchanged alongside the softened anchor', () => {
      const prompt = buildDiscoveryUserPrompt(
        {
          scope: { destinationName: 'Mendoza' },
          requestedThemes: ['wine'],
          requestedIntents: ['route_like'],
          anchorNames: ['Ruta del Vino de Mendoza'],
          evidenceRequirements: ['MULTI_COMPONENT_EXPERIENCE'],
          breadth: 'focused',
          maxCandidates: 8,
        },
        [],
      );
      for (const line of buildExperienceCompositionRules()) {
        expect(prompt).toContain(line);
      }
      expect(prompt).toMatch(
        /at least two non-area real geographic components as belonging to that same real Experience/,
      );
    });
  });

  it('evidence block renders one [key] line per item', () => {
    const block = buildDiscoveryEvidenceBlock([
      { key: 'ev-1', source: 'src', title: 'T1', snippet: 'S1' },
      { key: 'ev-2', source: 'src2', snippet: 'S2' },
    ]);
    expect(block[0]).toBe('Grounded evidence:');
    expect(block[1]).toBe('[ev-1] T1: S1');
    expect(block[2]).toBe('[ev-2] src2: S2');
  });

  it('full user prompt is a brace-free join (safe for f-string prompt templating)', () => {
    const prompt = buildDiscoveryUserPrompt(
      {
        scope: { destinationName: 'Buenos Aires' },
        requestedThemes: ['food'],
        requestedIntents: ['route_like'],
        breadth: 'focused',
        maxCandidates: 8,
      } as any,
      [{ key: 'ev-1', source: 's', title: 't', snippet: 'snippet' }],
    );
    expect(prompt).not.toMatch(/[{}]/);
    expect(prompt).toContain('Destination: Buenos Aires');
    expect(prompt).toContain('[ev-1] t: snippet');
  });

  it('states the requested-shape composition guardrails in one shared prompt', () => {
    const prompt = buildDiscoveryUserPrompt(
      {
        scope: { destinationName: 'Buenos Aires' },
        requestedThemes: ['history'],
        requestedIntents: ['walk'],
        evidenceRequirements: ['MULTI_COMPONENT_EXPERIENCE'],
        breadth: 'focused',
        maxCandidates: 8,
      } as any,
      [],
    );
    expect(prompt).toContain('MULTI_COMPONENT_EXPERIENCE');
    expect(prompt).toMatch(/Never combine independent POIs merely because/i);
    expect(prompt).toMatch(/generic labels.*not geographic ROUTE entities/i);
    expect(prompt).toMatch(/at least two real geographic components/i);
  });
});
