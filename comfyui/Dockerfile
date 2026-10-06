# Headless ComfyUI for keepsake art (ADR-0004 as amended 2026-10-05, ADR-0007
# as amended). One image, two GPU targets: TORCH=xpu runs on the Intel Arc at
# home; TORCH=cu128 is the CUDA variant any hosted escape hatch would take.
# Models are never baked in — they are a volume, verified against the
# committed hash list (ADR-0004 §1: the licence record travels with the hash).
FROM ubuntu:24.04
ARG TORCH=xpu
# ComfyUI v0.38.0 — bump the sha and the tag together.
ARG COMFYUI_SHA=6b747c0428c343e1417219641db93a4fb7cb69ae
# Intel's `noble unified` channel. Never below 25.x: 24.39 (the `client`
# channel's pin) segfaults in zeInit under WSL2, verified 2026-10-05.
ARG INTEL_RUNTIME=25.18.33578.15-1146~24.04
ARG TORCH_VERSION=2.14.1
ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git python3 python3-venv \
 && if [ "$TORCH" = "xpu" ]; then \
      curl -fsSL https://repositories.intel.com/gpu/intel-graphics.key \
        | gpg --dearmor -o /usr/share/keyrings/intel-graphics.gpg \
   && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/intel-graphics.gpg] https://repositories.intel.com/gpu/ubuntu noble unified" \
        > /etc/apt/sources.list.d/intel-gpu.list \
   && apt-get update && apt-get install -y --no-install-recommends \
        libze-intel-gpu1=$INTEL_RUNTIME intel-opencl-icd=$INTEL_RUNTIME libze1 clinfo ; \
    fi \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 --shell /bin/bash comfy 2>/dev/null \
 || usermod --login comfy --home /home/comfy --move-home ubuntu
USER comfy
WORKDIR /home/comfy
RUN python3 -m venv venv
ENV PATH=/home/comfy/venv/bin:$PATH
RUN pip install torch==$TORCH_VERSION torchvision torchaudio --index-url https://download.pytorch.org/whl/$TORCH

RUN git clone --filter=blob:none https://github.com/Comfy-Org/ComfyUI.git ComfyUI \
 && cd ComfyUI && git checkout --detach $COMFYUI_SHA \
 && pip install -r requirements.txt \
 && mkdir -p models input output user temp
COPY --chown=comfy:comfy smoke.py /home/comfy/smoke.py

# The WSL2 host driver mirror must be bind-mounted at /usr/lib/wsl (both
# `lib` AND `drivers`; `lib` alone finds no GPU) and /dev/dxg passed through —
# see comfyui/compose.yml. On a real Linux host neither applies.
ENV LD_LIBRARY_PATH=/usr/lib/wsl/lib
WORKDIR /home/comfy/ComfyUI
EXPOSE 8188
CMD ["python", "main.py", "--listen", "0.0.0.0", "--port", "8188"]
