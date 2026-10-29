# Sourced ON the rented droplet by serve.sh and train.sh: docker that can reach the GPU and build with BuildKit.
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
