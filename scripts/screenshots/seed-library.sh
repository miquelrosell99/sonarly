#!/usr/bin/env bash
# Generates a deterministic synthetic music library (mp3 + generative cover
# art via cover-art.py) for screenshot captures.
# Usage: seed-library.sh <out-dir>
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${1:?usage: seed-library.sh <out-dir>}"
mkdir -p "$OUT"

ARTISTS=("Keystone Division" "Mireille Ash" "Vantablack Choir" "Harborline" "Atlas Minor" "Copper Veil" "Pond Society" "Tessellate" "Platform Nine" "Svalbard Chorus" "Foundry Workers Union" "Moss Algorithm" "Marlow & the Mechanics" "Iridium Pool")
ALBUMS=("Low Orbit" "Paper Lanterns" "Concrete Bloom" "Salt & Static" "The Cartographer's Dream" "Neon Vespers" "Grayscale Summer" "Feral Geometry" "Midnight Commute" "Aurora Tapes" "Rust Belt Hymns" "Digital Foliage" "The Quiet Engine" "Glass Harmonics")
YEARS=(2023 2021 2019 2022 2020 2024 2018 2023 2022 2021 2017 2024 2016 2023)
GENRES=("Electronic" "Indie Folk" "Post-Rock" "Dream Pop" "Jazz" "Synthwave" "Shoegaze" "Math Rock" "Lo-Fi" "Ambient" "Americana" "IDM" "Rock" "Neo-Classical")

WORDS_A=("Velvet" "Northern" "Glass" "Static" "Golden" "Hollow" "Quiet" "Electric" "Paper" "Midnight" "Feral" "Copper" "Fading" "Ultraviolet" "Broken" "Native" "Slow" "Bright" "Wandering" "Magnetic")
WORDS_B=("Circuit" "Wake" "Harmonics" "Bloom" "Commute" "Vespers" "Geometry" "Lanterns" "Engine" "Tides" "Framework" "Signals" "Garden" "Archive" "Meridian" "Weather" "Ritual" "Vector" "Currents" "Compass")

NA=${#ALBUMS[@]}
for ((ai = 0; ai < NA; ai++)); do
  artist="${ARTISTS[$ai]}"; album="${ALBUMS[$ai]}"
  dir="$OUT/$artist/$album"
  mkdir -p "$dir"

  python3 "$DIR/cover-art.py" "$dir/cover.png" "$ai"

  ntracks=$((6 + ai % 4))
  for ((ti = 0; ti < ntracks; ti++)); do
    title="${WORDS_A[$(( (ai * 3 + ti * 7) % 20 ))]} ${WORDS_B[$(( (ai * 7 + ti * 11) % 20 ))]}"
    freq=$((180 + (ai * 13 + ti * 29) % 420))
    num=$(printf '%02d' $((ti + 1)))
    ffmpeg -y -loglevel error \
      -f lavfi -i "sine=frequency=${freq}:duration=3" \
      -i "$dir/cover.png" \
      -map 0:a -map 1:0 -c:a libmp3lame -b:a 128k -id3v2_version 3 \
      -metadata title="$title" \
      -metadata artist="$artist" \
      -metadata album="$album" \
      -metadata album_artist="$artist" \
      -metadata track=$((ti + 1)) \
      -metadata genre="${GENRES[$ai]}" \
      -metadata date="${YEARS[$ai]}" \
      "$dir/$num - $title.mp3"
  done
  echo "seeded: $artist - $album ($ntracks tracks)"
done
echo "library ready at $OUT"
