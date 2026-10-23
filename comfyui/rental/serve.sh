#!/usr/bin/env bash
# Runs ON the rented droplet, detached, logging to /root/serve.log (scripts/gpu-rental.sh serve).
# Detached because a long ssh session that drops kills its children and leaves the caller waiting (2026-10-23).
set -euo pipefail
TORCH=$1
step() { echo "== $*"; }
if ! docker run --rm --gpus all ubuntu:24.04 true 2>/dev/null; then
  step "installing the NVIDIA container toolkit"
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#' \
    > /etc/apt/sources.list.d/nvidia-container-toolkit.list
  apt-get update -q && apt-get install -yq nvidia-container-toolkit && nvidia-ctk runtime configure --runtime=docker && systemctl restart docker
fi
# BuildKit, as at home: the legacy builder cannot resolve the Dockerfile's `comfy:comfy` chown, since the
# renamed `ubuntu` user keeps its own group (2026-10-23).
if ! docker buildx version >/dev/null 2>&1; then
  step "installing docker-buildx"
  apt-get update -q && apt-get install -yq docker-buildx
fi
step "building monster-paws-comfyui:rental (TORCH=$TORCH)"
DOCKER_BUILDKIT=1 docker build --progress=plain --build-arg TORCH="$TORCH" -t monster-paws-comfyui:rental /root/mp/comfyui
# Triton compiles its CUDA launcher at first use and needs a C compiler and Python headers the Arc build never did (2026-10-23);
# a rental-only layer, so the home image and its four pinned runtimes are untouched.
printf 'FROM monster-paws-comfyui:rental\nUSER root\nRUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev python3-dev && rm -rf /var/lib/apt/lists/*\nUSER comfy\n' \
  | DOCKER_BUILDKIT=1 docker build --progress=plain -t monster-paws-comfyui:rental -
mkdir -p /root/models /root/out && chown 1000:1000 /root/models /root/out
step "smoke"
docker run --rm --gpus all --entrypoint python monster-paws-comfyui:rental /home/comfy/smoke.py
docker rm -f comfy >/dev/null 2>&1 || true
docker run -d --name comfy --gpus all -p 127.0.0.1:8188:8188 \
  -e MODELS_MANIFEST=/home/comfy/rental.manifest -e MONSTERPAWS_KEEP_XPU_CACHE=0 \
  -v /root/mp/comfyui/models-rental.manifest:/home/comfy/rental.manifest:ro \
  -v /root/models:/home/comfy/ComfyUI/models -v /root/out:/home/comfy/ComfyUI/output \
  monster-paws-comfyui:rental
step "fetching and verifying the rental models (~58 GB), then serving"
until curl -sf http://127.0.0.1:8188/system_stats >/dev/null; do
  docker ps -q -f name=comfy | grep -q . || { docker logs --tail 40 comfy; echo "== FAILED: ComfyUI exited"; exit 1; }
  sleep 10
done
step "SERVING"
