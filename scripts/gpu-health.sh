#!/usr/bin/env bash
# The home GPU box's bearing (doc/infra.md, Home GPU): what the Windows log,
# the WSL VM, the driver pool and the smoke say right now, against the
# runbook's numbers. Read-only apart from the smoke, which uses the card for
# a few seconds. Run after any driver, BIOS, WSL or kernel change, and when
# the box has frozen.
#
#   scripts/gpu-health.sh [hours] [--no-smoke]     default 48 hours of log
set -uo pipefail
cd "$(dirname "$0")/.."
HOURS=48; SMOKE=1
for a in "$@"; do case "$a" in --no-smoke) SMOKE=0 ;; *) HOURS=$a ;; esac; done

ps1() { powershell.exe -NoProfile -Command "$1" 2>/dev/null | tr -d '\r'; }

echo "== Windows"
ps1 '
$o=Get-CimInstance Win32_OperatingSystem
"boot        " + $o.LastBootUpTime.ToString("yyyy-MM-dd HH:mm") + "  (" + [math]::Round(((Get-Date)-$o.LastBootUpTime).TotalHours,1) + " h up)"
"memory      {0:N1} GB free of {1:N1}" -f ($o.FreePhysicalMemory/1MB), ($o.TotalVisibleMemorySize/1MB)
Get-Process "Memory Compression" -ErrorAction SilentlyContinue | ForEach-Object { "compression {0:N1} GB  (16 GB on an idle box preceded the 2026-10 freezes; ~0 is healthy)" -f ($_.WorkingSet64/1GB) }
$b=Get-CimInstance Win32_BIOS; "bios        {0} ({1:yyyy-MM-dd})" -f $b.SMBIOSBIOSVersion, $b.ReleaseDate
$m=Get-CimInstance Win32_PhysicalMemory | Select-Object -First 1; "ram         {0} MT/s configured (2666 JEDEC base, 3200 JEDEC, 3600 XMP — stability week runs at base)" -f $m.ConfiguredClockSpeed
Get-CimInstance Win32_VideoController | Where-Object Name -like "*Arc*" | ForEach-Object { "arc driver  {0} ({1:yyyy-MM-dd}) — the container runtime pins must be at least this new" -f $_.DriverVersion, $_.DriverDate }
'
echo "-- events, last $HOURS h (6008 unexpected shutdown, 41 dirty reboot, WHEA 1 fatal, 4101 display reset, 130 S3 resume)"
ps1 "
\$since=(Get-Date).AddHours(-$HOURS)
\$ev = Get-WinEvent -FilterHashtable @{LogName='System'; StartTime=\$since} -ErrorAction SilentlyContinue | Where-Object { \$_.Id -in 6008,41,4101,130 -or \$_.ProviderName -like '*WHEA*' } | Sort-Object TimeCreated
if (-not \$ev) { '   none' } else { \$ev | ForEach-Object { '   {0:MM-dd HH:mm} {1,5} {2}' -f \$_.TimeCreated, \$_.Id, (((\$_.Message -split \"\`n\")[0]) -replace '\s+',' ').Substring(0,[Math]::Min(90,((\$_.Message -split \"\`n\")[0]).Length)) } }
"
echo "-- who is on the Arc right now (Windows routes 'high performance' apps to it with no cable attached; nothing but ComfyUI should be here)"
ps1 '
$arc = ((Get-Counter "\GPU Local Adapter Memory(*)\Local Usage" -ErrorAction SilentlyContinue).CounterSamples | Where-Object CookedValue -gt 0 | Select-Object -First 1).InstanceName -replace "^luid_","" -replace "_phys.*$",""
if (-not $arc) { "   (no adapter reports local VRAM — the Arc is idle or absent)" } else {
  $rows = (Get-Counter "\GPU Engine(*)\Utilization Percentage").CounterSamples | Where-Object { $_.CookedValue -gt 0.5 -and $_.InstanceName -like "*$arc*" }
  if (-not $rows) { "   nothing above 0.5% on adapter $arc" }
  foreach ($r in $rows) { $procId = [int](($r.InstanceName -split "_")[1]); $pr = Get-Process -Id $procId -ErrorAction SilentlyContinue; "   {0,5:N1}%  {1}  (pid {2})" -f $r.CookedValue, ($(if ($pr) { $pr.ProcessName } else { "gone" })), $procId }
  "   per-app routing: HKCU\Software\Microsoft\DirectX\UserGpuPreferences — GpuPreference=1 pins an app to the UHD 770"
}
'
echo "-- .wslconfig"
f=$(ls /mnt/c/Users/*/.wslconfig 2>/dev/null | head -1); [ -n "$f" ] && grep -E "^(memory|swap|processors|autoMemoryReclaim|networkingMode)=" "$f" | sed 's/^/   /' || echo "   none found"

echo "== WSL"
echo "   kernel $(uname -r)   $(free -g | awk 'NR==2{print "vm "$2" GB, used "$3", free "$4", cache "$6}')"
echo "   containers: $(docker ps --format '{{.Names}} ({{.Status}})' | paste -sd ', ' -)"; [ -z "$(docker ps -q)" ] && echo "   (none running)"
echo "   guard: $(comfyui/guard.sh mem)   (pool ~1 GB idle; >4 GB is the leak; dedicated 0 when nothing runs)"

if [ "$SMOKE" = 1 ]; then
  echo "== smoke (cold, then warm — warm should read ~70+ TFLOPS; every roundtrip must say ok)"
  for i in 1 2; do npm run -s comfy:smoke 2>&1 | grep -E "roundtrip|leaked|matmul ok|TFLOPS|FAIL|rror|^ok" | grep -v UserWarning | sed "s/^/   [$i] /"; done
fi
