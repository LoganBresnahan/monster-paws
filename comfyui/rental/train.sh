#!/usr/bin/env bash
# Runs ON the rented droplet, detached, logging to /root/train.log (scripts/gpu-rental.sh train <pairs> <out> <name>).
# The pairs are in /root/pairs; checkpoints, samples and the job's config land in /root/train-out/<name>.
set -euo pipefail
NAME=$1
step() { echo "== $*"; }
trap 'echo "== FAILED at line $LINENO"' ERR
source "$(dirname "$0")/docker.sh"
step "building monster-paws-ai-toolkit"
DOCKER_BUILDKIT=1 docker build --progress=plain -t monster-paws-ai-toolkit -f /root/mp/comfyui/rental/ai-toolkit.Dockerfile /root/mp/comfyui/rental
step "fetching and verifying the training weights (~16 GB)"
MODELS_MANIFEST=/root/mp/comfyui/models-training.manifest python3 /root/mp/comfyui/models.py fetch /root/train-models
mkdir -p /root/train-out
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
step "training $NAME"
# The progress bar redraws with \r; as newlines, once a minute, the polled log stays readable.
docker run --rm --gpus all --shm-size 16g -e HF_HUB_OFFLINE=1 -e TQDM_MININTERVAL=60 \
  -v /root/mp/comfyui/rental:/mp:ro -v /root/pairs:/pairs -v /root/train-models:/models:ro -v /root/train-out:/out \
  monster-paws-ai-toolkit python3 /mp/train.py "$NAME" 2>&1 | stdbuf -oL tr '\r' '\n'
step "DONE $(ls /root/train-out/"$NAME"/*.safetensors | wc -l) checkpoints"
