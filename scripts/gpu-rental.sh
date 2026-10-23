#!/usr/bin/env bash
# A DigitalOcean GPU Droplet for one job, dev only (doc/infra.md, GPU rental;
# ADR-0004 as amended 2026-10-22). Never production, never a donation's art,
# never a shelter photo on the box: Commons dogs and the crew only.
#
#   scripts/gpu-rental.sh up                    create the droplet, then `serve`
#   scripts/gpu-rental.sh serve                 ship comfyui/, build it for CUDA, fill the rental models, serve (resumable)
#   scripts/gpu-rental.sh clean <in> <out>      Qwen-Image-Edit every PNG in <in>, results to <out>
#   scripts/gpu-rental.sh down                  delete every rental droplet, then prove none is left
#   scripts/gpu-rental.sh status                what is up, and what it costs by now
#
# A powered-off GPU Droplet still bills: only `down` stops the meter, so every
# session ends in `down`, on failure too.
set -euo pipefail
cd "$(dirname "$0")/.."

TAG=monsterpaws-rental
SIZE=${RENTAL_SIZE:-gpu-h200x1-141gb}
REGION=${RENTAL_REGION:-atl1}
IMAGE=gpu-h100x1-base            # DigitalOcean's "NVIDIA AI/ML Ready" image: driver, CUDA, docker
SSH_KEY=58110633                 # monsterpaws-wsl, ~/.ssh/id_ed25519
# PyTorch publishes torch 2.14.1 (the Arc's pin, comfyui/Dockerfile) for CUDA 13.0, not 12.8 (index read 2026-10-23).
TORCH=cu130
# The cleanup's one fixed instruction (ADR-0004 as amended 2026-10-22): change it and the set it made is a different set.
INSTRUCTION=${INSTRUCTION:-"Remove the genitals, sheath and testicles from this animal. Paint the belly, groin and inner thighs as smooth fur that matches the surrounding coat. Keep everything else in the painting exactly the same: the animal, its pose, its face, the background and the soft watercolor style."}

# Never `export X=$(pass …)` in one step: export's own status hides a locked gpg agent, and every doctl call then fails.
if [ -z "${DIGITALOCEAN_ACCESS_TOKEN:-}" ]; then
  DIGITALOCEAN_ACCESS_TOKEN=$(pass show digitalocean/api-token) || { echo "pass is locked — unlock it (pass show digitalocean/api-token) and rerun" >&2; exit 1; }
fi
export DIGITALOCEAN_ACCESS_TOKEN
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$HOME/.ssh/known_hosts.rental" -o ConnectTimeout=10 -o ServerAliveInterval=15)

droplets() { doctl compute droplet list --tag-name "$TAG" --format ID,Name,PublicIPv4,Status --no-header; }
ip() { [ -n "${RENTAL_IP:-}" ] || RENTAL_IP=$(droplets | awk 'NR==1 {print $3}'); echo "$RENTAL_IP"; }
remote() { ssh "${SSH_OPTS[@]}" "root@$(ip)" "$@"; }

# Long remote work runs detached on the droplet and is polled with short calls: a long ssh
# session that drops leaves the caller waiting on nothing (2026-10-23).
follow() {  # follow <remote log> <done marker>
  local seen=0 lines
  while true; do
    lines=$(remote "tail -n +$((seen + 1)) $1 2>/dev/null" || true)
    if [ -n "$lines" ]; then printf '%s\n' "$lines"; seen=$((seen + $(printf '%s\n' "$lines" | wc -l))); fi
    printf '%s\n' "$lines" | grep -q "== FAILED" && return 1
    printf '%s\n' "$lines" | grep -q "$2" && return 0
    local n; n=$(basename "$1" .log)
    # the bracket keeps pgrep from matching the remote shell that runs it
    remote "pgrep -f 'rental/[${n:0:1}]${n:1}.sh' >/dev/null" || { echo "the remote job ended without '$2'" >&2; return 1; }
    sleep 15
  done
}

up() {
  if [ -n "$(droplets)" ]; then
    echo "a rental is already up — 'serve' to resume, 'status', or 'down':" >&2; droplets >&2; exit 1
  fi
  trap 'echo "up failed — deleting the droplet so it stops billing" >&2; down' ERR
  doctl compute droplet create "mp-rental-$(date +%Y%m%d-%H%M)" --size "$SIZE" --region "$REGION" \
    --image "$IMAGE" --ssh-keys "$SSH_KEY" --tag-name "$TAG" --wait --format ID,Name,PublicIPv4
  until remote true 2>/dev/null; do sleep 5; done
  remote 'nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader && docker --version'
  trap - ERR
  serve
}

serve() {
  RENTAL_IP=$(ip)
  # Untracked-but-not-ignored files ship too, so an uncommitted workflow can be tried before it is committed.
  git ls-files -co --exclude-standard comfyui | tar -cf - -T - | remote 'rm -rf /root/mp && mkdir -p /root/mp && tar -xf - -C /root/mp'
  remote "nohup setsid bash /root/mp/comfyui/rental/serve.sh $TORCH > /root/serve.log 2>&1 < /dev/null &"
  follow /root/serve.log "== SERVING" || { echo "serve failed — the droplet is still up and billing: fix and 'serve' again, or 'down'" >&2; exit 1; }
  echo "serving: $(ip) — billing until 'scripts/gpu-rental.sh down'"
}

clean() {
  RENTAL_IP=$(ip)
  local in=${1:?usage: clean <dir of PNGs> <out dir>} out=${2:?usage: clean <dir of PNGs> <out dir>}
  mkdir -p "$out"
  (cd "$in" && ls ./*.png | tar -cf - -T -) | remote 'rm -rf /root/in /root/results && mkdir -p /root/in && tar -xf - -C /root/in'
  printf '%s\n' "$INSTRUCTION" | remote 'cat > /root/instruction.txt'
  remote "nohup setsid bash /root/mp/comfyui/rental/clean.sh > /root/clean.log 2>&1 < /dev/null &"
  follow /root/clean.log "== DONE" || { echo "clean failed — the droplet is still up and billing" >&2; exit 1; }
  remote 'tar -cf - -C /root/results .' | tar -xf - -C "$out"
  printf '%s\n' "$INSTRUCTION" > "$out/instruction.txt"
  echo "clean: $(ls "$out"/*.png | wc -l) images in $out"
}

down() {
  local ids
  ids=$(droplets | awk '{print $1}')
  [ -n "$ids" ] && doctl compute droplet delete -f $ids
  sleep 5
  if [ -n "$(droplets)" ]; then echo "STILL UP — check the control panel:" >&2; droplets >&2; exit 1; fi
  echo "down: no rental droplet left"
}

status() {
  local rows; rows=$(droplets)
  [ -z "$rows" ] && { echo "nothing up"; return; }
  echo "$rows"
  # the list view prints Created as <nil>; the JSON carries created_at
  local created; created=$(doctl compute droplet get "$(echo "$rows" | awk 'NR==1 {print $1}')" --output json | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["created_at"])')
  python3 -c "
import datetime as d,sys
h=(d.datetime.now(d.timezone.utc)-d.datetime.fromisoformat(sys.argv[1].replace('Z','+00:00'))).total_seconds()/3600
print(f'up {h:.2f} h, about \${h*float(sys.argv[2]):.2f} so far')" "$created" "$(doctl compute size list --format Slug,PriceHourly --no-header | awk -v s="$SIZE" '$1==s {print $2}')"
}

"${1:-status}" "${@:2}"
