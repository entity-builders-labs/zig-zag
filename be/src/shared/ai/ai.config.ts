import { registerAs } from '@nestjs/config';

export interface AiConfig {
  // General
  enableAi: boolean;
  provider: 'openai' | 'groq' | 'ollama';
  defaultModel: string;
  temperature: number;
  timeout: number;
  // Optional Chroma vector store configuration
  chromaUrl?: string;
  chromaCollectionName?: string;
  // OpenAI
  openaiApiKey?: string;
  // Groq
  groqApiKey?: string;
  // Ollama
  ollamaBaseUrl?: string;
  ollamaApiKey?: string;
  // Embeddings
  embeddingsModel?: string;
}

export default registerAs('ai', (): AiConfig => {
  return {
    enableAi: process.env.ENABLE_AI !== 'false',
    provider: (process.env.AI_PROVIDER as any) || 'openai',
    defaultModel:
      process.env.AI_MODEL ||
      (process.env.AI_PROVIDER === 'openai'
        ? process.env.OPENAI_DEFAULT_MODEL || 'gpt-3.5-turbo'
        : 'llama3.1'),
    temperature: process.env.OPENAI_TEMPERATURE
      ? parseFloat(process.env.OPENAI_TEMPERATURE)
      : 0.7,
    timeout: process.env.OPENAI_TIMEOUT
      ? parseInt(process.env.OPENAI_TIMEOUT, 10)
      : 60000,
    chromaUrl: process.env.CHROMA_URL || undefined,
    chromaCollectionName: process.env.CHROMA_COLLECTION_NAME || 'activities',
    openaiApiKey: process.env.OPENAI_API_KEY,
    groqApiKey: process.env.GROQ_API_KEY,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    ollamaApiKey: process.env.OLLAMA_API_KEY,
    embeddingsModel: process.env.EMBEDDINGS_MODEL || 'nomic-embed-text',
  };
});
