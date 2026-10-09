# Headless ComfyUI for keepsake art (ADR-0004 as amended 2026-10-05, ADR-0007
# as amended). One image, two GPU targets: TORCH=xpu runs on the Intel Arc at
# home; TORCH=cu128 is the CUDA variant any hosted escape hatch would take.
# Models are never baked in — they are a volume, verified against the
# committed hash list (ADR-0004 §1: the licence record travels with the hash).
FROM ubuntu:24.04
ARG TORCH=xpu
# ComfyUI v0.38.0 — bump the sha and the tag together.
ARG COMFYUI_SHA=6b747c0428c343e1417219641db93a4fb7cb69ae
# Custom nodes are pinned by sha and baked into the image, never fetched by a
# manager at runtime (ADR-0004 decision 1): cubiq/ComfyUI_IPAdapter_plus,
# GPL-3.0, no CUDA-only kernels. Add a node = add an ARG and a clone here.
ARG IPADAPTER_PLUS_SHA=a0f451a5113cf9becb0847b92884cb10cbdec0ef
# Intel's compute runtime, from its GitHub releases — the apt channel lags
# by a year and a runtime older than the Windows host driver returns garbage
# for every copy without an error (25.18 against driver 101.8992, 2026-10-07;
# 26.35 is what Intel tested WSL with on that driver). Bump the four together;
# the loader must be newer than the runtime or torch segfaults in zeInit.
ARG INTEL_RUNTIME=26.35.39758.10
ARG INTEL_IGC=2.41.5+22716
ARG INTEL_IGC_TAG=v2.41.5
ARG INTEL_GMM=22.10.0
ARG LEVEL_ZERO=1.34.0
ARG TORCH_VERSION=2.14.1
ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git python3 python3-venv clinfo ocl-icd-libopencl1 \
 && if [ "$TORCH" = "xpu" ]; then \
      cd /tmp \
   && CR=https://github.com/intel/compute-runtime/releases/download/$INTEL_RUNTIME \
   && IGC=https://github.com/intel/intel-graphics-compiler/releases/download/$INTEL_IGC_TAG \
   && curl -fsSLO $CR/libze-intel-gpu1_${INTEL_RUNTIME}-0_amd64.deb \
   && curl -fsSLO $CR/intel-opencl-icd_${INTEL_RUNTIME}-0_amd64.deb \
   && curl -fsSLO $CR/libigdgmm12_${INTEL_GMM}_amd64.deb \
   && curl -fsSLO $IGC/intel-igc-core-2_${INTEL_IGC}_amd64.deb \
   && curl -fsSLO $IGC/intel-igc-opencl-2_${INTEL_IGC}_amd64.deb \
   && curl -fsSLo libze1.deb "https://github.com/oneapi-src/level-zero/releases/download/v$LEVEL_ZERO/libze1_${LEVEL_ZERO}%2Bu24.04_amd64.deb" \
   && dpkg -i *.deb && rm -f *.deb ; \
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
RUN git clone --filter=blob:none https://github.com/cubiq/ComfyUI_IPAdapter_plus.git ComfyUI/custom_nodes/ComfyUI_IPAdapter_plus \
 && git -C ComfyUI/custom_nodes/ComfyUI_IPAdapter_plus checkout --detach $IPADAPTER_PLUS_SHA
COPY --chown=comfy:comfy smoke.py models.py models.manifest entrypoint.sh /home/comfy/
COPY --chown=comfy:comfy custom_nodes/monsterpaws_xpu /home/comfy/ComfyUI/custom_nodes/monsterpaws_xpu

# The WSL2 host driver mirror must be bind-mounted at /usr/lib/wsl (both
# `lib` AND `drivers`; `lib` alone finds no GPU) and /dev/dxg passed through —
# see comfyui/compose.yml. On a real Linux host neither applies.
ENV LD_LIBRARY_PATH=/usr/lib/wsl/lib
# Level Zero caps a single allocation at 1 GiB on the A770 and reports it as
# "out of memory" with 15 GiB free; SDXL's attention buffers at 1024² exceed
# it. The relaxed limit allocates up to the card (6 GiB verified 2026-10-07).
ENV UR_L0_ENABLE_RELAXED_ALLOCATION_LIMITS=1
# Never let ComfyUI empty PyTorch's cache between prompts: under WSL2 the
# driver retains every freed allocation, so the churn fills VRAM with dead
# blocks and then ~2 GB of host memory per image until the box freezes
# (2026-10-08; custom_nodes/monsterpaws_xpu). =0 only for an experiment.
ENV MONSTERPAWS_KEEP_XPU_CACHE=1
WORKDIR /home/comfy/ComfyUI
EXPOSE 8188
CMD ["/home/comfy/entrypoint.sh"]
