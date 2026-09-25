#!/usr/bin/env python3
"""P4a testdata corpus generator (ported from v2/spikes/metadata/gen_corpus.py).

Builds one tagged audio file per supported format with the full v1 tag schema
(see packages/server/src/features/tags/reader.ts in the main checkout), plus
one pathological ID3v1-only file with non-UTF8 bytes.

Outputs:
  corpus/spike.mp3              ID3v2.4, hand-built MPEG frame stream
  corpus/spike.flac             FLAC, via mutagen
  corpus/spike.ogg              Ogg Vorbis, hand-built (mutagen can't reserialize
                                a synthetic vorbis stream)
  corpus/spike.m4a              MP4, hand-built (ilst + real mdhd/stsd so the
                                format fields are populated)
  corpus/pathological-id3v1.mp3 ID3v1 only, Latin-1 high bytes in title/artist
  manifest.json                 ground truth: every semantic -> expected value

Re-run: python3 gen_corpus.py   (from internal/audio/testdata/)
"""

import base64
import json
import struct
from pathlib import Path

from mutagen.id3 import (
    APIC,
    COMM,
    ID3,
    SYLT,
    TALB,
    TBPM,
    TCOM,
    TCON,
    TDRC,
    TIT2,
    TPE1,
    TPE2,
    TIPL,
    TPOS,
    TPUB,
    TRCK,
    TSRC,
    TXXX,
    UFID,
    USLT,
)
from mutagen.flac import FLAC, Picture

HERE = Path(__file__).parent
CORPUS = HERE / "corpus"

# 1x1 red PNG.
PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

# Canonical values shared by every format. Chosen to be unambiguous strings.
V = {
    "title": "Spike Song (feat. Test)",
    "artists": ["Spike Artist One", "Spike Artist Two"],
    "album": "Spike Album",
    "albumArtist": "Spike Album Artist",
    "track": 3,
    "totalTracks": 12,
    "disc": 1,
    "totalDiscs": 2,
    "genres": ["Jazz", "Fusion"],
    "year": 2021,
    "date": "2021-05-04",
    "mbidRecording": "11111111-2222-3333-4444-555555555555",
    "mbidRelease": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    "mbidArtistIds": ["aaaaaaaa-1111-2222-3333-444444444444",
                      "bbbbbbbb-1111-2222-3333-444444444444"],
    "mbidAlbumArtistId": "cccccccc-1111-2222-3333-444444444444",
    "mbidReleaseGroup": "dddddddd-1111-2222-3333-444444444444",
    "barcode": "1234567890123",
    "asin": "B0C0SPIKE0",
    "isrc": "USS1O210001",
    "rgTrack": "-7.03 dB",
    "rgAlbum": "-6.51 dB",
    "explicit": True,
    "composers": ["Spike Composer One", "Spike Composer Two"],
    "producers": ["Spike Producer"],
    "label": "Spike Label",
    "releaseType": "album; soundtrack",
    "comment": "Spike comment text",
    "bpm": 128,
    "lyrics": "Plain lyrics line one\nPlain lyrics line two",
    "syncedLyrics": [[0, "Synced line one"], [1500, "Synced line two"]],
    "lrcPayload": "[00:00.00]Synced line one\n[00:01.50]Synced line two\n",
}
SAMPLE_RATE = 44100
DURATION_SEC = 3
TOTAL_SAMPLES = SAMPLE_RATE * DURATION_SEC


def mp3_frame_stream(n_frames=120):
    """Minimal MPEG-1 Layer III 128kbps 44.1kHz joint-stereo frames."""
    header = b"\xff\xfb\x90\x00"  # sync, L3, 128kbps, 44100Hz, no padding
    frame_len = 144 * 128000 // SAMPLE_RATE  # 417
    return header + b"\x00" * (frame_len - 4) + (
        (header + b"\x00" * (frame_len - 4)) * (n_frames - 1)
    )


