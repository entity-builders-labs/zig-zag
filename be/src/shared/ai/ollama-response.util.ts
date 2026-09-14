/**
 * Ollama models may wrap structured JSON in a Markdown code fence even when
 * the caller requested a JSON response. Normalize that transport artifact at
 * the Ollama boundary so domain services only receive JSON text.
 */
export function normalizeOllamaStructuredResponse(response: string): string {
  const trimmed = response.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}
