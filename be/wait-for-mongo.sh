#!/bin/sh
set -e

host="$1"
shift
cmd="$@"

until mongosh --host $host --eval "db.runCommand('ping').ok" > /dev/null 2>&1; do
  >&2 echo "MongoDB is unavailable - sleeping"
  sleep 1
done

>&2 echo "MongoDB is up - executing command"
exec $cmd