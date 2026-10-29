# ai-toolkit (MIT), pinned by commit, for the anatomy LoRA's training on the GPU rental only
# (ADR-0004 as amended 2026-10-22; doc/infra.md, GPU rental). Built on the droplet by train.sh, never at home.
# The runtime base and torch are those of ai-toolkit's own docker/Dockerfile at this commit: change the
# commit and re-read them together, as the Arc image's four pins move together.
FROM nvidia/cuda:13.0.3-runtime-ubuntu24.04
ENV DEBIAN_FRONTEND=noninteractive PIP_BREAK_SYSTEM_PACKAGES=1 PIP_NO_CACHE_DIR=1
# gcc and the Python headers: Triton compiles its CUDA launcher at first use (2026-10-23); libgl for opencv.
RUN apt-get update && apt-get install -y --no-install-recommends git python3 python3-pip python3-dev gcc g++ libc6-dev libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install torch==2.13.0 torchvision==0.28.0 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cu130
ARG AITK_COMMIT=b69b98314557f7c8b08e11bbb14e48d959e6ab26
RUN git clone https://github.com/ostris/ai-toolkit.git /aitk && git -C /aitk checkout --detach "$AITK_COMMIT"
# Not their Dockerfile's setuptools 69.5.1 downgrade: torch and their own requirements_base.txt ask for >=77.0.3.
RUN pip install -r /aitk/requirements.txt
WORKDIR /aitk
