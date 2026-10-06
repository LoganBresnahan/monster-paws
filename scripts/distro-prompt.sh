# Sourced by ~/.bashrc in the monsterpaws-* distros (installed by bootstrap-distro.sh).
# A prod shell must never pass for a dev one: the distro picks the prompt colour — dev magenta, prod red —
# and the hostname in it is the distro's own (wsl.conf [network] hostname), not the Windows machine's.
case "${WSL_DISTRO_NAME:-}" in
  *-prod) PS1='\[\033[01;31m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ ' ;;
  *-dev)  PS1='\[\033[01;35m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ ' ;;
esac
