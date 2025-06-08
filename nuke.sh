#!/bin/bash

echo "🧨 Stopping all containers..."
docker compose down

echo "🗑️ Removing all containers, networks, and volumes..."
docker compose down -v

echo "🧹 Cleaning up Docker system..."
docker system prune -af --volumes

echo "📁 Removing node_modules from host..."
rm -rf be/node_modules
rm -rf fe/node_modules

echo "🗂️ Removing build directories..."
rm -rf be/.next
rm -rf fe/.next
rm -rf .turbo
rm -rf be/dist
rm -rf fe/dist

echo "🧽 Removing temporary files..."
rm -rf be/tmp
rm -rf fe/tmp

echo "🚀 Environment nuked successfully!"
echo "💡 To start fresh, run: docker compose up --build"