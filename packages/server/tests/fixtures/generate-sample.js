import { writeFileSync } from 'node:fs';
import NodeID3 from 'node-id3';

// ID3v2.3 tag buffer with some common tags
const id3 = NodeID3.create({
  title: 'Sample Song',
  artist: 'Sample Artist',
  album: 'Sample Album',
  year: '2024',
  genre: 'Sample',
});

// Minimal MPEG1 Layer3 128kbps 44100Hz stereo MP3 frames.
// Frame header: 0xFF 0xFB 0x92 0x00
// Frame size = floor(144 * 128000 / 44100) + 1 (padding) = 418 bytes
const FRAME_SIZE = 418;
const HEADER = Buffer.from([0xff, 0xfb, 0x92, 0x00]);
const FRAME_DATA = Buffer.alloc(FRAME_SIZE - HEADER.length, 0);
const FRAME = Buffer.concat([HEADER, FRAME_DATA]);

const frames = Buffer.concat(Array.from({ length: 10 }, () => FRAME));
const mp3 = Buffer.concat([id3, frames]);
writeFileSync(new URL('sample.mp3', import.meta.url), mp3);
console.log(`Wrote ${mp3.length} bytes to sample.mp3`);
