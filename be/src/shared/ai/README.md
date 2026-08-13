# Shared AI Module

Central AI infrastructure used across all backend modules. Provides LLM interaction, embeddings, vector search, image generation, and response caching.

## Architecture

```
ai/
├── ai.module.ts                    # NestJS module exports
├── ai.config.ts                    # AI provider configuration (env-based)
├── langchain.service.ts            # Core LLM service
├── image-generation.service.ts     # DALL-E image generation
└── services/
    ├── ai-cache.service.ts         # File-based response caching
    ├── ai-embedding.service.ts     # Text → vector embeddings
    └── vector-store.service.ts     # pgvector similarity search
```

## Services

### `LangChainService`

The primary AI service. Handles all LLM interactions:

- **Model initialization**: Supports both **OpenAI** (GPT-4) and **Ollama** (local LLMs)
  - Provider is determined by `AI_PROVIDER` env var (`openai` or `ollama`)
  - Ollama supports optional authentication headers
- **Chat responses**: `generateChatResponse(systemPrompt, userPrompt, variables)`
- **Completion responses**: `generateCompletionResponse(promptText, variables)`
- **Activity analysis**: `analyzeActivity(activity, distanceKm)` — generates structured metadata
- **Prompt templates**: `createPromptTemplate()` + `createChain()` for reusable chains
- **Caching**: Integrates with `AiCacheService` to avoid redundant API calls

### `VectorStoreService`

Semantic similarity search over activities using **pgvector** — a `vector(256)` column + HNSW index on `Activity.embedding`, queried via raw SQL (`ORDER BY embedding <=> $1`). No separate vector database process; it rides on the same Postgres connection as everything else.

- **`addActivityToVectorStore()`**: Generates an embedding for an activity's rich text → writes it to `Activity.embedding`
- **`saveActivityEmbedding()`**: Batch embedding for multiple activities
- **`findSimilarActivities(prompt, k)`**: Semantic search by text query
- **`rebuildVectorStore()`**: Re-embeds all activities with non-null `metadata` from PostgreSQL
- **`resetVectorStore()`**: Clears every stored embedding (sets `embedding` to `NULL`)

### `AiEmbeddingService`

Generates text embeddings using the configured provider:

- OpenAI: `text-embedding-3-small` model
- Ollama: Local embedding model

### `AiCacheService`

File-based caching for AI responses (stored in `be/storage/ai-cache/`):

- Hashes prompt → checks for cached `.json` file → returns if exists
- Avoids redundant API calls during development

### `ImageGenerationService`

Generates images via OpenAI DALL-E API:

- Primary: DALL-E 3 (1024×1024)
- Fallback: DALL-E 2 if DALL-E 3 is unavailable
- Bypass flag (default `true`) to skip image gen during development
- Requires `OPENAI_API_KEY`

## Configuration (`ai.config.ts`)

Key environment variables:

| Variable               | Default                          | Description                                              |
| ---------------------- | --------------------------------- | --------------------------------------------------------- |
| `AI_PROVIDER`          | `openai`                          | Chat/completion provider (`openai`, `groq`, or `ollama`)   |
| `OPENAI_API_KEY`       | —                                 | OpenAI API key                                            |
| `AI_MODEL`             | `llama3.2`                        | Chat model name                                           |
| `EMBEDDING_PROVIDER`   | `ollama` (dev) / `openai` (prod)  | Embedding provider (`openai`, `ollama`, or `bedrock`)      |
| `EMBEDDINGS_MODEL`     | `nomic-embed-text`                | Embedding model name                                       |
| `EMBEDDING_DIMENSIONS` | `256`                             | Output vector width (`256`, `512`, or `1024`) — must match the `vector(256)` column |
| `OLLAMA_BASE_URL`      | `http://localhost:11434`          | Ollama server URL                                          |
| `ENABLE_AI`            | `true`                            | Enable/disable AI features                                 |
| `AI_TIMEOUT`           | `60000`                           | Request timeout in ms                                      |
