#!/bin/sh
set -e

host="$1"
shift
cmd="$@"

echo "Waiting for MongoDB at $host:27017..."

# Wait for MongoDB port to be available
attempt=1
max_attempts=60

until nc -z $host 27017; do
  >&2 echo "MongoDB is unavailable (attempt $attempt/$max_attempts) - sleeping"
  
  if [ $attempt -eq $max_attempts ]; then
    >&2 echo "Failed to connect to MongoDB after $max_attempts attempts"
    exit 1
  fi
  
  sleep 3
  attempt=$((attempt + 1))
done

>&2 echo "MongoDB port is available - waiting a bit more for replica set to be ready..."
sleep 10

>&2 echo "Starting application..."
exec $cmd