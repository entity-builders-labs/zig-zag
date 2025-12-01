#!/bin/bash
# Script para deploy del backend a Fly.io
# Verifica que los secrets necesarios estén configurados antes de deployar
# Si faltan, intenta leerlos de archivos .env y configurarlos automáticamente
# Uso: ./deploy-be.sh [--skip-checks] [--env-file .env.prod] [--force-update VAR1,VAR2,...]

set -e

# Get the directory where the script is located (fly directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Change to project root directory
cd "$PROJECT_ROOT"

APP_NAME="zig-zag-backend"
CONFIG_FILE="fly-be.toml"
SKIP_CHECKS=false
ENV_FILE=""
FORCE_UPDATE_VARS=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-checks)
      SKIP_CHECKS=true
      shift
      ;;
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --force-update)
      FORCE_UPDATE_VARS="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--skip-checks] [--env-file .env.prod] [--force-update VAR1,VAR2,...]"
      exit 1
      ;;
  esac
done

# Function to check if a variable should be force-updated
should_force_update() {
  local var_name="$1"
  if [ -z "$FORCE_UPDATE_VARS" ]; then
    return 1
  fi
  # Convert comma-separated list to space-separated and check if var_name is in it
  IFS=',' read -ra VARS <<< "$FORCE_UPDATE_VARS"
  for var in "${VARS[@]}"; do
    if [ "$var" = "$var_name" ]; then
      return 0
    fi
  done
  return 1
}

# Function to read variable from .env file
read_env_var() {
  local var_name="$1"
  local env_file="$2"
  if [ -f "$env_file" ]; then
    grep -E "^[[:space:]]*${var_name}[[:space:]]*=" "$env_file" 2>/dev/null | head -1 | sed -E 's/^[^=]*=[[:space:]]*["'\'']?([^"'\'']*)["'\'']?[[:space:]]*$/\1/'
  fi
}

# Function to find .env file (priority: .env.prod > .env.fly > be/.env.prod > be/.env.fly > be/.env > .env)
# RECOMMENDED: Use .env.prod in project root for production
# FALLBACK: Supports be/.env.* for backward compatibility
find_env_file() {
  if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
    echo "$ENV_FILE"
    return
  fi
  
  # First, check in root folder (RECOMMENDED for production)
  for file in ".env.prod" ".env.fly"; do
    if [ -f "$file" ]; then
      echo "$file"
      return
    fi
  done
  
  # Fallback to be/ folder (for backward compatibility)
  for file in "be/.env.prod" "be/.env.fly" "be/.env"; do
    if [ -f "$file" ]; then
      echo "$file"
      return
    fi
  done
  
  # Last resort: root .env (development file - not recommended for production)
  if [ -f ".env" ]; then
    echo ".env"
    return
  fi
  
  echo ""
}

echo "🚀 Deploying backend to Fly.io..."
if [ -n "$FORCE_UPDATE_VARS" ]; then
  echo "🔄 Force-update mode enabled for: $FORCE_UPDATE_VARS"
fi
echo ""

# Backend-specific environment variables (exclude frontend EXPO_PUBLIC_* variables)
is_backend_var() {
  local key="$1"
  # Exclude frontend variables
  [[ "$key" =~ ^EXPO_PUBLIC_ ]] && return 1
  # Include backend variables
  return 0
}

