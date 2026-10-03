export const generateCoverImagePrompt = (
  tourName: string,
  description: string,
  highlights: string,
) => `A breathtaking, high-quality travel cover image for a tour named "${tourName}".
Description: ${description || tourName}.
Key highlights: ${highlights || 'scenic locations'}.
Style: Professional travel photography, vibrant, inviting, wide angle, cinematic lighting.
No text, no watermarks, no collages, no labels.`;
