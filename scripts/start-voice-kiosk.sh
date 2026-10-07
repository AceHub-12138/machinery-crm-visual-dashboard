#!/usr/bin/env bash
# Audio-only kiosk launch for Task 5. Microphone/HTTPS deployment is Task 6/9.
set -euo pipefail
kiosk_url="${1:-${VOICE_KIOSK_URL:-http://localhost:3015/screen/sales?voiceLive=1}}"
case "$(uname -s)" in
  Darwin) exec open -na "Google Chrome" --args --kiosk --autoplay-policy=no-user-gesture-required "$kiosk_url" ;;
  *)
    kiosk_browser="${VOICE_KIOSK_BROWSER:-google-chrome}"
    exec "$kiosk_browser" --kiosk --autoplay-policy=no-user-gesture-required "$kiosk_url"
    ;;
esac