# Function to import only missing or changed variables from .env file to Fly.io
import_env_to_fly() {
  local env_file="$1"
  if [ ! -f "$env_file" ]; then
    return 1
  fi
  
  echo "📄 Reading backend variables from $env_file..."
  echo ""
  
  # Get list of currently configured secrets
  local configured_secrets=$(fly secrets list --app "$APP_NAME" 2>/dev/null | awk 'NR>1 {print $1}' || echo "")
  
  local count=0
  local secrets_to_set=()
  local skipped_count=0
  local force_update_count=0
  
  # Read the file line by line
  while IFS= read -r line || [ -n "$line" ]; do
    # Ignore comments and empty lines
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    
    # Parse key=value
    if [[ "$line" =~ ^([^=]+)=(.*)$ ]]; then
      local key="${BASH_REMATCH[1]}"
      local value="${BASH_REMATCH[2]}"
      
      # Trim spaces
      key=$(echo "$key" | xargs)
      value=$(echo "$value" | xargs)
      
      # Remove quotes if present
      value=$(echo "$value" | sed 's/^"//;s/"$//' | sed "s/^'//;s/'$//")
      
      # Only process if key and value are not empty
      if [ -n "$key" ] && [ -n "$value" ]; then
        # Filter: only backend variables (exclude EXPO_PUBLIC_*)
        if is_backend_var "$key"; then
          # Check if this variable should be force-updated
          if should_force_update "$key"; then
            secrets_to_set+=("${key}=${value}")
            echo "   🔄 Force updating $key"
            ((count++))
            ((force_update_count++))
          elif echo "$configured_secrets" | grep -q "^${key}$"; then
            echo "   ⊘ Skipping $key (already configured)"
            ((skipped_count++))
          else
            secrets_to_set+=("${key}=${value}")
            echo "   ✓ Found (new): $key"
            ((count++))
          fi
        else
          echo "   ⊘ Skipping $key (frontend variable)"
        fi
      fi
    fi
  done < "$env_file"
  
  if [ ${#secrets_to_set[@]} -gt 0 ]; then
    echo ""
    local new_count=$((${#secrets_to_set[@]} - force_update_count))
    if [ $force_update_count -gt 0 ] && [ $new_count -gt 0 ]; then
      echo "🔧 Configuring ${#secrets_to_set[@]} secrets in Fly.io ($new_count new, $force_update_count force-updated)..."
    elif [ $force_update_count -gt 0 ]; then
      echo "🔧 Force-updating $force_update_count secrets in Fly.io..."
    else
      echo "🔧 Configuring ${#secrets_to_set[@]} new secrets in Fly.io..."
    fi
    for secret_pair in "${secrets_to_set[@]}"; do
      local secret_name=$(echo "$secret_pair" | cut -d'=' -f1)
      # Extract value (everything after the first =)
      local secret_value="${secret_pair#${secret_name}=}"
      
      if should_force_update "$secret_name"; then
        echo "   🔄 Force-updating $secret_name..."
      else
        echo "   → Setting $secret_name..."
      fi
      
      # Use proper format: KEY=VALUE as separate argument, properly quoted
      # Capture output to check for errors, but don't show it unless there's a problem
      local output_file=$(mktemp)
      local exit_code=0
      
      # Use timeout to prevent hanging (30 seconds should be enough)
      if command -v timeout >/dev/null 2>&1; then
        timeout 30 fly secrets set "${secret_name}=${secret_value}" --app "$APP_NAME" > "$output_file" 2>&1 || exit_code=$?
      else
        # Fallback if timeout is not available
        fly secrets set "${secret_name}=${secret_value}" --app "$APP_NAME" > "$output_file" 2>&1 || exit_code=$?
      fi
      
      if [ $exit_code -ne 0 ]; then
        echo "   ❌ Failed to set $secret_name (exit code: $exit_code)"
        echo "   Error output:"
        cat "$output_file" 2>/dev/null || true
        rm -f "$output_file"
        return 1
      fi
      rm -f "$output_file"
    done
    if [ $force_update_count -gt 0 ] && [ $new_count -gt 0 ]; then
      echo "✅ ${#secrets_to_set[@]} secrets configured ($new_count new, $force_update_count force-updated)"
    elif [ $force_update_count -gt 0 ]; then
      echo "✅ $force_update_count secrets force-updated"
    else
      echo "✅ ${#secrets_to_set[@]} new secrets configured"
    fi
    if [ $skipped_count -gt 0 ]; then
      echo "   ℹ️  $skipped_count secrets already configured (skipped)"
    fi
    echo ""
    return 0
  else
    if [ $skipped_count -gt 0 ]; then
      echo ""
      echo "✅ All backend secrets are already configured ($skipped_count found, 0 new)"
      echo ""
      return 0  # Success: all secrets are configured
    else
      echo "   ⚠️  No backend variables found in $env_file"
      echo ""
      return 1  # Error: no variables found
    fi
  fi
}

# Try to import only missing backend variables from .env file
ENV_FILE_FOUND=$(find_env_file)
if [ -n "$ENV_FILE_FOUND" ]; then
  echo "📋 Checking for missing backend variables in $ENV_FILE_FOUND..."
  import_env_to_fly "$ENV_FILE_FOUND" || true  # Don't fail if all are already configured
fi

# Required secrets (critical for backend to work)
REQUIRED_SECRETS=(
  "DATABASE_URL"
)

# Optional but recommended secrets
RECOMMENDED_SECRETS=(
  "DIRECT_URL"
  "CHROMA_URL"
  "GOOGLE_MAPS_API_KEY"
  "EMBEDDINGS_MODEL"
)

# Check if secrets are configured
if [ "$SKIP_CHECKS" = false ]; then
  echo "🔍 Verifying required secrets are configured..."
  echo ""
  
  MISSING_SECRETS=()
  
  # Get list of configured secrets (format: NAME    DIGEST)
  CONFIGURED_SECRETS=$(fly secrets list --app "$APP_NAME" 2>/dev/null | awk 'NR>1 {print $1}' || echo "")
  
  # Check required secrets
  for secret in "${REQUIRED_SECRETS[@]}"; do
    if echo "$CONFIGURED_SECRETS" | grep -q "^${secret}$"; then
      echo "✅ $secret is configured"
    else
      MISSING_SECRETS+=("$secret")
      echo "❌ Missing required secret: $secret"
    fi
  done
  
  # Check recommended secrets
  echo ""
  echo "📋 Checking recommended secrets..."
  for secret in "${RECOMMENDED_SECRETS[@]}"; do
    if echo "$CONFIGURED_SECRETS" | grep -q "^${secret}$"; then
      echo "✅ $secret is configured"
    else
      echo "⚠️  Recommended secret not configured: $secret"
    fi
  done
  
  # If missing required secrets, try to read from .env file
  if [ ${#MISSING_SECRETS[@]} -gt 0 ]; then
    echo ""
    ENV_FILE_FOUND=$(find_env_file)
    
    if [ -n "$ENV_FILE_FOUND" ]; then
      echo "📄 Found .env file: $ENV_FILE_FOUND"
      echo "🔍 Attempting to read missing secrets from .env file..."
      echo ""
      
      SECRETS_TO_SET=()
      STILL_MISSING=()
      
      for secret in "${MISSING_SECRETS[@]}"; do
        value=$(read_env_var "$secret" "$ENV_FILE_FOUND")
        if [ -n "$value" ]; then
          SECRETS_TO_SET+=("${secret}=${value}")
          echo "   ✅ Found $secret in $ENV_FILE_FOUND"
        else
          STILL_MISSING+=("$secret")
          echo "   ❌ $secret not found in $ENV_FILE_FOUND"
        fi
      done
      
      # Set secrets found in .env file
      if [ ${#SECRETS_TO_SET[@]} -gt 0 ]; then
        echo ""
        echo "🔧 Configuring secrets in Fly.io..."
        for secret_pair in "${SECRETS_TO_SET[@]}"; do
          secret_name=$(echo "$secret_pair" | cut -d'=' -f1)
          # Extract value (everything after the first =)
          secret_value="${secret_pair#${secret_name}=}"
          echo "   ✓ Setting $secret_name..."
          
          # Capture output to check for errors
          output_file=$(mktemp)
          exit_code=0
          
          # Use timeout to prevent hanging (30 seconds should be enough)
          if command -v timeout >/dev/null 2>&1; then
            timeout 30 fly secrets set "${secret_name}=${secret_value}" --app "$APP_NAME" > "$output_file" 2>&1 || exit_code=$?
          else
            # Fallback if timeout is not available
            fly secrets set "${secret_name}=${secret_value}" --app "$APP_NAME" > "$output_file" 2>&1 || exit_code=$?
          fi
          
          if [ $exit_code -ne 0 ]; then
            echo "   ❌ Failed to set $secret_name (exit code: $exit_code)"
            echo "   Error output:"
            cat "$output_file" 2>/dev/null || true
            rm -f "$output_file"
            exit 1
          fi
          rm -f "$output_file"
        done
        echo "✅ Secrets configured successfully"
        echo ""
        
        # Re-check if all required secrets are now configured
        CONFIGURED_SECRETS=$(fly secrets list --app "$APP_NAME" 2>/dev/null | awk 'NR>1 {print $1}' || echo "")
        STILL_MISSING=()
        for secret in "${REQUIRED_SECRETS[@]}"; do
          if ! echo "$CONFIGURED_SECRETS" | grep -q "^${secret}$"; then
            STILL_MISSING+=("$secret")
          fi
        done
      fi
      
      # If still missing, show error
      if [ ${#STILL_MISSING[@]} -gt 0 ]; then
        echo ""
        echo "❌ Still missing required secrets:"
        echo ""
        for secret in "${STILL_MISSING[@]}"; do
          case "$secret" in
            "DATABASE_URL")
              echo "   $secret:"
              echo "      Add to $ENV_FILE_FOUND: DATABASE_URL=\"postgresql://...\""
              echo "      Or set manually: fly secrets set DATABASE_URL=\"postgresql://...\" --app $APP_NAME"
              echo "      💡 See SETUP_SUPABASE.md for instructions"
              ;;
            *)
              echo "   $secret:"
              echo "      Add to $ENV_FILE_FOUND: $secret=\"value\""
              echo "      Or set manually: fly secrets set $secret=\"value\" --app $APP_NAME"
              ;;
          esac
        done
        echo ""
        exit 1
      fi
    else
      # No .env file found, show manual instructions
      echo "❌ Missing required secrets. Please configure them before deploying:"
      echo ""
      for secret in "${MISSING_SECRETS[@]}"; do
        case "$secret" in
          "DATABASE_URL")
            echo "   $secret:"
            echo "      Option 1: Create .env.prod or .env.fly with: DATABASE_URL=\"postgresql://...\""
            echo "      Option 2: fly secrets set DATABASE_URL=\"postgresql://...\" --app $APP_NAME"
            echo "      💡 See SETUP_SUPABASE.md for instructions"
            ;;
          *)
            echo "   $secret:"
            echo "      Option 1: Create .env.prod or .env.fly with: $secret=\"value\""
            echo "      Option 2: fly secrets set $secret=\"value\" --app $APP_NAME"
            ;;
        esac
      done
      echo ""
      echo "💡 Alternative: Use fly-secrets-import.sh to import from .env file:"
      echo "   ./fly-secrets-import.sh $APP_NAME"
      echo ""
      echo "💡 Or skip checks (not recommended):"
      echo "   ./deploy-be.sh --skip-checks"
      echo ""
      exit 1
    fi
  fi
  
  echo ""
  echo "✅ All required secrets are configured"
  echo ""
fi

# Show current secrets (without values for security)
echo "📋 Current secrets (keys only):"
fly secrets list --app "$APP_NAME" 2>/dev/null | awk 'NR>1 {print "   ✓ " $1}' || echo "   (No secrets found)"
echo ""

# Deploy
echo "📦 Starting deployment..."
echo "   Using remote builder for faster builds..."
# Context in fly-be.toml is set to "..", dockerfile is "be/Dockerfile" relative to project root
# --remote-only: Use Fly.io's remote builder (faster than local)
# --build-only: Build image without deploying (useful for testing)
# --no-cache: Force rebuild without cache (use only if needed)
fly deploy --config "$CONFIG_FILE" --app "$APP_NAME" --remote-only

echo ""
echo "✅ Deploy completed!"
echo ""
echo "💡 Useful commands:"
echo "   fly logs --app $APP_NAME          # View logs"
echo "   fly status --app $APP_NAME        # Check status"
echo "   fly ssh console --app $APP_NAME  # SSH into container"
echo ""

