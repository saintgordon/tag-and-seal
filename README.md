# Tag & Seal — Saint Gordon Collective (`TOOL / 004`)

**100% in-browser, bit-for-bit lossless audio metadata and cover art studio for WAV, MP3, and FLAC.**

**Live App:** https://saintgordon.github.io/tag-and-seal/

Tag & Seal reads and writes release tags, musical attributes (BPM, Key/Camelot, ISRC), lyrics, and embedded cover artwork straight inside your browser — with **zero audio re-encoding**, zero server uploads, zero build step, and zero runtime dependencies.

---

## Supported Formats & Lossless Architecture

| Format | Tags Written | Cover Art Block | Preserved Stream & Chunks |
| --- | --- | --- | --- |
| **WAV (`.wav`)** | RIFF `LIST(INFO)` + RIFF `id3 ` (**ID3v2.3**, UTF-16LE/ASCII) | `APIC` inside RIFF `id3 ` | `fmt `, `data`, `bext`, `iXML`, `smpl`, `cue `, unknown INFO subchunks — exact 2-byte chunk alignment |
| **MP3 (`.mp3`)** | Reads ID3v2.2 / v2.3 / v2.4 + ID3v1; writes universal **ID3v2.3** | `APIC` (JPEG / PNG) | 100% untouched MPEG audio frames (including Xing/LAME headers) |
| **FLAC (`.flac`)** | Native `VORBIS_COMMENT` (UTF-8 uppercase pairs) | Native `PICTURE` block (type 6) | `STREAMINFO`, `SEEKTABLE`, `CUESHEET`, `APPLICATION`, unknown Vorbis tags, and untouched FLAC audio frames |

Every sealed file is automatically verified in-browser before download by comparing an FNV-1a binary checksum of the raw audio payload before and after tagging.

---

## Features

- **Cover Art Studio**:
  - Drag & drop JPG, PNG, WebP, GIF, or BMP (auto-converts WebP/GIF/BMP to JPEG/PNG for universal playback across macOS Finder, Apple Music, Windows Explorer, Rekordbox, Serato, Traktor, VLC, and Android).
  - Square release presets (`Keep Original`, `1400 × 1400 px`, `3000 × 3000 px`, `800 × 800 px`) and JPEG/PNG export format toggle.
  - **1-Click Saint Gordon Xerox Filter**: applies Rec.709 luminance midtone-gated 1-bit toner grain (`threshold 105`, `grain 60`) with instant revert to original artwork.
  - Extract / download existing embedded cover artwork in one click.
- **Key Track Info & Musical Metadata**:
  - Title, Lead Artist, Album Artist, Album / Single, Year / Release Date, Track #, Genre (with autocomplete suggestions), BPM, Musical Key (all 24 keys paired with Camelot notation + free text), ISRC (with format validation), Label / Publisher, Composer / Producer, Copyright, and Comment.
  - Optional WAV **Sync RIFF INFO & ID3v2** toggle (ON by default).
- **Collapsible Studio Drawers**:
  - **Unsynced Lyrics (`USLT` / `LYRICS`)** with live line & word counter.
  - **Extended Credits & Links**: Subtitle / Mix Version, Lyricist, Disc #, Mood, Engineer, Encoded By, Official Artist URL, Software.
  - **Technical Inspector**: Container specs, sample rate, bit depth/bitrate, channels, duration, detected chunks/blocks, and raw audio stream checksum.
- **Live Audio Preview Bar**: Audition your loaded master directly inside the Seal Deck so you always tag the right file.

---

## Local Development & Automated Tests

Because Tag & Seal is pure vanilla HTML, CSS, and ES Modules with zero build tooling, serve it with any static HTTP server:

```bash
python3 -m http.server 8080
# Open http://localhost:8080
```

Run the pure-JS binary round-trip test suite (requires Node.js 18+):

```bash
node --test tests/metadata-engine.test.mjs
```

---

## Cross-Browser Support

Built strictly on standard Web Platform APIs (`ArrayBuffer`, `Uint8Array`, `DataView`, `TextEncoder`/`TextDecoder`, Canvas 2D, `Blob`, HTML5 `<audio>`, ES Modules):

- Chrome / Chromium / Brave / Arc
- Safari (macOS & iOS Safari)
- Firefox
- Microsoft Edge

---

Part of the **Saint Gordon Collective** — [saintgordon.vercel.app](https://saintgordon.vercel.app) · [The Collection](https://saintgordon.vercel.app/collection.html)
