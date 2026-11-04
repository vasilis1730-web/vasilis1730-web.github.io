#!/usr/bin/env bash
# Παράγει τα δοκιμαστικά αρχεία ήχου στο tests/fixtures/generated/ (δεν μπαίνουν στο repo).
#
#   - greek.mp3: ελληνική ομιλία (Google TTS μέσω gTTS), για πραγματική δοκιμή του Whisper,
#   - greek.<μορφή>: το ίδιο σε m4a (AAC), mp4 με εικόνα, ogg/opus, webm/opus, wav, flac,
#   - two-voices.wav: δύο «φωνές» (η δεύτερη με αλλαγμένο τόνο) για τον διαχωρισμό ομιλητών,
#   - tone-48k-stereo.wav: ημίτονο 2 s, για έλεγχο διάρκειας και resampling.
#
# Χρειάζεται ffmpeg και python3 με gTTS (pip install gTTS, π.χ. σε venv: GTTS_PYTHON=/path/venv/bin/python).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${here}/generated"
python="${GTTS_PYTHON:-python3}"
mkdir -p "${out}"

"${python}" - "${out}" <<'PY'
import sys
from gtts import gTTS
out = sys.argv[1]
gTTS('Καλημέρα σε όλους. Ξεκινάμε τη σημερινή συνεδρίαση της τεχνικής υπηρεσίας. '
     'Το πρώτο θέμα είναι η συντήρηση των σχολικών κτιρίων πριν από τον χειμώνα.', lang='el').save(f'{out}/greek.mp3')
gTTS('Συμφωνώ με την πρόταση. Θα ετοιμάσουμε τη μελέτη μέσα στην επόμενη εβδομάδα.', lang='el').save(f'{out}/second.mp3')
PY

ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
ff -i "${out}/greek.mp3" -c:a aac -b:a 64k "${out}/greek.m4a"
ff -f lavfi -i color=c=0x0e3b43:s=160x120:r=10 -i "${out}/greek.mp3" -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 64k "${out}/greek.mp4"
ff -i "${out}/greek.mp3" -c:a libopus -b:a 32k "${out}/greek.ogg"
ff -i "${out}/greek.mp3" -c:a libopus -b:a 32k "${out}/greek.webm"
ff -i "${out}/greek.mp3" -ar 44100 -ac 2 "${out}/greek.wav"
ff -i "${out}/greek.mp3" "${out}/greek.flac"
# Δεύτερη «φωνή»: ίδιο TTS με χαμηλότερο τόνο και ίδια ταχύτητα (asetrate + atempo).
ff -i "${out}/second.mp3" -af "asetrate=24000*0.78,aresample=24000,atempo=1/0.78" "${out}/second-low.wav"
ff -i "${out}/greek.mp3" -i "${out}/second-low.wav" -i "${out}/greek.mp3" \
  -filter_complex "[0:a]aresample=16000,apad=pad_dur=1[a];[1:a]aresample=16000,apad=pad_dur=1[b];[2:a]aresample=16000[c];[a][b][c]concat=n=3:v=0:a=1" \
  -ac 1 -ar 16000 "${out}/two-voices.wav"
ff -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=2" -ac 2 "${out}/tone-48k-stereo.wav"
ls -la "${out}"