def build_mp3(path):
    tags = ID3()
    enc = 3  # UTF-8
    tags.add(TIT2(encoding=enc, text=[V["title"]]))
    tags.add(TPE1(encoding=enc, text=V["artists"]))
    tags.add(TPE2(encoding=enc, text=[V["albumArtist"]]))
    tags.add(TALB(encoding=enc, text=[V["album"]]))
    tags.add(TRCK(encoding=enc, text=[f"{V['track']}/{V['totalTracks']}"]))
    tags.add(TPOS(encoding=enc, text=[f"{V['disc']}/{V['totalDiscs']}"]))
    tags.add(TCON(encoding=enc, text=V["genres"]))
    tags.add(TDRC(encoding=enc, text=[V["date"]]))
    tags.add(TCOM(encoding=enc, text=V["composers"]))
    tags.add(TBPM(encoding=enc, text=[str(V["bpm"])]))
    tags.add(TSRC(encoding=enc, text=[V["isrc"]]))
    tags.add(TPUB(encoding=enc, text=[V["label"]]))
    tags.add(COMM(encoding=enc, lang="eng", desc="", text=[V["comment"]]))
    tags.add(USLT(encoding=enc, lang="eng", desc="", text=V["lyrics"]))
    tags.add(
        SYLT(
            encoding=enc,
            lang="eng",
            desc="",
            text=[(s, t) for t, s in V["syncedLyrics"]],  # (text, time_ms)
            format=2,  # milliseconds
            type=1,  # lyrics
        )
    )
    tags.add(
        APIC(
            encoding=enc,
            mime="image/png",
            type=3,
            desc="Cover",
            data=PNG_1X1,
        )
    )
    tags.add(
        UFID(owner="http://musicbrainz.org", data=V["mbidRecording"].encode())
    )
    # Producer goes in TIPL with role "producer" (what Picard/music-metadata do).
    tags.add(TIPL(encoding=enc, people=[("producer", p) for p in V["producers"]]))
    for desc, text in [
        ("MusicBrainz Album Id", [V["mbidRelease"]]),
        ("MusicBrainz Release Group Id", [V["mbidReleaseGroup"]]),
        ("MusicBrainz Artist Id", V["mbidArtistIds"]),
        ("MusicBrainz Album Artist Id", [V["mbidAlbumArtistId"]]),
        ("BARCODE", [V["barcode"]]),
        ("ASIN", [V["asin"]]),
        ("MusicBrainz Album Type", [V["releaseType"]]),
        ("ITUNESADVISORY", ["1" if V["explicit"] else "0"]),
        ("replaygain_track_gain", [V["rgTrack"]]),
        ("replaygain_album_gain", [V["rgAlbum"]]),
        ("SYNCED_LYRICS", [V["lrcPayload"]]),
    ]:
        tags.add(TXXX(encoding=enc, desc=desc, text=text))

    data = mp3_frame_stream()
    path.write_bytes(data)
    tags.save(path, v2_version=4)


def _flac_skeleton() -> bytes:
    """fLaC magic + minimal STREAMINFO block (34-byte payload)."""
    info = (
        struct.pack(">HH", 4096, 4096)
        + b"\x00\x00\x00"  # min framesize
        + b"\x00\x00\x00"  # max framesize
    )
    packed = (
        (SAMPLE_RATE << 44)
        | ((2 - 1) << 41)
        | ((16 - 1) << 36)
        | TOTAL_SAMPLES
    )
    info += struct.pack(">Q", packed) + b"\x00" * 16  # MD5
    return b"fLaC" + b"\x80" + b"\x00\x00\x22" + info


def build_flac(path):
    path.write_bytes(_flac_skeleton())
    flac = FLAC(path)
    flac.add_tags()
    c = flac.tags
    flac.info.sample_rate = SAMPLE_RATE
    flac.info.channels = 2
    flac.info.bits_per_sample = 16
    flac.info.total_samples = TOTAL_SAMPLES
    for k, vals in vorbis_comments().items():
        for v in vals:
            c.append((k, v))
    pic = Picture()
    pic.type = 3
    pic.mime = "image/png"
    pic.desc = "Cover"
    pic.data = PNG_1X1
    flac.add_picture(pic)
    flac.save(path)


