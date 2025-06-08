#!/bin/bash

echo "🚀 Setting up ZigZag project..."

# Stop any running containers
echo "Stopping existing containers..."
docker-compose down

# Remove old volumes if needed (optional - uncomment if you want fresh start)
# docker-compose down -v

# Build and start only MongoDB first
echo "Starting MongoDB..."
docker-compose up -d mongodb

# Wait for MongoDB to be ready
echo "Waiting for MongoDB to initialize..."
sleep 30

# Check MongoDB status
docker-compose logs mongodb | tail -20

# Now start the rest
echo "Starting remaining services..."
docker-compose up -d

echo "✅ Setup complete! Check logs with: docker-compose logs -f" 