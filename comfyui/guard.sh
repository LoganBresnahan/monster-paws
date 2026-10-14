#!/usr/bin/env bash
# The home GPU's watchdog (doc/infra.md, Home GPU). The per-prompt cache
# flush leaked Windows host memory through the driver's shared pool and
# froze the box in 2026-10-07, so nothing drives the Arc except through
# this: it kills ComfyUI the moment the shared pool passes SHARED_MAX_GB
# (the leak's signature, outside the WSL cap) or Windows free memory drops
# below FLOOR_GB, and restarts it between chunks. The WSL VM filling to its
# .wslconfig cap is bounded and is not what this guards against.
#
#   comfyui/guard.sh mem                      host free, driver shared pool, dedicated, descriptors
#   comfyui/guard.sh drop                     return the VM's file cache to Windows (root via wsl.exe)
#   comfyui/guard.sh up [--gpu-only ...]      fresh ComfyUI (flags via COMFY_ARGS, env via GPU_ENV="K=V ..."), waits until it serves
#   comfyui/guard.sh down
#   comfyui/guard.sh watch                    foreground loop: kills ComfyUI if shared pool > SHARED_MAX_GB or host free < FLOOR_GB
#   comfyui/guard.sh batch <batch> [chunk] [server flags...]   explore.py in chunks, ComfyUI restarted between them
set -euo pipefail
cd "$(dirname "$0")/.."
FLOOR_GB=${FLOOR_GB:-10}
SHARED_MAX_GB=${SHARED_MAX_GB:-4}
COMPOSE="docker compose -f comfyui/compose.yml"

host_free_gb() {
  powershell.exe -NoProfile -Command '[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)' 2>/dev/null | tr -d '\r'
}
shared_gb() {
  powershell.exe -NoProfile -Command '$s=(Get-Counter "\GPU Adapter Memory(*)\Shared Usage").CounterSamples; [math]::Round(($s | Measure-Object CookedValue -Sum).Sum/1GB,1)' 2>/dev/null | tr -d '\r'
}
dedicated_gb() {
  powershell.exe -NoProfile -Command '$s=(Get-Counter "\GPU Adapter Memory(*)\Dedicated Usage").CounterSamples; [math]::Round(($s | Measure-Object CookedValue -Sum).Sum/1GB,1)' 2>/dev/null | tr -d '\r'
}
fds() {
  local c; c=$(docker ps -q --filter name=comfyui-comfyui-1)
  [ -n "$c" ] && docker exec "$c" sh -c 'ls /proc/1/fd | wc -l' || echo -
}
mem() { printf 'host_free=%sGB shared=%sGB dedicated=%sGB fds=%s\n' "$(host_free_gb)" "$(shared_gb)" "$(dedicated_gb)" "$(fds)"; }

# Every ComfyUI start drops the VM's file cache first: with autoMemoryReclaim off the VM keeps
# every model file it has read until it sits at its cap, and the floor then trips during the
# next load's spike outside the VM (2026-10-14, doc/infra.md Home GPU). Never skip it before a load.
drop() {
  local cached before now
  cached=$(awk '/^Cached:/{printf "%.1f", $2/1048576}' /proc/meminfo)
  before=$(host_free_gb)
  if ! wsl.exe -d "${WSL_DISTRO_NAME:-monsterpaws-dev}" -u root -e sh -c 'sync; echo 1 > /proc/sys/vm/drop_caches' 2>/dev/null; then
    echo "guard: could not drop the VM's file cache (no interop?) — continuing with the floor alone" >&2; return 0
  fi
  # Windows gets the pages back over ~10–40 s, not at once: wait only while a load would start near the floor
  for _ in $(seq 1 12); do
    now=$(host_free_gb)
    awk -v n="$now" -v f="$FLOOR_GB" 'BEGIN{exit !(n >= f + 10)}' && break
    sleep 5
  done
  echo "guard: dropped ${cached} GB of file cache; Windows free ${before} → $(host_free_gb) GB"
}

below_floor() { awk -v f="$(host_free_gb)" -v m="$FLOOR_GB" 'BEGIN{exit !(f+0 < m+0)}'; }
pool_over() { awk -v s="$(shared_gb)" -v m="$SHARED_MAX_GB" 'BEGIN{exit !(s+0 > m+0)}'; }

down() { $COMPOSE stop comfyui >/dev/null 2>&1 || true; $COMPOSE rm -f comfyui >/dev/null 2>&1 || true; }

up() {
  drop
  if below_floor; then echo "guard: host free $(host_free_gb) GB < floor $FLOOR_GB GB — refusing to start" >&2; exit 3; fi
  down
  npm run -s comfy:dirs
  printf '%s\n' ${GPU_ENV:-} > comfyui/gpu.env
  COMFY_ARGS="$*" $COMPOSE up -d comfyui >/dev/null
  for _ in $(seq 1 120); do
    if docker logs comfyui-comfyui-1 2>&1 | grep -q "To see the GUI"; then echo "guard: ComfyUI up${*:+ ($*)}"; return 0; fi
    if docker logs comfyui-comfyui-1 2>&1 | grep -q "refusing to serve\|Traceback"; then docker logs comfyui-comfyui-1 2>&1 | tail -5 >&2; exit 4; fi
    sleep 2
  done
  echo "guard: ComfyUI did not come up" >&2; exit 4
}

watch() {
  while true; do
    if below_floor || pool_over; then
      echo "guard: host free $(host_free_gb) GB (floor $FLOOR_GB), shared pool $(shared_gb) GB (max $SHARED_MAX_GB) — killing ComfyUI" >&2
      docker kill comfyui-comfyui-1 >/dev/null 2>&1 || true
      exit 5
    fi
    sleep 5
  done
}

batch() {
  local b=$1 chunk=${2:-8}; shift 2 || shift $#
  while true; do
    up "$@"
    watch & local w=$!
    local out; out=$(mktemp)
    set +e
    npm run -s explore -- run "$b" --limit "$chunk" 2>&1 | grep --line-buffered -v "^prep\|Container" | tee "$out"
    set -e
    kill $w 2>/dev/null || true
    down
    echo "guard: chunk finished, $(mem)"
    # the harness reports how many runs remain before it starts the chunk
    if grep -q " 0 to go" "$out"; then rm -f "$out"; break; fi
    # a chunk that produced nothing would be retried forever (the bf16 Z-Image cells, 2026-10-11): stop instead
    if ! grep -qE "^\[[0-9]+/[0-9]+\] .* [0-9.]+s$" "$out"; then echo "guard: chunk made no progress — stopping; fix the spec or the graph" >&2; rm -f "$out"; exit 6; fi
    rm -f "$out"
    if below_floor; then echo "guard: below floor after chunk — stopping" >&2; exit 3; fi
  done
}

case "${1:-}" in
  mem) mem ;;
  drop) drop; mem ;;
  up) shift; up "$@" ;;
  down) down ;;
  watch) watch ;;
  batch) shift; batch "$@" ;;
  *) sed -n 2,14p "$0"; exit 2 ;;
esac
