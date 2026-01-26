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

if [ "$TARGET" == "ios" ]; then
    # --no-bundler prevents starting the metro server locally, so we can use the Docker one
    npx expo run:ios --configuration Debug --no-bundler
elif [ "$TARGET" == "android" ]; then
    npx expo run:android --variant debug --no-bundler
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
docker-compose up --build
