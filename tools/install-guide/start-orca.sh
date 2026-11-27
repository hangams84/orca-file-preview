#!/bin/bash
# Inside the orca-guide image: start Xvfb, a D-Bus session and Orca with a fresh profile and the
# DevTools port open. Prints nothing on success; exits non-zero if the port never answers.
#   W=1440 H=900 SCALE=1 PORT=9222 bash start-orca.sh
set -u
W=${W:-1440}; H=${H:-900}; SCALE=${SCALE:-1}; PORT=${PORT:-9222}
export DISPLAY=${DISPLAY:-:99}
# Stop an earlier Orca and wait until it has released the DevTools port.
pkill -f '^/opt/Orca/orca-ide' >/dev/null 2>&1
for i in $(seq 1 30); do pgrep -f '^/opt/Orca/orca-ide' >/dev/null || break; sleep 0.5; done
pkill -9 -f '^/opt/Orca/orca-ide' >/dev/null 2>&1; sleep 0.5
if ! xdpyinfo >/dev/null 2>&1; then
  Xvfb "$DISPLAY" -screen 0 $((W*SCALE))x$((H*SCALE))x24 -nolisten tcp >/dev/null 2>&1 &
  for i in $(seq 1 20); do xdpyinfo >/dev/null 2>&1 && break; sleep 0.5; done
fi
[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] || eval "$(dbus-launch --sh-syntax)"
# Fresh profile every run: no plugin installed, no remembered window or language.
rm -rf "$HOME/.config/orca" "$HOME/.config/Orca" "$HOME/.orca" 2>/dev/null
/opt/Orca/orca-ide --remote-debugging-port="$PORT" --force-device-scale-factor="$SCALE" \
  >/tmp/orca-app.log 2>&1 &
for i in $(seq 1 60); do curl -sf "localhost:$PORT/json/version" >/dev/null && exit 0; sleep 1; done
echo "Orca did not open the DevTools port" >&2; exit 1
