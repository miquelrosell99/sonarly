#!/usr/bin/env bash
# Generates the S2 streaming-spike media corpus with ffmpeg 5.1.x.
# Usage: ./genmedia.sh   (idempotent; -y overwrites)
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p media
FF=${FFMPEG:-ffmpeg}

# 1. ~30s MP3 @ 128k (typical direct-stream source; 128 kbps CBR)
$FF -hide_banner -loglevel error -y \
  -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=30" \
  -c:a libmp3lame -b:a 128k media/spike_128k.mp3

# 2. ~30s FLAC 16/44.1 (lossless source; will exceed typical maxBitRate caps)
$FF -hide_banner -loglevel error -y \
  -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=30" \
  -c:a flac -compression_level 5 media/spike.flac

# 3. ~60s MP3 @ 320k CBR (high-bitrate source; dense signal so 320k is real)
$FF -hide_banner -loglevel error -y \
  -f lavfi -i "sine=frequency=220:sample_rate=44100:duration=60" \
  -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=60" \
  -f lavfi -i "sine=frequency=3520:sample_rate=44100:duration=60" \
  -f lavfi -i "anoisesrc=color=pink:sample_rate=44100:duration=60:amplitude=0.3" \
  -filter_complex "[0][1][2][3]amix=inputs=4:normalize=0,volume=0.8" \
  -c:a libmp3lame -b:a 320k media/spike_320k.mp3

# 4. ~60s FLAC 24/96, compression_level 0 (high-bitrate lossless source)
$FF -hide_banner -loglevel error -y \
  -f lavfi -i "sine=frequency=220:sample_rate=96000:duration=60" \
  -f lavfi -i "sine=frequency=440:sample_rate=96000:duration=60" \
  -f lavfi -i "sine=frequency=1046:sample_rate=96000:duration=60" \
  -f lavfi -i "anoisesrc=color=pink:sample_rate=96000:duration=60:amplitude=0.3" \
  -filter_complex "[0][1][2][3]amix=inputs=4:normalize=0,volume=0.8" \
  -c:a flac -compression_level 0 -sample_fmt s32 media/spike_2496.flac

# 5. Corrupt file (valid .mp3 extension, garbage payload) for ffmpeg-failure tests
head -c 200000 /dev/urandom > media/corrupt.mp3

echo "=== generated files ==="
for f in media/*; do
  echo "--- $f ($(stat -c%s "$f") bytes)"
  ffprobe -v error \
    -show_entries format=format_name,duration,bit_rate \
    -show_entries stream=codec_name,sample_rate,channels,bits_per_sample \
    -of default=noprint_wrappers=1 "$f" || true
done