def vorbis_comments():
    """Comment map shared by FLAC and Ogg Vorbis."""
    cm = {
        "TITLE": [V["title"]],
        "ARTIST": V["artists"],
        "ALBUM": [V["album"]],
        "ALBUMARTIST": [V["albumArtist"]],
        "TRACKNUMBER": [str(V["track"])],
        "TRACKTOTAL": [str(V["totalTracks"])],
        "DISCNUMBER": [str(V["disc"])],
        "DISCTOTAL": [str(V["totalDiscs"])],
        "GENRE": V["genres"],
        "DATE": [V["date"]],
        "COMPOSER": V["composers"],
        "PRODUCER": V["producers"],
        "LABEL": [V["label"]],
        "RELEASETYPE": [V["releaseType"]],
        "COMMENT": [V["comment"]],
        "BPM": [str(V["bpm"])],
        "LYRICS": [V["lyrics"]],
        "SYNCEDLYRICS": [V["lrcPayload"]],
        "MUSICBRAINZ_TRACKID": [V["mbidRecording"]],
        "MUSICBRAINZ_ALBUMID": [V["mbidRelease"]],
        "MUSICBRAINZ_ARTISTID": V["mbidArtistIds"],
        "MUSICBRAINZ_ALBUMARTISTID": [V["mbidAlbumArtistId"]],
        "MUSICBRAINZ_RELEASEGROUPID": [V["mbidReleaseGroup"]],
        "BARCODE": [V["barcode"]],
        "ASIN": [V["asin"]],
        "ISRC": [V["isrc"]],
        "REPLAYGAIN_TRACK_GAIN": [V["rgTrack"]],
        "REPLAYGAIN_ALBUM_GAIN": [V["rgAlbum"]],
        "ITUNESADVISORY": ["1"],
    }
    return cm


# ---------------------------------------------------------------- Ogg Vorbis

_OGG_CRC_TABLE = []
for _i in range(256):
    _r = _i << 24
    for _ in range(8):
        _r = ((_r << 1) ^ 0x04C11DB7) & 0xFFFFFFFF if _r & 0x80000000 else (_r << 1) & 0xFFFFFFFF
    _OGG_CRC_TABLE.append(_r)


def _ogg_crc(data: bytes) -> int:
    crc = 0
    for b in data:
        crc = ((_OGG_CRC_TABLE[((crc >> 24) & 0xFF) ^ b] ^ (crc << 8))) & 0xFFFFFFFF
    return crc


def _ogg_page(payload: bytes, seq: int, granule: int, serial: int,
              header_type: int) -> bytes:
    segs = []
    n = len(payload)
    while n >= 255:
        segs.append(255)
        n -= 255
    segs.append(n)
    header = struct.pack(
        "<4sBBqIII", b"OggS", 0, header_type, granule, serial, seq, 0
    ) + struct.pack("<B", len(segs)) + bytes(segs)
    page = header + payload
    crc = _ogg_crc(page)
    return page[:22] + struct.pack("<I", crc) + page[26:]


def _vorbis_comment_packet(comments: dict) -> bytes:
    def enc(s: str) -> bytes:
        return s.encode("utf-8")

    vendor = b"sonarly-s1-spike"
    body = struct.pack("<I", len(vendor)) + vendor
    items = []
    for k, vals in comments.items():
        for v in vals:
            items.append(enc(f"{k}={v}"))
    body += struct.pack("<I", len(items))
    for it in items:
        body += struct.pack("<I", len(it)) + it
    return b"\x03vorbis" + body + b"\x01"


