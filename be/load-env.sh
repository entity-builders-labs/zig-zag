#!/bin/bash
# Load .env from monorepo root
if [ -f "../.env" ]; then
  export $(cat ../.env | grep -v '^#' | grep MONGODB_URI | xargs)
fi
