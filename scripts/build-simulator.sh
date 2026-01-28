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

echo "Stopping any running containers to free ports..."
docker-compose down


cd fe

echo "Checking dependencies..."
if [ ! -d "node_modules" ]; then
    echo "Installing Javascript dependencies..."
    yarn install
else
    echo "Dependencies already installed. Skipping yarn install."
fi

echo "Checking native projects..."
# If clean build is desired or directories missing, run prebuild
if [ ! -d "ios" ] && [ "$TARGET" == "ios" ]; then
    echo "iOS directory missing. Running prebuild..."
    npx expo prebuild --platform ios
elif [ ! -d "android" ] && [ "$TARGET" == "android" ]; then
    echo "Android directory missing. Running prebuild..."
    npx expo prebuild --platform android
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
echo " Now running docker-compose up to start the server..."
echo "========================================"

cd ..
docker-compose --profile dev up --build
