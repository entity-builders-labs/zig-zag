# Use Node.js LTS version
FROM node:20-alpine

# Install 'yes' command for auto-answering prompts
RUN apk add --no-cache coreutils

# Build argument to specify build target
# Options: ios (default), dev, web
ARG BUILD_TARGET=ios

# Set working directory
WORKDIR /app

# Copy only package files first (for better caching)
COPY package.json yarn.lock ./
COPY fe/package.json ./fe/

# Install dependencies
RUN yarn install --frozen-lockfile --production=false

# Install Expo CLI and ngrok globally (required for tunnels)
# Ensure ngrok is in the PATH for Expo to detect it
RUN yarn global add @expo/cli @expo/ngrok && \
    yarn global bin > /tmp/global_bin && \
    export PATH="$(cat /tmp/global_bin):$PATH" && \
    which expo-ngrok || echo "ngrok will be installed on first run"

# Copy only necessary frontend files
COPY fe/ ./fe/

# Install @expo/ngrok locally so Expo can detect it (prevents interactive prompt)
# RUN cd fe && yarn add -D @expo/ngrok@^4.1.0 || true

# Remove unnecessary files (only for dev and web targets)
RUN if [ "$BUILD_TARGET" != "ios" ]; then \
      rm -rf fe/ios/build fe/ios/Pods fe/android/build fe/android/.gradle || true; \
    fi

# Expose the ports the app runs on
EXPOSE 8082 8081 19000 19001 19002

# Set environment variables for hot reload
ENV WATCHPACK_POLLING=true
ENV CHOKIDAR_USEPOLLING=true
ENV CHOKIDAR_INTERVAL=1000
ENV FAST_REFRESH=true
ENV EXPO_USE_FAST_REFRESH=true
ENV EXPO_DEVTOOLS_LISTEN_ADDRESS=0.0.0.0
# REACT_NATIVE_PACKAGER_HOSTNAME should be set via env var for LAN mode, or defaults to auto-detected (which usually fails in docker without override)
# ENV REACT_NATIVE_PACKAGER_HOSTNAME=0.0.0.0
# Force Expo to show QR code and URLs
ENV EXPO_NO_TELEMETRY=1
ENV CI=false
ENV FORCE_COLOR=1
ENV EXPO_NO_DOTENV=1
# Auto-accept prompts (for ngrok installation)
ENV EXPO_NO_GIT_STATUS=1

# Create entrypoint script for conditional execution
RUN echo '#!/bin/sh' > /app/entrypoint.sh && \
    echo 'set -e' >> /app/entrypoint.sh && \
    echo 'cd /app' >> /app/entrypoint.sh && \
    echo 'case "$BUILD_TARGET" in' >> /app/entrypoint.sh && \
    echo '  dev)' >> /app/entrypoint.sh && \
    echo '    exec yarn workspace fe start --web --tunnel' >> /app/entrypoint.sh && \
    echo '    ;;' >> /app/entrypoint.sh && \
    echo '  web)' >> /app/entrypoint.sh && \
    echo '    exec yarn workspace fe start --dev-client --web' >> /app/entrypoint.sh && \
    echo '    ;;' >> /app/entrypoint.sh && \
    echo '  ios)' >> /app/entrypoint.sh && \
    echo '    cd fe' >> /app/entrypoint.sh && \
    echo '    echo "Starting Expo development server for iOS (Tunnel)..."' >> /app/entrypoint.sh && \
    echo '    echo "Scan the QR code with your iOS device to connect"' >> /app/entrypoint.sh && \
    echo '    export PATH="$(yarn global bin):$PATH"' >> /app/entrypoint.sh && \
    echo '    exec npx expo start --dev-client --tunnel' >> /app/entrypoint.sh && \
    echo '    ;;' >> /app/entrypoint.sh && \
    echo '  lan)' >> /app/entrypoint.sh && \
    echo '    cd fe' >> /app/entrypoint.sh && \
    echo '    echo "Starting Expo development server for LAN..."' >> /app/entrypoint.sh && \
    echo '    echo "Using Hostname: $REACT_NATIVE_PACKAGER_HOSTNAME"' >> /app/entrypoint.sh && \
    echo '    export PATH="$(yarn global bin):$PATH"' >> /app/entrypoint.sh && \
    echo '    # We use --dev-client. The hostname is set via env var.' >> /app/entrypoint.sh && \

    echo '    # --host lan forces binding to the network interface (accessible from host)' >> /app/entrypoint.sh && \
    echo '    exec npx expo start --dev-client --port 8082 --host lan' >> /app/entrypoint.sh && \
    echo '    ;;' >> /app/entrypoint.sh && \
    echo '  *)' >> /app/entrypoint.sh && \
    echo '    echo "Unknown BUILD_TARGET: $BUILD_TARGET"' >> /app/entrypoint.sh && \
    echo '    echo "Valid options: dev, web, ios, lan"' >> /app/entrypoint.sh && \
    echo '    exit 1' >> /app/entrypoint.sh && \
    echo '    ;;' >> /app/entrypoint.sh && \
    echo 'esac' >> /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh

# Set build target as environment variable for entrypoint
ENV BUILD_TARGET=${BUILD_TARGET}

# Use entrypoint script
ENTRYPOINT ["/app/entrypoint.sh"]