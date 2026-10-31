#!/bin/sh
set -eu
ollama serve &
server_pid=$!
trap 'kill -TERM "$server_pid" 2>/dev/null || true' TERM INT
# Bounded startup, followed by a model download into the persistent volume.
attempt=0
until ollama list >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    kill -TERM "$server_pid" 2>/dev/null || true
    exit 1
  fi
  sleep 1
done
if ! ollama show nomic-embed-text:v1.5 >/dev/null 2>&1; then
  if ! ollama pull nomic-embed-text:v1.5; then
    kill -TERM "$server_pid" 2>/dev/null || true
    exit 1
  fi
fi
# Application checks the approved model digest before accepting embeddings.
wait "$server_pid"