def _flac_picture_block() -> bytes:
    """A FLAC PICTURE block (type 3, PNG) for METADATA_BLOCK_PICTURE."""
    data = PNG_1X1
    header = struct.pack(
        ">I", 3
    )  # type: cover front
    mime = b"image/png"
    desc = b"Cover"
    block = (
        header
        + struct.pack(">I", len(mime))
        + mime
        + struct.pack(">I", len(desc))
        + desc
        + struct.pack(">IIII", 1, 1, 24, 32)
        + struct.pack(">I", len(data))
        + data
    )
    return block


def build_ogg(path):
    serial = 0x5EED
    ident = (
        b"\x01vorbis"
        + struct.pack("<IBIiiiBB", 0, 2, SAMPLE_RATE, 128000, 128000, 128000, 0x88, 1)
    )
    comments = vorbis_comments()
    import base64 as b64

    comments["METADATA_BLOCK_PICTURE"] = [
        b64.b64encode(_flac_picture_block()).decode()
    ]
    comment_pkt = _vorbis_comment_packet(comments)
    setup = b"\x05vorbis" + bytes(range(64))
    # one dummy "audio" page so duration-from-grule is exercised
    audio_payload = b"\x00" * 64

    pages = [
        _ogg_page(ident, 0, 0, serial, 0x02),
        _ogg_page(comment_pkt, 1, 0, serial, 0x00),
        _ogg_page(setup, 2, 0, serial, 0x00),
        _ogg_page(audio_payload, 3, TOTAL_SAMPLES, serial, 0x00),
    ]
    path.write_bytes(b"".join(pages))


# --------------------------------------------------------------------- MP4

