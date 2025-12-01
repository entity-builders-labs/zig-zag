import { Activity } from '@prisma/client';

export const buildComplementaryPrompt = (
  activity: Activity,
  metadata: any,
  options: any,
): string => {
  const timeOfDay = metadata.timeOfDayPreference?.join(', ') || 'flexible';
  const complementaryAfter =
    metadata.complementaryActivities?.after?.join(', ') || '';
  const energyAfter = metadata.energyLevel?.after || 3;
  const physicalIntensity = metadata.physicalIntensity || 3;
  const combinationScores = metadata.combinationScore || {};

  // Build contextual hints
  const contextualInfo =
    options.contextualHints?.length > 0
      ? `Additional context: ${options.contextualHints.join(', ')}.`
      : '';

  return `Find activities that complement and flow well after "${activity.name}".

Current activity details:
- Type: ${activity.type}
- Physical intensity: ${physicalIntensity}/5
- Best time: ${timeOfDay}
- Energy level after: ${energyAfter}/5
- Complementary activity types: ${complementaryAfter}
- Strong combination areas: ${Object.entries(combinationScores)
    .filter(([, score]: [string, number]) => score >= 4)
    .map(([type]) => type)
    .join(', ')}

${contextualInfo}

Looking for activities that:
1. Create a natural progression from the current activity
2. Match the energy level and flow expectations
3. Offer complementary experiences (different but harmonious)
4. Consider transition time and logistics
5. Provide variety while maintaining coherence

Prioritize activities that would make someone think "this is the perfect next thing to do".`;
};

export const generateRecommendationReasoningPrompt = (
  sourceActivityName: string,
  candidateActivityName: string,
  scores: {
    complementarityScore: number;
    diversityScore: number;
    proximityScore: number;
    timeCompatibilityScore: number;
  },
) => `Explain why "${candidateActivityName}" is a great follow-up activity after "${sourceActivityName}".

Scoring breakdown:
- Complementarity: ${scores.complementarityScore}/100
- Diversity: ${scores.diversityScore}/100  
- Proximity: ${scores.proximityScore}/100
- Time compatibility: ${scores.timeCompatibilityScore}/100

Provide a concise, engaging explanation (2-3 sentences) that highlights the main reasons why this combination works well, focusing on the flow, experience, and practical benefits.`;

export const RECOMMENDATION_SYSTEM_PROMPT =
  'You are a travel experience designer who creates seamless activity transitions.';
