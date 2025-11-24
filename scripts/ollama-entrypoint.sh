#!/bin/sh
set -e

# Start Ollama server in background
echo "🚀 Starting Ollama server..."
ollama serve &
OLLAMA_PID=$!

# Function to check if model exists
check_model_exists() {
  local model=$1
  ollama list 2>/dev/null | awk '{print $1}' | grep -q "^${model}" 2>/dev/null || return 1
  return 0
}

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

# Get models from environment variables
AI_MODEL=${AI_MODEL:-llama3.2}
EMBEDDINGS_MODEL=${EMBEDDINGS_MODEL:-nomic-embed-text}

echo "📋 Checking for required models..."
echo "   AI_MODEL: ${AI_MODEL}"
echo "   EMBEDDINGS_MODEL: ${EMBEDDINGS_MODEL}"

# Pull AI model if it doesn't exist
if check_model_exists "${AI_MODEL}"; then
  echo "✓ AI model ${AI_MODEL} already exists"
else
  echo "📥 Pulling AI model: ${AI_MODEL}"
  ollama pull "${AI_MODEL}" || {
    echo "⚠️  Warning: Failed to pull AI model ${AI_MODEL}, continuing anyway..."
  }
  echo "✅ AI model ${AI_MODEL} ready"
fi

# Pull embeddings model if it doesn't exist
if check_model_exists "${EMBEDDINGS_MODEL}"; then
  echo "✓ Embeddings model ${EMBEDDINGS_MODEL} already exists"
else
  echo "📥 Pulling embeddings model: ${EMBEDDINGS_MODEL}"
  ollama pull "${EMBEDDINGS_MODEL}" || {
    echo "⚠️  Warning: Failed to pull embeddings model ${EMBEDDINGS_MODEL}, continuing anyway..."
  }
  echo "✅ Embeddings model ${EMBEDDINGS_MODEL} ready"
fi

echo "✅ All models are ready"

# Keep the server running in foreground
# Use trap to ensure we kill the background process on exit
trap "kill $OLLAMA_PID 2>/dev/null || true" EXIT INT TERM
wait $OLLAMA_PID