def _atom(typ: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", 8 + len(payload)) + typ + payload


def _full_atom(typ: bytes, version: int, flags: int, payload: bytes) -> bytes:
    return _atom(typ, struct.pack(">I", (version << 24) | flags) + payload)


def _data_atom(data: bytes, dtype: int = 1) -> bytes:
    # data atom: [set u8=0][well-known type u24][locale u24][value]
    # dtype 1 = UTF-8, 13 = JPEG, 14 = PNG, 0 = implicit, 21 = integer
    return _atom(b"data", struct.pack(">II", dtype, 0) + data)


def _text_item(name: bytes, value: str) -> bytes:
    return _atom(name, _data_atom(value.encode("utf-8"), 1))


def _freeform(mean: bytes, name: str, value: str) -> bytes:
    payload = (
        _atom(b"mean", struct.pack(">I", 0) + mean)
        + _atom(b"name", struct.pack(">I", 0) + name.encode("utf-8"))
        + _data_atom(value.encode("utf-8"), 1)
    )
    return _atom(b"----", payload)


def _multi_text_item(name: bytes, values: list) -> bytes:
    return b"".join(_text_item(name, v) for v in values)


def build_m4a(path):
    ilst = b"".join(
        [
            _text_item(b"\xa9nam", V["title"]),
            _multi_text_item(b"\xa9ART", V["artists"]),
            _text_item(b"aART", V["albumArtist"]),
            _text_item(b"\xa9alb", V["album"]),
            _atom(
                b"trkn",
                _data_atom(struct.pack(">xxHHH", V["track"], V["totalTracks"], 0) , 0),
            ),
            _atom(
                b"disk",
                _data_atom(struct.pack(">xxHHH", V["disc"], V["totalDiscs"], 0), 0),
            ),
            _multi_text_item(b"\xa9gen", V["genres"]),
            _text_item(b"\xa9day", V["date"]),
            _multi_text_item(b"\xa9wrt", V["composers"]),
            _text_item(b"\xa9lyr", V["lyrics"]),
            _text_item(b"\xa9cmt", V["comment"]),
            _text_item(b"\xa9too", "sonarly-s1-spike"),
            _atom(b"covr", _data_atom(PNG_1X1, 14)),
            _atom(b"cpil", _data_atom(b"\x01", 21)),
            _atom(b"rtng", _data_atom(b"\x01", 21)),
            _atom(b"tmpo", _data_atom(struct.pack(">H", V["bpm"]), 21)),
            _freeform(b"com.apple.iTunes", "MusicBrainz Track Id", V["mbidRecording"]),
            _freeform(b"com.apple.iTunes", "MusicBrainz Album Id", V["mbidRelease"]),
            _freeform(b"com.apple.iTunes", "MusicBrainz Release Group Id", V["mbidReleaseGroup"]),
            b"".join(
                _freeform(b"com.apple.iTunes", "MusicBrainz Artist Id", a)
                for a in V["mbidArtistIds"]
            ),
            _freeform(b"com.apple.iTunes", "MusicBrainz Album Artist Id", V["mbidAlbumArtistId"]),
            _freeform(b"com.apple.iTunes", "BARCODE", V["barcode"]),
            _freeform(b"com.apple.iTunes", "ASIN", V["asin"]),
            _freeform(b"com.apple.iTunes", "ISRC", V["isrc"]),
            _freeform(b"com.apple.iTunes", "PRODUCER", V["producers"][0]),
            _freeform(b"com.apple.iTunes", "LABEL", V["label"]),
            _freeform(b"com.apple.iTunes", "MusicBrainz Album Type", V["releaseType"]),
            _freeform(b"com.apple.iTunes", "replaygain_track_gain", V["rgTrack"]),
            _freeform(b"com.apple.iTunes", "replaygain_album_gain", V["rgAlbum"]),
            _freeform(b"com.apple.iTunes", "SYNCEDLYRICS", V["lrcPayload"]),
        ]
    )

    meta = _atom(
        b"meta",
        struct.pack(">I", 0)
        + _full_atom(
            b"hdlr",
            0,
            0,
            struct.pack(">I4sIII", 0, b"mdir", 0, 0, 0) + b"\x00",
        )
        + _atom(b"ilst", ilst),
    )
    udta = _atom(b"udta", meta)

    esds_payload = (
        b"\x03"
        + bytes([25])
        + struct.pack(">H", 1)  # ES_ID
        + b"\x00"  # flags
        + b"\x04"
        + bytes([13])
        + b"\x40"  # MPEG-4 AAC
        + b"\x15"  # audio stream
        + struct.pack(">I", 0)[1:]  # bufferSizeDB
        + struct.pack(">II", 128000, 128000)  # max, avg bitrate
        + b"\x05\x02\x11\x90"  # DecoderSpecificInfo (AAC LC 44.1k)
        + b"\x06\x01\x02"  # SLConfig
    )
    esds = _full_atom(b"esds", 0, 0, esds_payload)
    mp4a = _atom(
        b"mp4a",
        b"\x00" * 6
        + struct.pack(">H", 1)  # data ref
        + struct.pack(">HHI", 0, 0, 0)  # version/revision/vendor
        + struct.pack(">HHHHI", 2, 16, 0, 0, SAMPLE_RATE << 16)
        + esds,
    )
    stsd = _full_atom(b"stsd", 0, 0, struct.pack(">I", 1) + mp4a)
    stts = _full_atom(b"stts", 0, 0, struct.pack(">I", 1) + struct.pack(">II", 3, 1024))
    stsc = _full_atom(b"stsc", 0, 0, struct.pack(">IIII", 1, 1, 3, 1))
    stsz = _full_atom(b"stsz", 0, 0, struct.pack(">II", 0, 3) + struct.pack(">III", 100, 100, 100))
    stco = _full_atom(b"stco", 0, 0, struct.pack(">II", 1, 0))
    stbl = _atom(b"stbl", stsd + stts + stsc + stsz + stco)
    url = _full_atom(b"url ", 0, 1, b"")
    dref = _full_atom(b"dref", 0, 0, struct.pack(">I", 1) + url)
    dinf = _atom(b"dinf", dref)
    smhd = _full_atom(b"smhd", 0, 0, struct.pack(">HH", 0, 0))
    minf = _atom(b"minf", smhd + dinf + stbl)
    mdhd = _full_atom(
        b"mdhd",
        0,
        0,
        struct.pack(">IIIIHH", 0, 0, SAMPLE_RATE, TOTAL_SAMPLES, 0x55C4, 0),
    )
    hdlr_soun = _full_atom(
        b"hdlr", 0, 0, struct.pack(">I4sIII", 0, b"soun", 0, 0, 0) + b"\x00"
    )
    mdia = _atom(b"mdia", mdhd + hdlr_soun + minf)
    matrix = struct.pack(">9I", 0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000)
    tkhd = _full_atom(
        b"tkhd",
        0,
        3,
        struct.pack(">II", 0, 0)
        + struct.pack(">I", 1)
        + struct.pack(">I", 0)
        + struct.pack(">I", TOTAL_SAMPLES)
        + struct.pack(">II", 0, 0)
        + struct.pack(">hhhh", 0, 0, 0x0100, 0)
        + matrix
        + struct.pack(">II", 0, 0),
    )
    trak = _atom(b"trak", tkhd + mdia)
    mvhd = _full_atom(
        b"mvhd",
        0,
        0,
        struct.pack(">II", 0, 0)
        + struct.pack(">II", SAMPLE_RATE, TOTAL_SAMPLES)
        + struct.pack(">I", 0x10000)
        + struct.pack(">H", 0x0100)
        + struct.pack(">H", 0)
        + b"\x00" * 8
        + matrix
        + b"\x00" * 24
        + struct.pack(">I", 2),
    )
    moov = _atom(b"moov", mvhd + trak + udta)
    ftyp = _atom(
        b"ftyp", b"M4A " + struct.pack(">I", 0) + b"M4A mp42isom"
    )
    mdat = _atom(b"mdat", b"\x00" * 300)
    path.write_bytes(ftyp + mdat + moov)


def build_pathological(path):
    """ID3v1-only MP3 with Latin-1 high bytes (non-UTF8) in title/artist."""

    def field(s: bytes) -> bytes:
        return s[:30].ljust(30, b"\x00")

    title = "Café naïve".encode("latin-1")  # b'Caf\xe9 na\xefve'
    artist = b"Bj\xf6rk \x86 stray \xff"  # high bytes incl. 0xD6, 0x86, 0xFF
    album = "Séance".encode("latin-1")
    tag = (
        b"TAG"
        + field(title)
        + field(artist)
        + field(album)
        + b"1999"
        + field(b"Comment with \xe9 accent")
        + bytes([13])  # genre: Pop
    )
    path.write_bytes(mp3_frame_stream() + tag)


def main():
    CORPUS.mkdir(exist_ok=True)
    build_mp3(CORPUS / "spike.mp3")
    build_flac(CORPUS / "spike.flac")
    build_ogg(CORPUS / "spike.ogg")
    build_m4a(CORPUS / "spike.m4a")
    build_pathological(CORPUS / "pathological-id3v1.mp3")

    manifest = {
        "values": V,
        "formatExpectations": {
            "spike.mp3": {"sampleRate": SAMPLE_RATE, "channels": 2,
                          "bitRate": 128000, "durationApprox": DURATION_SEC},
            "spike.flac": {"sampleRate": SAMPLE_RATE, "channels": 2,
                           "bitsPerSample": 16, "durationApprox": DURATION_SEC},
            "spike.ogg": {"sampleRate": SAMPLE_RATE, "channels": 2,
                          "bitRate": 128000, "durationApprox": DURATION_SEC},
            "spike.m4a": {"sampleRate": SAMPLE_RATE, "channels": 2,
                          "bitRate": 128000, "durationApprox": DURATION_SEC},
        },
    }
    (HERE / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print("corpus written to", CORPUS)
    for p in sorted(CORPUS.iterdir()):
        print(f"  {p.name}: {p.stat().st_size} bytes")


if __name__ == "__main__":
    main()
