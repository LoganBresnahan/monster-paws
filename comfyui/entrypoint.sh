#!/bin/sh
# Models are a volume, filled from the manifest and verified before ComfyUI
# serves — a store that disagrees with the manifest never serves (ADR-0004
# decision 11).
set -e
python /home/comfy/models.py fetch
# COMFY_ARGS carries per-start server flags (comfyui/guard.sh sets it for the
# leak experiments); nothing else reads it.
exec python main.py --listen 0.0.0.0 --port 8188 $COMFY_ARGS "$@"
