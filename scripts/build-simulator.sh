#!/bin/bash
set -e

# Default to iOS, allow override via argument
TARGET=${1:-ios}

echo "========================================"
echo " Zig-Zag Simulator Build Setup"
echo " Target: $TARGET"
echo "========================================"

# Check if we are in the root directory
if [ ! -d "fe" ]; then
    echo "Error: Please run this script from the project root."
    exit 1
fi

if [ ! -f ".env" ]; then
    echo "No .env file found. Creating from .env.example..."
    cp .env.example .env
    echo "Created .env — edit it with your API keys if needed."
fi

echo "Stopping any running containers to free ports..."
docker-compose down

echo "Starting backend services..."
docker-compose --profile dev up -d --build

echo "Waiting for backend on port 4000..."
for i in $(seq 1 60); do
    if curl -sf http://localhost:4000/health >/dev/null 2>&1; then
        echo "Backend is ready."
        break
    fi
    if [ "$i" -eq 60 ]; then
        echo "Warning: Backend did not respond on port 4000 after 2 minutes."
        echo "The app may show network errors until the backend is healthy."
    fi
    sleep 2
done


cd fe

echo "Checking dependencies..."
if [ ! -d "node_modules" ]; then
    echo "Installing Javascript dependencies..."
    yarn install
else
    echo "Dependencies already installed. Skipping yarn install."
fi

echo "Checking native projects..."
CONFIG_NEW_ARCH=$(node -p "require('./app.config.js').newArchEnabled !== false ? 'true' : 'false'")

if [ "$TARGET" == "ios" ]; then
    if [ ! -d "ios" ]; then
        echo "iOS directory missing. Running prebuild..."
        npx expo prebuild --platform ios
    else
        NATIVE_NEW_ARCH=$(node -p "try { require('./ios/Podfile.properties.json').newArchEnabled || 'false' } catch { 'false' }")
        if [ "$CONFIG_NEW_ARCH" != "$NATIVE_NEW_ARCH" ]; then
            echo "iOS native config out of sync (newArchEnabled: app=$CONFIG_NEW_ARCH, ios=$NATIVE_NEW_ARCH). Running prebuild..."
            npx expo prebuild --platform ios
        fi
    fi
elif [ "$TARGET" == "android" ]; then
    if [ ! -d "android" ]; then
        echo "Android directory missing. Running prebuild..."
        npx expo prebuild --platform android
    else
        NATIVE_NEW_ARCH=$(grep -E '^newArchEnabled=' android/gradle.properties 2>/dev/null | cut -d= -f2 || echo "false")
        if [ "$CONFIG_NEW_ARCH" != "$NATIVE_NEW_ARCH" ]; then
            echo "Android native config out of sync (newArchEnabled: app=$CONFIG_NEW_ARCH, android=$NATIVE_NEW_ARCH). Running prebuild..."
            npx expo prebuild --platform android
        fi
    fi
fi

echo "Building native app for Simulator (this may take a while)..."
echo "Note: This runs on your host machine to generate the simulator binary."

# Ensure ports are free for this build

echo "Cleaning up ports..."
for port in 8081 8088; do
    if lsof -ti:$port >/dev/null; then
        pid=$(lsof -ti:$port)
        echo "Port $port is in use by PID $pid. Process info:"
        ps -p $pid -o command=
        echo "Killing PID $pid..."
        kill -9 $pid
        echo "Port $port freed."
    fi
done

# Force Expo / Metro to use port 8088
export PORT=8088
export RCT_METRO_PORT=8088
export METRO_PORT=8088
export EXPO_DEV_CLIENT_NETWORK_INSPECTOR_PROXY_PORT=8088

if [ "$TARGET" == "ios" ]; then
    # --no-bundler prevents starting the metro server locally, so we can use the Docker one
    # We set RCT_METRO_PORT env var to ensure the app tries to connect to 8082
    RCT_METRO_PORT=8082 npx expo run:ios --configuration Debug --no-bundler
elif [ "$TARGET" == "android" ]; then
    RCT_METRO_PORT=8082 npx expo run:android --variant debug --no-bundler
else
    echo "Invalid target: $TARGET"
    exit 1
fi

echo "========================================"
echo " Build Complete!"
echo " The app should be installed on your $TARGET simulator."
echo " Backend and other services are running in Docker."
echo " Press Ctrl+C to stop Metro (Docker services keep running)."
echo "========================================"
