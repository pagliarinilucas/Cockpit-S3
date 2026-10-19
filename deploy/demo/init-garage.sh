#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Lucas Pagliarini
set -eu

cd "$(dirname "$0")"

DEMO_BUCKETS="acme-contracts marketing-assets finance-reports"
KEY_NAME="${KEY_NAME:-demo-key}"
CAPACITY="${GARAGE_CAPACITY:-1G}"

garage() {
  docker compose exec -T garage /garage "$@"
}

node_id="$(garage node id -q | cut -d@ -f1)"
echo "Garage node: $node_id"

garage layout assign -z dc1 -c "$CAPACITY" "$node_id"
garage layout apply --version 1

key_output="$(garage key create "$KEY_NAME")"
printf '%s\n' "$key_output"

for bucket in $DEMO_BUCKETS; do
  garage bucket create "$bucket"
  garage bucket allow --read --write --owner "$bucket" --key "$KEY_NAME"
done

key_id="$(printf '%s\n' "$key_output" | awk -F': *' '/Key ID/ { print $2; exit }')"
secret_key="$(printf '%s\n' "$key_output" | awk -F': *' '/Secret key/ { print $2; exit }')"

echo
echo "Put these two lines in .env, then run: docker compose up -d cockpit-s3"
echo "DEMO_S3_ACCESS_KEY=${key_id:-<copy the Key ID printed above>}"
echo "DEMO_S3_SECRET_KEY=${secret_key:-<copy the Secret key printed above>}"
