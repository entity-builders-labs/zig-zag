import {
  INITIAL_DIMENSION_VOCABULARY,
  PREFERENCE_DIMENSIONS,
} from '../preferences/preference-facet-vocabulary';
import {
  buildDiscoveryEvidenceBlock,
  buildDiscoveryInstructions,
  buildDiscoveryRequestHeader,
  buildDiscoverySystemPrompt,
  buildDiscoveryUserPrompt,
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
    ]);
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
});
