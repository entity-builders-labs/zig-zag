/**
 * Utility functions for parsing and cleaning JSON from AI responses
 */

/**
 * Extract and clean JSON from AI response text
 * Handles markdown code blocks, extra text, and common formatting issues
 */
export function extractAndCleanJson(text: string): string {
  let cleaned = text.trim();

  // Remove markdown code blocks
  cleaned = cleaned.replace(/^```json\s*/i, '');
  cleaned = cleaned.replace(/^```\s*/, '');
  cleaned = cleaned.replace(/\s*```$/g, '');

  // Try to find JSON object boundaries using balanced braces
  const extractJsonObject = (text: string): string | null => {
    const startIdx = text.indexOf('{');
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
        if (char === '{') {
          depth++;
        } else if (char === '}') {
          depth--;
          if (depth === 0) {
            // Found the complete object
            return text.substring(startIdx, i + 1);
          }
        }
      }
    }

    return null;
  };

  // Try to extract JSON object
  const extractedJson = extractJsonObject(cleaned);
  if (extractedJson) {
    cleaned = extractedJson;
  } else {
    // Fallback: simple boundary detection
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
    }
  }

  // Remove any leading/trailing whitespace
  cleaned = cleaned.trim();

  // Remove common prefixes/suffixes that models sometimes add
  cleaned = cleaned.replace(
    /^Here's? (the|your|a) (JSON|json|response):\s*/i,
    '',
  );
  cleaned = cleaned.replace(/^(JSON|json):\s*/i, '');
  cleaned = cleaned.replace(
    /\s*This is (the|your|a) (JSON|json|response)\.?\s*$/i,
    '',
  );

  return cleaned;
}

/**
 * Attempt to repair common JSON formatting issues
 */
export function repairJson(jsonString: string): string {
  let repaired = jsonString;

  // Fix trailing commas before closing brackets/braces (most common issue)
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1');

  // Remove comments (JSON doesn't support comments)
  repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, '');
  repaired = repaired.replace(/\/\/.*$/gm, '');

  // Fix unescaped newlines and carriage returns in string values
  // This is safer than the previous approach - only fix within string contexts
  let inString = false;
  let escapeNext = false;
  let result = '';

  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];

    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    if (inString) {
      // Inside a string - escape newlines and carriage returns
      if (char === '\n') {
        result += '\\n';
      } else if (char === '\r') {
        result += '\\r';
      } else if (char === '\t') {
        result += '\\t';
      } else {
        result += char;
      }
    } else {
      result += char;
    }
  }

  repaired = result;

  return repaired;
}
