#!/bin/bash

echo "=== Docker Network Debug ==="

echo "1. Container status:"
docker-compose ps

echo "2. Networks:"
docker network ls

echo "3. Network details:"
docker network inspect zig-zag_app-network 2>/dev/null || echo "Network not found"

echo "4. MongoDB container details:"
docker inspect zigzag-mongodb 2>/dev/null | grep -A 10 "NetworkSettings" || echo "MongoDB container not found"

echo "5. Backend container details:"
docker inspect zigzag-backend 2>/dev/null | grep -A 10 "NetworkSettings" || echo "Backend container not found"

echo "6. Test connectivity from backend to mongodb:"
docker-compose exec backend nslookup mongodb 2>/dev/null || echo "DNS resolution failed"
docker-compose exec backend ping -c 1 mongodb 2>/dev/null || echo "Ping failed" 