#!/usr/bin/env bash
# Runs ON the rented droplet, detached, logging to /root/clean.log (scripts/gpu-rental.sh clean).
# Qwen-Image-Edit over every PNG in /root/in with the one fixed instruction in /root/instruction.txt; resumable.
set -euo pipefail
mkdir -p /root/results
for f in /root/in/*.png; do
  name=$(basename "$f" .png)
  [ -f "/root/results/$name.png" ] && continue
  saved=$(python3 /root/mp/comfyui/run_workflow.py /root/mp/comfyui/workflows/qwen-edit-v1.api.json \
    --image "$f" --seed 0 --prompt "$(cat /root/instruction.txt)" | grep '^output/' | tail -1)
  cp "/root/out/${saved#output/}" "/root/results/$name.png"
  echo "cleaned $name"
done
echo "== DONE $(ls /root/results/*.png | wc -l)"
