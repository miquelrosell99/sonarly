#!/usr/bin/env bash
# Generates a deterministic synthetic music library (mp3 + gradient cover art)
# for screenshot captures. Usage: seed-library.sh <out-dir>
set -euo pipefail

OUT="${1:?usage: seed-library.sh <out-dir>}"
mkdir -p "$OUT"

ARTISTS=("Keystone Division" "Mireille Ash" "Vantablack Choir" "Harborline" "Atlas Minor" "Copper Veil" "Pond Society" "Tessellate" "Platform Nine" "Svalbard Chorus" "Foundry Workers Union" "Moss Algorithm" "Marlow & the Mechanics" "Iridium Pool")
ALBUMS=("Low Orbit" "Paper Lanterns" "Concrete Bloom" "Salt & Static" "The Cartographer's Dream" "Neon Vespers" "Grayscale Summer" "Feral Geometry" "Midnight Commute" "Aurora Tapes" "Rust Belt Hymns" "Digital Foliage" "The Quiet Engine" "Glass Harmonics")
YEARS=(2023 2021 2019 2022 2020 2024 2018 2023 2022 2021 2017 2024 2016 2023)
GENRES=("Electronic" "Indie Folk" "Post-Rock" "Dream Pop" "Jazz" "Synthwave" "Shoegaze" "Math Rock" "Lo-Fi" "Ambient" "Americana" "IDM" "Rock" "Neo-Classical")
C0=(0x1a2a6c 0x8a5a2b 0x2b2b2b 0x0e5e5e 0x6b3fa0 0xb21f6b 0x3f6b2f 0x704214 0x12355b 0x0b3d2e 0x7a1f1f 0x1f7a5a 0x4a4a68 0x2e1f4e)
C1=(0xb21f1f 0xd4a017 0x6b8e23 0xd17fb5 0xd9a441 0x1f6bb2 0xa89f91 0x2f8f83 0xc46a1b 0x5fd4c0 0xd9c441 0x8f2f6b 0xc0b283 0x8fd17f)

WORDS_A=("Velvet" "Northern" "Glass" "Static" "Golden" "Hollow" "Quiet" "Electric" "Paper" "Midnight" "Feral" "Copper" "Fading" "Ultraviolet" "Broken" "Native" "Slow" "Bright" "Wandering" "Magnetic")
WORDS_B=("Circuit" "Wake" "Harmonics" "Bloom" "Commute" "Vespers" "Geometry" "Lanterns" "Engine" "Tides" "Framework" "Signals" "Garden" "Archive" "Meridian" "Weather" "Ritual" "Vector" "Currents" "Compass")

NA=${#ALBUMS[@]}
for ((ai = 0; ai < NA; ai++)); do
  artist="${ARTISTS[$ai]}"; album="${ALBUMS[$ai]}"
  dir="$OUT/$artist/$album"
  mkdir -p "$dir"

  # Cover: multi-stop radial/circular gradient + film grain + vignette.
  # c2/c3 rotate the palette so each album mixes two curated color pairs.
  nb=$((2 + ai % 3))
  c2="${C0[$(( (ai + 1) % NA ))]}"; c3="${C1[$(( (ai + 1) % NA ))]}"
  cx=$(( (ai * 421) % 1200 )); cy=$(( (ai * 719) % 1200 ))
  gtype=$((1 + ai % 2)) # 1=radial, 2=circular
  ffmpeg -y -loglevel error \
    -f lavfi -i "gradients=size=1200x1200:c0=${C0[$ai]}:c1=${C1[$ai]}:c2=$c2:c3=$c3:nb_colors=$nb:seed=$((ai + 1)):type=$gtype:x0=$cx:y0=$cy:rate=1:duration=1" \
    -frames:v 1 -vf "noise=alls=4:allf=t,vignette=PI/5" "$dir/cover.png"

  ntracks=$((6 + ai % 4))
  for ((ti = 0; ti < ntracks; ti++)); do
    title="${WORDS_A[$(( (ai * 3 + ti) % 20 ))]} ${WORDS_B[$(( (ai * 7 + ti * 3) % 20 ))]}"
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
