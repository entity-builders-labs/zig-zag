#!/bin/sh
set -e

# Start Ollama server in background
echo "🚀 Starting Ollama server..."
ollama serve &
OLLAMA_PID=$!

# Function to check if model exists
check_model_exists() (
  model_to_check=$1
  ollama list 2>/dev/null | awk '{print $1}' | grep -q "^${model_to_check}" 2>/dev/null || return 1
  return 0
)

# Wait for Ollama API to be ready
echo "⏳ Waiting for Ollama API to be ready..."
RETRY_COUNT=0
MAX_RETRIES=30
until ollama list > /dev/null 2>&1; do
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "❌ Ollama API failed to start after $MAX_RETRIES attempts"
    exit 1
  fi
  echo "⏳ Waiting for Ollama API... (attempt $((RETRY_COUNT + 1))/$MAX_RETRIES)"
  sleep 2
  RETRY_COUNT=$((RETRY_COUNT + 1))
done

echo "✅ Ollama server is ready"

# Get providers/models from environment variables. The Ollama container may
# serve only embeddings while chat is handled by Groq (the common local
# setup), so a remote provider's model name must never be pulled here.
AI_PROVIDER=${AI_PROVIDER:-groq}
EMBEDDING_PROVIDER=${EMBEDDING_PROVIDER:-ollama}
OLLAMA_MODEL=${OLLAMA_MODEL:-llama3.2}
EMBEDDINGS_MODEL=${EMBEDDINGS_MODEL:-nomic-embed-text}

echo "📋 Checking for required models..."
echo "   chat: ${AI_PROVIDER}/${OLLAMA_MODEL}"
echo "   embeddings: ${EMBEDDING_PROVIDER}/${EMBEDDINGS_MODEL}"

require_model() {
  model=$1
  operation=$2
  if check_model_exists "${model}"; then
    echo "✓ ${operation} model ${model} already exists"
    return 0
  fi

  echo "📥 Pulling ${operation} model: ${model}"
  if ! ollama pull "${model}"; then
    echo "❌ Failed to pull required ${operation} model ${model}"
    exit 1
  fi
  if ! check_model_exists "${model}"; then
    echo "❌ Required ${operation} model ${model} is still unavailable after pull"
    exit 1
  fi
  echo "✅ ${operation} model ${model} ready"
}

if [ "${AI_PROVIDER}" = "ollama" ]; then
  require_model "${OLLAMA_MODEL}" "chat"
else
  echo "↪ Chat provider is ${AI_PROVIDER}; skipping Ollama chat-model pull"
fi

if [ "${EMBEDDING_PROVIDER}" = "ollama" ]; then
  require_model "${EMBEDDINGS_MODEL}" "embeddings"
else
  echo "↪ Embedding provider is ${EMBEDDING_PROVIDER}; skipping Ollama embedding-model pull"
fi

echo "✅ All models are ready"

# Keep the server running in foreground
# Use trap to ensure we kill the background process on exit
trap 'kill "$OLLAMA_PID" 2>/dev/null || true' EXIT INT TERM
wait $OLLAMA_PID
