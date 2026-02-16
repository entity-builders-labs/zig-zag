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
    └── vector-store.service.ts     # ChromaDB vector store management
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

Manages the ChromaDB vector database for semantic similarity search:

- **Initialization**: Connects to ChromaDB on module start
- **`addActivityToVectorStore()`**: Generates embedding for activity text → stores in Chroma
- **`saveActivityEmbedding()`**: Batch embedding for multiple activities
- **`findSimilarActivities(prompt, k, filter)`**: Semantic search by text query
- **`rebuildVectorStore()`**: Re-indexes all activities from PostgreSQL
- **`resetVectorStore()`**: Clears ChromaDB collection

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

| Variable             | Default                  | Description                        |
| -------------------- | ------------------------ | ---------------------------------- |
| `AI_PROVIDER`        | `ollama`                 | AI provider (`openai` or `ollama`) |
| `OPENAI_API_KEY`     | —                        | OpenAI API key                     |
| `AI_MODEL`           | `llama3.2`               | Model name                         |
| `AI_EMBEDDING_MODEL` | `nomic-embed-text`       | Embedding model                    |
| `OLLAMA_URL`         | `http://localhost:11434` | Ollama server URL                  |
| `CHROMA_URL`         | `http://localhost:8000`  | ChromaDB server URL                |
| `ENABLE_AI`          | `true`                   | Enable/disable AI features         |
| `AI_TIMEOUT`         | `60000`                  | Request timeout in ms              |
