export interface NormalizedPreferenceIntent {
  preferredThemes: string[];
  preferredTraits: string[];
  preferredIntents: string[];
  excludedThemes: string[];
  excludedTraits: string[];
  hardExclusions: string[];
  softConstraints: string[];
  ambiguities: string[];
  dietaryPreferences: string[];
  accessibilityPreferences: string[];
  budgetPreferences: string[];
  groupPreferences: string[];
  positiveSemanticQuery: string;
  notes: string[];
}

export interface PreferenceInterpretationTrace {
  stage: 'preference_interpretation';
  provider?: string;
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  responseSchema: Record<string, unknown>;
  rawResponse?: unknown;
  parsedResponse: NormalizedPreferenceIntent;
  validationErrors: string[];
  status: 'applied' | 'fallback' | 'failed' | 'skipped';
  durationMs: number;
}
