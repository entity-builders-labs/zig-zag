import { Activity } from '@prisma/client';

export const CONTEXTUAL_ACTIVITIES_SYSTEM_PROMPT =
  'You are a local tourism expert with access to real-time location data and deep knowledge of what activities exist in specific geographic areas.';

export const generateContextualActivitiesPrompt = (
  sourceActivity: Activity,
  sourceMetadata: any,
  localContext: string,
  count: number,
) => `You are generating complementary activities near "${sourceActivity.name}" in this area.

LOCATION CONTEXT:
- Coordinates: ${sourceActivity.latitude}, ${sourceActivity.longitude}
- Address: ${sourceActivity.formattedAddress}
- Nearby existing activities: ${localContext}

CURRENT ACTIVITY:
- Name: ${sourceActivity.name}
- Type: ${sourceActivity.type}
- Description: ${sourceActivity.description}
- Duration: ${sourceActivity.duration} minutes
- Energy level after: ${sourceMetadata.energyLevel?.after || 3}/5

REQUIREMENTS:
Generate ${count} realistic activities that:
1. Actually exist or could realistically exist in this specific area
2. Are within 2-5km of the source location
3. Complement the energy flow and experience type
4. Avoid duplicating nearby existing activities: ${localContext}

For each activity, provide these fields:
- name: Specific, realistic business/location name
- type: Activity category
- description: Detailed description with local context
- latitude: realistic latitude nearby
- longitude: realistic longitude nearby
- duration: duration in minutes
- formattedAddress: Realistic street address
- localTips: Specific tips for this location
- whyNext: Why this works well after the source activity

Return as a valid JSON array with these exact field names.`;
