#!/usr/bin/env bash
# Copy the gridseer-data bucket to ./data for local testing (the site reads ./data on localhost).
set -euo pipefail
cd "$(dirname "$0")/.."
gcloud storage rsync -r gs://gridseer-data data
