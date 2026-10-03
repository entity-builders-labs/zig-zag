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
    ├── semantic-experience-document-builder.service.ts # Canonical Experience text
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
- **Experience analysis**: generates structured metadata for acquired Experiences
- **Prompt templates**: `createPromptTemplate()` + `createChain()` for reusable chains
- **Caching**: Integrates with `AiCacheService` to avoid redundant API calls

Provider ownership is capability-specific. `AI_PROVIDER` selects only the
general chat/interpreter transport; discovery extraction uses
`DISCOVERY_EXTRACTOR_PROVIDER` and its provider-specific discovery model,
grounded evidence uses `GROUNDED_SEARCH_PROVIDER`, evidence-only
classification uses `CLASSIFICATION_PROVIDER` and its provider-specific
classification model, and
embeddings use `EMBEDDING_PROVIDER`. No capability inherits a model from an
unrelated provider.

### `VectorStoreService`

Semantic similarity search over Experiences using **pgvector** — a `vector(256)` column + HNSW index on `Experience.embedding`. No separate vector database process is used.

- Every write reloads the canonical Experience and uses the semantic Experience document builder; callers cannot provide ad-hoc embedding prose.
- Every vector stores its provider, model, width, document version, and timestamp. Queries exclude vectors whose identity does not exactly match the configured index.
- `saveExperienceEmbedding()` returns the exact indexed IDs, reports provider unavailability, or throws `EmbeddingWriteError`; it never swallows a failed write.
- `getSimilarityScores()` returns `applied` or `unavailable` from the actual query operation, including compatible/missing candidate counts.
- `rebuildVectorStore()` first clears all vectors and identity fields, then rebuilds every verified Experience. If any batch fails, it clears the partial result before returning the error.

### `AiEmbeddingService`

Generates text embeddings using exactly the configured provider:

- production default: Amazon Bedrock Titan Text Embeddings V2, 256 dimensions;
- local default: Ollama `nomic-embed-text`, truncated and normalized to 256 dimensions;
- optional explicit provider: OpenAI `text-embedding-3-small`.

`EMBEDDING_PROVIDER` is authoritative. Startup or runtime failure makes the
service explicitly unavailable; the service never tries another provider even
when unrelated credentials are present. Changing provider, model, dimensions,
or the semantic document version requires a coordinated Experience embedding
rebuild before deployment.

Local and production both use PostgreSQL + pgvector. ChromaDB is not part of
this architecture.

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

| Variable               | Default                           | Description                                                                                                  |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `AI_PROVIDER`          | `openai`                          | General chat/interpreter provider (`openai`, `groq`, `gemini`, or `ollama`)                                  |
| `OPENAI_API_KEY`       | —                                 | OpenAI API key                                                                                               |
| `OPENAI_MODEL`         | `gpt-4o-mini`                     | Chat model when `AI_PROVIDER=openai`                                                                         |
| `GROQ_MODEL`           | `openai/gpt-oss-20b`              | Chat model when `AI_PROVIDER=groq`                                                                           |
| `GEMINI_MODEL`         | `gemini-3.6-flash`               | Chat model when `AI_PROVIDER=gemini`                                                                         |
| `OLLAMA_MODEL`         | `llama3.2`                        | Chat model when `AI_PROVIDER=ollama`                                                                         |
| `EMBEDDING_PROVIDER`   | `ollama` (dev) / `bedrock` (prod) | Authoritative embedding provider (`openai`, `ollama`, or `bedrock`)                                          |
| `EMBEDDINGS_MODEL`     | provider-specific                 | Titan V2 / `nomic-embed-text` / `text-embedding-3-small`                                                     |
| `EMBEDDING_DIMENSIONS` | `256`                             | Fixed output width; any other value is rejected until a coordinated pgvector schema migration is implemented |
| `OLLAMA_BASE_URL`      | `http://localhost:11434`          | Ollama server URL                                                                                            |
| `ENABLE_AI`            | `true`                            | Enable/disable AI features                                                                                   |
| `AI_TIMEOUT`           | `60000`                           | Request timeout in ms                                                                                        |
