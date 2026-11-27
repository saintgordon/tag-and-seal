/**
 * Tag & Seal — Pure-JS Lossless Binary Metadata Engine
 * Zero DOM dependencies (runs identically in modern browsers and Node.js).
 *
 * Bit-for-bit lossless container read/write for:
 *  - WAV (.wav): RIFF LIST(INFO) + RIFF `id3 ` (ID3v2.3 + APIC) while preserving
 *                `fmt `, `data`, `bext`, `iXML`, `smpl`, `cue `, and all other chunks.
 *  - MP3 (.mp3): Reads ID3v2.2 / ID3v2.3 / ID3v2.4 + ID3v1 fallback; inspects MPEG
 *                audio frame header; writes clean ID3v2.3 header + untouched MPEG bytes.
 *  - FLAC (.flac): Reads & writes `VORBIS_COMMENT` + `PICTURE` metadata blocks while
 *                  preserving `STREAMINFO`, `SEEKTABLE`, `CUESHEET`, `APPLICATION`,
 *                  and untouched FLAC audio frames.
 */

const textEncoder = new TextEncoder();
const textDecoderUtf8 = new TextDecoder('utf-8', { fatal: false });

export const PICTURE_TYPES = [
  { code: 3, label: 'Front Cover' },
  { code: 4, label: 'Back Cover' },
  { code: 8, label: 'Artist / Performer' },
  { code: 5, label: 'Leaflet / Booklet' },
  { code: 6, label: 'Media / Disc Label' },
  { code: 7, label: 'Lead Artist' },
  { code: 10, label: 'Band / Orchestra' },
  { code: 11, label: 'Composer' },
  { code: 19, label: 'Band / Artist Logo' },
  { code: 20, label: 'Publisher / Label Logo' },
  { code: 0, label: 'Other' },
];

// Standard ID3v1 / Winamp genre list for decoding numeric TCON references like "(17)"
const ID3V1_GENRES = [
  'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop',
  'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock',
  'Techno', 'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack',
  'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance',
  'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise',
  'Alternative Rock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop',
  'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial', 'Electronic',
  'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta', 'Top 40',
  'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave',
  'Psychedelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk',
  'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock', 'Folk',
  'Folk-Rock', 'National Folk', 'Swing', 'Fast Fusion', 'Bebop', 'Latin', 'Revival',
  'Celtic', 'Bluegrass', 'Avantgarde', 'Gothic Rock', 'Progressive Rock',
  'Psychedelic Rock', 'Symphonic Rock', 'Slow Rock', 'Big Band', 'Chorus',
  'Easy Listening', 'Acoustic', 'Humour', 'Speech', 'Chanson', 'Opera', 'Chamber Music',
  'Sonata', 'Symphony', 'Booty Bass', 'Primus', 'Porn Groove', 'Satire', 'Slow Jam',
  'Club', 'Tango', 'Samba', 'Folklore', 'Ballad', 'Power Ballad', 'Rhythmic Soul',
  'Freestyle', 'Duet', 'Punk Rock', 'Drum Solo', 'A Cappella', 'Euro-House', 'Dance Hall',
  'Goa', 'Drum & Bass', 'Club-House', 'Hardcore Techno', 'Terror', 'Indie', 'BritPop',
  'Negerpunk', 'Polsk Punk', 'Beat', 'Christian Gangsta Rap', 'Heavy Metal', 'Black Metal',
  'Crossover', 'Contemporary Christian', 'Christian Rock', 'Merengue', 'Salsa',
  'Thrash Metal', 'Anime', 'Jpop', 'Synthpop', 'Abstract', 'Art Rock', 'Baroque',
  'Bhangra', 'Big Beat', 'Breakbeat', 'Chillout', 'Downtempo', 'Dub', 'EBM', 'Eclectic',
  'Electro', 'Electroclash', 'Emo', 'Experimental', 'Garage', 'Global', 'IDM', 'Illbient',
  'Industro-Goth', 'Jam Band', 'Krautrock', 'Leftfield', 'Lounge', 'Math Rock',
  'New Romantic', 'Nu-Breakz', 'Post-Punk', 'Post-Rock', 'Psytrance', 'Shoegaze',
  'Space Rock', 'Trop Rock', 'World Music', 'Neoclassical', 'Audiobook', 'Audio Theatre',
  'Neue Deutsche Welle', 'Podcast', 'Indie Rock', 'G-Funk', 'Dubstep', 'Garage Rock',
  'Psybient',
];

const RIFF_AUDIO_FORMAT_NAMES = {
  0x0001: 'PCM',
  0x0003: 'IEEE Float',
  0x0006: 'A-Law',
  0x0007: 'Mu-Law',
  0xfffe: 'WaveFormatExtensible',
};

const KNOWN_RIFF_INFO_KEYS = [
  'INAM', 'IART', 'IPRD', 'ICRD', 'IGNR', 'ITRK',
  'ICMT', 'ICOP', 'IENG', 'ISFT', 'ISRC',
];

const KNOWN_RIFF_INFO_SET = new Set(KNOWN_RIFF_INFO_KEYS);

const KNOWN_VORBIS_KEYS = new Set([
  'TITLE', 'ARTIST', 'ALBUMARTIST', 'ALBUM ARTIST', 'ALBUM', 'DATE', 'YEAR',
  'TRACKNUMBER', 'TRACKTOTAL', 'TOTALTRACKS', 'DISCNUMBER', 'DISCTOTAL', 'TOTALDISCS',
  'GENRE', 'BPM', 'TEMPO', 'INITIALKEY', 'KEY', 'ISRC', 'COMPOSER', 'LYRICIST',
  'ORGANIZATION', 'PUBLISHER', 'LABEL', 'COPYRIGHT', 'COMMENT', 'DESCRIPTION',
  'LYRICS', 'UNSYNCEDLYRICS', 'MOOD', 'ENGINEER', 'ENCODED-BY', 'ENCODEDBY',
  'ENCODER', 'SOFTWARE', 'SUBTITLE', 'VERSION', 'WEBSITE', 'URL',
]);

// ============================================================================
// Binary & String Utilities
// ============================================================================

export function createEmptyTags() {
  return {
    title: '',
    artist: '',
    albumArtist: '',
    album: '',
    year: '',
    track: '',
    genre: '',
    bpm: '',
    key: '',
    isrc: '',
    publisher: '',
    composer: '',
    copyright: '',
    comment: '',
    subtitle: '',
    lyricist: '',
    disc: '',
    mood: '',
    engineer: '',
    encodedBy: '',
    software: '',
    artistUrl: '',
    lyrics: '',
    lyricsLanguage: 'eng',
  };
}

function toUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError('Expected Uint8Array or ArrayBuffer.');
}

function concatBytes(arrays) {
  let total = 0;
  for (const arr of arrays) {
    if (arr && arr.length) total += arr.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    if (arr && arr.length) {
      out.set(arr, offset);
      offset += arr.length;
    }
  }
  return out;
}

function readAscii(bytes, offset, length) {
  let str = '';
  const end = Math.min(bytes.length, offset + length);
  for (let i = offset; i < end; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return str;
}

function writeAscii(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    out[i] = str.charCodeAt(i) & 0x7f;
  }
  return out;
}

function writeLatin1(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    out[i] = str.charCodeAt(i) & 0xff;
  }
  return out;
}

function isPureAscii(str) {
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

function encodeUtf16LeWithBom(str) {
  const out = new Uint8Array(2 + str.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    out[2 + i * 2] = code & 0xff;
    out[2 + i * 2 + 1] = (code >>> 8) & 0xff;
  }
  return out;
}

function decodeLatin1(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  let str = '';
  for (let i = 0; i < end; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return str;
}

function decodeUtf16(bytes, defaultLittleEndian = true) {
  if (bytes.length < 2) return '';
  let offset = 0;
  let le = defaultLittleEndian;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    le = true;
    offset = 2;
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    le = false;
    offset = 2;
  }
  const codes = [];
  for (let i = offset; i + 1 < bytes.length; i += 2) {
    const code = le ? (bytes[i] | (bytes[i + 1] << 8)) : ((bytes[i] << 8) | bytes[i + 1]);
    codes.push(code);
  }
  while (codes.length > 0 && codes[codes.length - 1] === 0) {
    codes.pop();
  }
  // Build in chunks to avoid call stack limits for long lyrics
  let out = '';
  const CHUNK = 4096;
  for (let i = 0; i < codes.length; i += CHUNK) {
    out += String.fromCharCode(...codes.slice(i, i + CHUNK));
  }
  return out;
}

function decodeUtf8TrimNull(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return textDecoderUtf8.decode(bytes.subarray(0, end));
}

function decodeId3Text(bytes, encoding) {
  if (!bytes || bytes.length === 0) return '';
  switch (encoding) {
    case 0:
      return decodeLatin1(bytes);
    case 1:
      return decodeUtf16(bytes, true);
    case 2:
      return decodeUtf16(bytes, false);
    case 3:
      return decodeUtf8TrimNull(bytes);
    default:
      return decodeUtf8TrimNull(bytes);
  }
}

/**
 * Find null terminator index respecting 1-byte (ISO-8859-1 / UTF-8) vs
 * 2-byte aligned (UTF-16 / UTF-16BE) encodings.
 * Returns { end, next } where `end` is exclusive end of string and `next` is start of next field.
 */
function findNullTerminator(bytes, start, encoding) {
  if (encoding === 1 || encoding === 2) {
    for (let i = start; i + 1 < bytes.length; i += 2) {
      if (bytes[i] === 0x00 && bytes[i + 1] === 0x00) {
        return { end: i, next: i + 2 };
      }
    }
    return { end: bytes.length, next: bytes.length };
  }
  for (let i = start; i < bytes.length; i++) {
    if (bytes[i] === 0x00) {
      return { end: i, next: i + 1 };
    }
  }
  return { end: bytes.length, next: bytes.length };
}

function readU32BE(bytes, offset) {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>> 0
  );
}

function readU32LE(bytes, offset) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>> 0
  );
}

function readU16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU16BE(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU24BE(bytes, offset) {
  return (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
}

function writeU32BE(val) {
  return new Uint8Array([
    (val >>> 24) & 0xff,
    (val >>> 16) & 0xff,
    (val >>> 8) & 0xff,
    val & 0xff,
  ]);
}

function writeU32LE(val) {
  return new Uint8Array([
    val & 0xff,
    (val >>> 8) & 0xff,
    (val >>> 16) & 0xff,
    (val >>> 24) & 0xff,
  ]);
}

function readSyncsafe32(bytes, offset) {
  return (
    (((bytes[offset] & 0x7f) << 21) |
      ((bytes[offset + 1] & 0x7f) << 14) |
      ((bytes[offset + 2] & 0x7f) << 7) |
      (bytes[offset + 3] & 0x7f)) >>> 0
  );
}

function writeSyncsafe32(val) {
  return new Uint8Array([
    (val >>> 21) & 0x7f,
    (val >>> 14) & 0x7f,
    (val >>> 7) & 0x7f,
    val & 0x7f,
  ]);
}

function removeUnsync(bytes) {
  const out = new Uint8Array(bytes.length);
  let j = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[j++] = bytes[i];
    if (bytes[i] === 0xff && i + 1 < bytes.length && bytes[i + 1] === 0x00) {
      i++;
    }
  }
  return out.subarray(0, j);
}

function decodeRiffString(raw) {
  let end = raw.length;
  while (end > 0 && raw[end - 1] === 0) end--;
  const trimmed = raw.subarray(0, end);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(trimmed);
  } catch {
    return decodeLatin1(trimmed);
  }
}

// ============================================================================
// Pure-JS Image Header Inspector (PNG, JPEG, GIF, WebP, BMP)
// ============================================================================

export function inspectImageBytes(input, fallbackMime = 'image/jpeg') {
  const bytes = toUint8Array(input);
  let mime = normalizeMime(fallbackMime);
  let width = 0;
  let height = 0;

  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    mime = 'image/png';
    if (readAscii(bytes, 12, 4) === 'IHDR') {
      width = readU32BE(bytes, 16);
      height = readU32BE(bytes, 20);
    }
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    mime = 'image/jpeg';
    let pos = 2;
    while (pos < bytes.length) {
      while (pos < bytes.length && bytes[pos] === 0xff) pos++;
      if (pos >= bytes.length) break;
      const marker = bytes[pos++];
      // Standalone markers without length
      if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (pos + 2 > bytes.length) break;
      const segLen = readU16BE(bytes, pos);
      if (segLen < 2 || pos + segLen > bytes.length) break;
      // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof && segLen >= 7) {
        height = readU16BE(bytes, pos + 3);
        width = readU16BE(bytes, pos + 5);
        break;
      }
      pos += segLen;
    }
  } else if (
    bytes.length >= 10 &&
    (readAscii(bytes, 0, 6) === 'GIF87a' || readAscii(bytes, 0, 6) === 'GIF89a')
  ) {
    mime = 'image/gif';
    width = readU16LE(bytes, 6);
    height = readU16LE(bytes, 8);
  } else if (
    bytes.length >= 30 &&
    readAscii(bytes, 0, 4) === 'RIFF' &&
    readAscii(bytes, 8, 4) === 'WEBP'
  ) {
    mime = 'image/webp';
    const chunk = readAscii(bytes, 12, 4);
    if (chunk === 'VP8X' && bytes.length >= 30) {
      width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    } else if (chunk === 'VP8 ' && bytes.length >= 30) {
      width = readU16LE(bytes, 26) & 0x3fff;
      height = readU16LE(bytes, 28) & 0x3fff;
    } else if (chunk === 'VP8L' && bytes.length >= 25) {
      const bits = readU32LE(bytes, 21);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
  } else if (bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    mime = 'image/bmp';
    width = readU32LE(bytes, 18);
    height = Math.abs(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(22, true));
  }

  return {
    mime,
    width,
    height,
    formatLabel: mimeToFormatLabel(mime),
  };
}

function normalizeMime(mime) {
  const m = (mime || '').trim().toLowerCase();
  if (!m || m === 'jpg' || m === 'jpeg' || m === 'image/jpg') return 'image/jpeg';
  if (m === 'png' || m === 'image/png') return 'image/png';
  if (m === 'gif' || m === 'image/gif') return 'image/gif';
  if (m === 'webp' || m === 'image/webp') return 'image/webp';
  return m.includes('/') ? m : `image/${m}`;
}

function mimeToFormatLabel(mime) {
  const m = (mime || '').toLowerCase();
  if (m.includes('png')) return 'PNG';
  if (m.includes('jpeg') || m.includes('jpg')) return 'JPEG';
  if (m.includes('webp')) return 'WEBP';
  if (m.includes('gif')) return 'GIF';
  return (m.split('/')[1] || 'IMG').toUpperCase();
}

// ============================================================================
// ID3v2 Parser (v2.2 / v2.3 / v2.4) & ID3v2.3 Serializer
// ============================================================================

const ID3V22_TO_V23 = {
  TT2: 'TIT2',
  TP1: 'TPE1',
  TP2: 'TPE2',
  TAL: 'TALB',
  TT3: 'TIT3',
  TYE: 'TYER',
  TDA: 'TDAT',
  TRK: 'TRCK',
  TPA: 'TPOS',
  TCO: 'TCON',
  TBP: 'TBPM',
  TKE: 'TKEY',
  TRC: 'TSRC',
  TPB: 'TPUB',
  TCM: 'TCOM',
  TXT: 'TEXT',
  TCR: 'TCOP',
  TEN: 'TENC',
  TSS: 'TSSE',
  TXX: 'TXXX',
  COM: 'COMM',
  ULT: 'USLT',
  WAR: 'WOAR',
  PIC: 'PIC',
};

function decodeId3Genre(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  // Pattern "(17)" or "(17)Alternative"
  const match = /^\((\d+)\)(.*)$/.exec(trimmed);
  if (match) {
    const idx = parseInt(match[1], 10);
    const trailing = match[2].trim();
    if (trailing) return trailing;
    if (idx >= 0 && idx < ID3V1_GENRES.length) return ID3V1_GENRES[idx];
  }
  if (/^\d+$/.test(trimmed)) {
    const idx = parseInt(trimmed, 10);
    if (idx >= 0 && idx < ID3V1_GENRES.length) return ID3V1_GENRES[idx];
  }
  return trimmed;
}

function isLikelyFrameId(bytes, offset) {
  if (offset + 4 > bytes.length) return false;
  if (bytes[offset] === 0) return true; // padding
  for (let i = 0; i < 4; i++) {
    const c = bytes[offset + i];
    const ok = (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39); // A-Z 0-9
    if (!ok) return false;
  }
  return true;
}

/**
 * Parse an ID3v2 tag starting at byte 0 of `bytes`.
 * Returns null if `bytes` does not begin with `'ID3'`.
 */
export function parseId3v2(input) {
  const bytes = toUint8Array(input);
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return null;
  }
  const major = bytes[3];
  const minor = bytes[4];
  const flags = bytes[5];
  const tagSize = readSyncsafe32(bytes, 6);
  const hasUnsync = (flags & 0x80) !== 0;
  const hasExtHeader = (flags & 0x40) !== 0;
  const hasFooter = major === 4 && (flags & 0x10) !== 0;
  const totalSpan = Math.min(bytes.length, 10 + tagSize + (hasFooter ? 10 : 0));

  let body = bytes.subarray(10, Math.min(bytes.length, 10 + tagSize));
  if (hasUnsync && major < 4) {
    body = removeUnsync(body);
  }

  let pos = 0;
  if (hasExtHeader && body.length >= 4) {
    if (major === 3) {
      const extSize = readU32BE(body, 0);
      pos = Math.min(body.length, 4 + extSize);
    } else if (major === 4) {
      const extSize = readSyncsafe32(body, 0);
      pos = Math.min(body.length, Math.max(4, extSize));
    }
  }

  const tags = createEmptyTags();
  const artworks = [];
  let tyer = '';
  let tdat = '';
  let tdrc = '';
  let fallbackComment = '';

  const headerSize = major === 2 ? 6 : 10;

  while (pos + headerSize <= body.length) {
    if (body[pos] === 0x00) break; // Padding reached

    let frameId;
    let frameSize;
    let frameFlags1 = 0;

    if (major === 2) {
      const rawId = readAscii(body, pos, 3);
      if (!/^[A-Z0-9]{3}$/.test(rawId)) break;
      frameId = ID3V22_TO_V23[rawId] || rawId;
      frameSize = readU24BE(body, pos + 3);
      pos += 6;
    } else {
      frameId = readAscii(body, pos, 4);
      if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

      if (major === 4) {
        const b0 = body[pos + 4];
        const b1 = body[pos + 5];
        const b2 = body[pos + 6];
        const b3 = body[pos + 7];
        const hasHighBit = ((b0 | b1 | b2 | b3) & 0x80) !== 0;
        const ssSize = readSyncsafe32(body, pos + 4);
        const beSize = readU32BE(body, pos + 4);
        if (hasHighBit) {
          frameSize = beSize;
        } else if (
          ssSize !== beSize &&
          pos + 10 + beSize <= body.length &&
          isLikelyFrameId(body, pos + 10 + beSize) &&
          !(pos + 10 + ssSize <= body.length && isLikelyFrameId(body, pos + 10 + ssSize))
        ) {
          // Graceful fallback for non-compliant v2.4 encoders that wrote BE frame sizes
          frameSize = beSize;
        } else {
          frameSize = ssSize;
        }
      } else {
        // ID3v2.3: standard big-endian uint32 (NEVER syncsafe)
        frameSize = readU32BE(body, pos + 4);
      }

      frameFlags1 = body[pos + 9];
      pos += 10;
    }

    if (frameSize <= 0 || pos + frameSize > body.length) {
      // Clamp final truncated frame or stop
      if (frameSize <= 0) break;
      frameSize = body.length - pos;
    }

    let payload = body.subarray(pos, pos + frameSize);
    pos += frameSize;

    // Handle ID3v2.3 / v2.4 frame-level flags
    if (major === 3) {
      const compressed = (frameFlags1 & 0x80) !== 0;
      const encrypted = (frameFlags1 & 0x40) !== 0;
      const hasGroup = (frameFlags1 & 0x20) !== 0;
      if (compressed || encrypted) continue;
      if (hasGroup && payload.length > 1) payload = payload.subarray(1);
    } else if (major === 4) {
      const hasGroup = (frameFlags1 & 0x40) !== 0;
      const compressed = (frameFlags1 & 0x08) !== 0;
      const encrypted = (frameFlags1 & 0x04) !== 0;
      const frameUnsync = hasUnsync || (frameFlags1 & 0x02) !== 0;
      const hasDataLen = (frameFlags1 & 0x01) !== 0;
      if (compressed || encrypted) continue;
      if (hasGroup && payload.length > 1) payload = payload.subarray(1);
      if (frameUnsync) payload = removeUnsync(payload);
      if (hasDataLen && payload.length >= 4) payload = payload.subarray(4);
    }

    if (payload.length === 0) continue;

    // Decode frames
    if (frameId === 'PIC') {
      // ID3v2.2 Picture frame: encoding(1) + imgFormat(3) + picType(1) + desc(null-term) + data
      if (payload.length < 6) continue;
      const enc = payload[0];
      const fmt3 = readAscii(payload, 1, 3).toUpperCase();
      const picType = payload[4];
      const { end: descEnd, next: dataStart } = findNullTerminator(payload, 5, enc);
      const description = decodeId3Text(payload.subarray(5, descEnd), enc);
      const imgBytes = payload.slice(dataStart);
      if (imgBytes.length > 0) {
        const mimeHint = fmt3 === 'PNG' ? 'image/png' : fmt3 === 'GIF' ? 'image/gif' : 'image/jpeg';
        const info = inspectImageBytes(imgBytes, mimeHint);
        artworks.push({
          data: imgBytes,
          mime: info.mime,
          picType,
          description,
          width: info.width,
          height: info.height,
        });
      }
    } else if (frameId === 'APIC') {
      if (payload.length < 4) continue;
      const enc = payload[0];
      const { end: mimeEnd, next: picTypePos } = findNullTerminator(payload, 1, 0);
      if (picTypePos >= payload.length) continue;
      const rawMime = decodeLatin1(payload.subarray(1, mimeEnd));
      const picType = payload[picTypePos];
      const { end: descEnd, next: dataStart } = findNullTerminator(payload, picTypePos + 1, enc);
      const description = decodeId3Text(payload.subarray(picTypePos + 1, descEnd), enc);
      const imgBytes = payload.slice(dataStart);
      if (imgBytes.length > 0) {
        const info = inspectImageBytes(imgBytes, rawMime || 'image/jpeg');
        artworks.push({
          data: imgBytes,
          mime: info.mime,
          picType,
          description,
          width: info.width,
          height: info.height,
        });
      }
    } else if (frameId === 'COMM') {
      if (payload.length < 5) continue;
      const enc = payload[0];
      const { end: descEnd, next: textStart } = findNullTerminator(payload, 4, enc);
      const desc = decodeId3Text(payload.subarray(4, descEnd), enc).trim();
      const text = decodeId3Text(payload.subarray(textStart), enc).trim();
      if (!text) continue;
      // Ignore Apple SoundCheck/Gapless internal comment payloads
      if (/^iTun/i.test(desc) || /^iTunes_/i.test(desc)) continue;
      if (desc === '' && !tags.comment) {
        tags.comment = text;
      } else if (!fallbackComment) {
        fallbackComment = text;
      }
    } else if (frameId === 'USLT') {
      if (payload.length < 5) continue;
      const enc = payload[0];
      const lang = readAscii(payload, 1, 3).replace(/[^a-zA-Z]/g, '') || 'eng';
      const { next: textStart } = findNullTerminator(payload, 4, enc);
      const lyrics = decodeId3Text(payload.subarray(textStart), enc);
      if (lyrics && !tags.lyrics) {
        tags.lyrics = lyrics;
        tags.lyricsLanguage = lang.toLowerCase();
      }
    } else if (frameId === 'WOAR') {
      // W*** frames (except WXXX) have NO text encoding byte
      const url = decodeLatin1(payload).trim();
      if (url && !tags.artistUrl) tags.artistUrl = url;
    } else if (frameId === 'TXXX') {
      const enc = payload[0];
      const { end: descEnd, next: valStart } = findNullTerminator(payload, 1, enc);
      const desc = decodeId3Text(payload.subarray(1, descEnd), enc).trim().toUpperCase();
      const val = decodeId3Text(payload.subarray(valStart), enc).trim();
      if (!val) continue;
      if (desc === 'ENGINEER' && !tags.engineer) tags.engineer = val;
      else if (desc === 'MOOD' && !tags.mood) tags.mood = val;
      else if ((desc === 'INITIALKEY' || desc === 'KEY') && !tags.key) tags.key = val;
      else if (desc === 'SUBTITLE' && !tags.subtitle) tags.subtitle = val;
    } else if (frameId.startsWith('T')) {
      const enc = payload[0];
      const rawVal = decodeId3Text(payload.subarray(1), enc);
      // ID3v2.4 may separate multi-values with \0
      const val = rawVal.split('\0').map((s) => s.trim()).filter(Boolean).join(' / ');
      if (!val) continue;
      switch (frameId) {
        case 'TIT2': tags.title = val; break;
        case 'TPE1': tags.artist = val; break;
        case 'TPE2': tags.albumArtist = val; break;
        case 'TALB': tags.album = val; break;
        case 'TIT3': tags.subtitle = val; break;
        case 'TDRC': tdrc = val; break;
        case 'TYER': tyer = val; break;
        case 'TDAT': tdat = val; break;
        case 'TRCK': tags.track = val; break;
        case 'TPOS': tags.disc = val; break;
        case 'TCON': tags.genre = decodeId3Genre(val); break;
        case 'TBPM': tags.bpm = val; break;
        case 'TKEY': tags.key = val; break;
        case 'TSRC': tags.isrc = val; break;
        case 'TPUB': tags.publisher = val; break;
        case 'TCOM': tags.composer = val; break;
        case 'TEXT': tags.lyricist = val; break;
        case 'TCOP': tags.copyright = val; break;
        case 'TENC': tags.encodedBy = val; break;
        case 'TSSE': tags.software = val; break;
        case 'TMOO': tags.mood = val; break;
        default: break;
      }
    }
  }

  if (!tags.comment && fallbackComment) {
    tags.comment = fallbackComment;
  }

  // Reconstruct Year / Date from TDRC or TYER + TDAT
  if (tdrc) {
    tags.year = tdrc;
  } else if (tyer) {
    if (tdat && /^\d{4}$/.test(tdat) && /^\d{4}$/.test(tyer)) {
      const dd = tdat.slice(0, 2);
      const mm = tdat.slice(2, 4);
      tags.year = `${tyer}-${mm}-${dd}`;
    } else {
      tags.year = tyer;
    }
  }

  return {
    version: `ID3v2.${major}`,
    major,
    minor,
    totalSpan,
    tags,
    artworks,
  };
}

function encodeId3v23Field(str) {
  if (isPureAscii(str)) {
    return {
      encoding: 0x00,
      bytes: writeAscii(str),
      terminator: new Uint8Array([0x00]),
    };
  }
  return {
    encoding: 0x01,
    bytes: encodeUtf16LeWithBom(str),
    terminator: new Uint8Array([0x00, 0x00]),
  };
}

function buildId3v23Frame(frameId, payload) {
  const header = new Uint8Array(10);
  for (let i = 0; i < 4; i++) header[i] = frameId.charCodeAt(i) & 0x7f;
  // ID3v2.3 frame size is ALWAYS standard big-endian uint32 (NOT syncsafe)
  const sizeBytes = writeU32BE(payload.length);
  header.set(sizeBytes, 4);
  header[8] = 0x00;
  header[9] = 0x00;
  return concatBytes([header, payload]);
}

function buildId3v23TextFrame(frameId, text) {
  const val = (text || '').trim();
  if (!val) return null;
  const enc = encodeId3v23Field(val);
  const payload = concatBytes([new Uint8Array([enc.encoding]), enc.bytes]);
  return buildId3v23Frame(frameId, payload);
}

function buildId3v23TxxxFrame(desc, value) {
  const v = (value || '').trim();
  if (!v) return null;
  const ascii = isPureAscii(desc) && isPureAscii(v);
  if (ascii) {
    const payload = concatBytes([
      new Uint8Array([0x00]),
      writeAscii(desc),
      new Uint8Array([0x00]),
      writeAscii(v),
    ]);
    return buildId3v23Frame('TXXX', payload);
  }
  const payload = concatBytes([
    new Uint8Array([0x01]),
    encodeUtf16LeWithBom(desc),
    new Uint8Array([0x00, 0x00]),
    encodeUtf16LeWithBom(v),
  ]);
  return buildId3v23Frame('TXXX', payload);
}

function buildId3v23LangDescTextFrame(frameId, lang, desc, text) {
  const v = text || '';
  if (!v.trim()) return null;
  const cleanLang = ((lang || 'eng').replace(/[^a-zA-Z]/g, '').toLowerCase() + 'eng').slice(0, 3);
  const ascii = isPureAscii(desc) && isPureAscii(v);
  if (ascii) {
    const payload = concatBytes([
      new Uint8Array([0x00]),
      writeAscii(cleanLang),
      writeAscii(desc),
      new Uint8Array([0x00]),
      writeAscii(v),
    ]);
    return buildId3v23Frame(frameId, payload);
  }
  const payload = concatBytes([
    new Uint8Array([0x01]),
    writeAscii(cleanLang),
    encodeUtf16LeWithBom(desc),
    new Uint8Array([0x00, 0x00]),
    encodeUtf16LeWithBom(v),
  ]);
  return buildId3v23Frame(frameId, payload);
}

function buildId3v23ApicFrame(art) {
  if (!art || !art.data || art.data.length === 0) return null;
  const imgBytes = toUint8Array(art.data);
  const mime = normalizeMime(art.mime || inspectImageBytes(imgBytes).mime);
  const picType = Number.isInteger(art.picType) ? art.picType & 0xff : 3;
  const desc = art.description || '';
  const descEnc = encodeId3v23Field(desc);

  const payload = concatBytes([
    new Uint8Array([descEnc.encoding]),
    writeAscii(mime),
    new Uint8Array([0x00]),
    new Uint8Array([picType]),
    descEnc.bytes,
    descEnc.terminator,
    imgBytes,
  ]);
  return buildId3v23Frame('APIC', payload);
}

/**
 * Serialize canonical tags + artworks into a universally compatible ID3v2.3 tag block.
 * Returns null if no frames are emitted.
 */
export function buildId3v23(tags, artworks = []) {
  const t = { ...createEmptyTags(), ...(tags || {}) };
  const frames = [];
  const push = (f) => {
    if (f) frames.push(f);
  };

  push(buildId3v23TextFrame('TIT2', t.title));
  push(buildId3v23TextFrame('TPE1', t.artist));
  push(buildId3v23TextFrame('TPE2', t.albumArtist));
  push(buildId3v23TextFrame('TALB', t.album));
  push(buildId3v23TextFrame('TIT3', t.subtitle));

  // Year / Date in strict ID3v2.3: TYER (YYYY) + optional TDAT (DDMM)
  const yearStr = (t.year || '').trim();
  if (yearStr) {
    const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yearStr);
    if (isoDate) {
      push(buildId3v23TextFrame('TYER', isoDate[1]));
      push(buildId3v23TextFrame('TDAT', `${isoDate[3]}${isoDate[2]}`));
    } else {
      const yearOnly = /^(\d{4})/.exec(yearStr);
      push(buildId3v23TextFrame('TYER', yearOnly ? yearOnly[1] : yearStr));
    }
  }

  push(buildId3v23TextFrame('TRCK', t.track));
  push(buildId3v23TextFrame('TPOS', t.disc));
  push(buildId3v23TextFrame('TCON', t.genre));
  push(buildId3v23TextFrame('TBPM', t.bpm));
  push(buildId3v23TextFrame('TKEY', t.key));
  push(buildId3v23TextFrame('TSRC', t.isrc));
  push(buildId3v23TextFrame('TPUB', t.publisher));
  push(buildId3v23TextFrame('TCOM', t.composer));
  push(buildId3v23TextFrame('TEXT', t.lyricist));
  push(buildId3v23TextFrame('TCOP', t.copyright));
  push(buildId3v23TextFrame('TENC', t.encodedBy));
  push(buildId3v23TextFrame('TSSE', t.software));
  push(buildId3v23TextFrame('TMOO', t.mood));

  if ((t.engineer || '').trim()) {
    push(buildId3v23TxxxFrame('ENGINEER', t.engineer));
  }

  if ((t.comment || '').trim()) {
    push(buildId3v23LangDescTextFrame('COMM', 'eng', '', t.comment.trim()));
  }

  if ((t.lyrics || '').trim()) {
    push(buildId3v23LangDescTextFrame('USLT', t.lyricsLanguage || 'eng', '', t.lyrics));
  }

  const artistUrl = (t.artistUrl || '').trim();
  if (artistUrl) {
    // WOAR has NO encoding byte; ISO-8859-1 URL payload
    push(buildId3v23Frame('WOAR', writeLatin1(artistUrl)));
  }

  for (const art of artworks || []) {
    push(buildId3v23ApicFrame(art));
  }

  if (frames.length === 0) return null;

  const body = concatBytes(frames);
  const header = new Uint8Array(10);
  header[0] = 0x49; // I
  header[1] = 0x44; // D
  header[2] = 0x33; // 3
  header[3] = 0x03; // v2.3
  header[4] = 0x00; // rev 0
  header[5] = 0x00; // flags
  header.set(writeSyncsafe32(body.length), 6);

  return concatBytes([header, body]);
}

// ============================================================================
// WAV (RIFF WAVE) Reader & Lossless Writer
// ============================================================================

function parseListInfoPayload(payload) {
  const known = {};
  const extra = {};
  let pos = 4; // skip 'INFO'
  while (pos + 8 <= payload.length) {
    const subId = readAscii(payload, pos, 4);
    const subSize = readU32LE(payload, pos + 4);
    const dataStart = pos + 8;
    const dataEnd = Math.min(payload.length, dataStart + subSize);
    const val = decodeRiffString(payload.subarray(dataStart, dataEnd)).trim();
    if (KNOWN_RIFF_INFO_SET.has(subId)) {
      known[subId] = val;
    } else if (val) {
      extra[subId] = val;
    }
    pos = dataStart + subSize + (subSize & 1);
  }
  return { known, extra };
}

function buildListInfoChunk(tags, extraRiffInfo = {}) {
  const t = { ...createEmptyTags(), ...(tags || {}) };
  const mapped = {
    INAM: t.title,
    IART: t.artist,
    IPRD: t.album,
    ICRD: t.year,
    IGNR: t.genre,
    ITRK: t.track,
    ICMT: t.comment,
    ICOP: t.copyright,
    IENG: t.engineer,
    ISFT: t.software,
    ISRC: t.isrc,
  };

  const parts = [];
  const appendSubchunk = (fourcc, rawVal) => {
    const val = (rawVal || '').trim();
    if (!val || fourcc.length !== 4) return;
    const utf8 = textEncoder.encode(val);
    const dataLen = utf8.length + 1; // null-terminated
    const pad = dataLen & 1;
    const chunk = new Uint8Array(8 + dataLen + pad);
    chunk.set(writeLatin1(fourcc), 0);
    chunk.set(writeU32LE(dataLen), 4);
    chunk.set(utf8, 8);
    chunk[8 + utf8.length] = 0x00;
    parts.push(chunk);
  };

  for (const key of KNOWN_RIFF_INFO_KEYS) {
    appendSubchunk(key, mapped[key]);
  }
  for (const [k, v] of Object.entries(extraRiffInfo || {})) {
    if (!KNOWN_RIFF_INFO_SET.has(k) && k.length === 4) {
      appendSubchunk(k, v);
    }
  }

  if (parts.length === 0) return null;

  const subchunksBytes = concatBytes(parts);
  const listPayloadLen = 4 + subchunksBytes.length;
  const pad = listPayloadLen & 1;
  const out = new Uint8Array(8 + listPayloadLen + pad);
  out.set(writeAscii('LIST'), 0);
  out.set(writeU32LE(listPayloadLen), 4);
  out.set(writeAscii('INFO'), 8);
  out.set(subchunksBytes, 12);
  return out;
}

function parseWav(bytes, fileName) {
  if (bytes.length < 12) {
    throw new Error('File is too small to be a valid RIFF WAVE file.');
  }
  const riffMagic = readAscii(bytes, 0, 4);
  const waveMagic = readAscii(bytes, 8, 4);
  if ((riffMagic !== 'RIFF' && riffMagic !== 'RF64') || waveMagic !== 'WAVE') {
    throw new Error('Invalid RIFF WAVE header.');
  }

  let codec = 'PCM';
  let channels = 0;
  let sampleRate = 0;
  let byteRate = 0;
  let bitDepth = 0;
  let dataSize = 0;
  const chunks = [];

  let riffInfo = {};
  let extraRiffInfo = {};
  let id3Parsed = null;

  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const chunkId = readAscii(bytes, pos, 4);
    const chunkSize = readU32LE(bytes, pos + 4);
    const dataStart = pos + 8;
    const clampedSize = Math.min(chunkSize, Math.max(0, bytes.length - dataStart));
    const payload = bytes.subarray(dataStart, dataStart + clampedSize);

    if (chunkId === 'fmt ' && clampedSize >= 16) {
      chunks.push('fmt ');
      const fmtCode = readU16LE(payload, 0);
      channels = readU16LE(payload, 2);
      sampleRate = readU32LE(payload, 4);
      byteRate = readU32LE(payload, 8);
      bitDepth = readU16LE(payload, 14);
      codec = RIFF_AUDIO_FORMAT_NAMES[fmtCode] || `Format 0x${fmtCode.toString(16).toUpperCase()}`;
      if (fmtCode === 0xfffe && clampedSize >= 40) {
        const validBits = readU16LE(payload, 18);
        if (validBits > 0) bitDepth = validBits;
        const subFormat = readU16LE(payload, 24);
        if (subFormat === 1) codec = 'PCM (Extensible)';
        else if (subFormat === 3) codec = 'IEEE Float (Extensible)';
      }
    } else if (chunkId === 'data') {
      chunks.push('data');
      dataSize = clampedSize;
    } else if (chunkId === 'LIST' && clampedSize >= 4) {
      const listType = readAscii(payload, 0, 4);
      chunks.push(`LIST(${listType})`);
      if (listType === 'INFO') {
        const parsed = parseListInfoPayload(payload);
        riffInfo = { ...riffInfo, ...parsed.known };
        extraRiffInfo = { ...extraRiffInfo, ...parsed.extra };
      }
    } else if (chunkId.toLowerCase() === 'id3 ') {
      chunks.push(chunkId);
      const parsed = parseId3v2(payload);
      if (parsed) id3Parsed = parsed;
    } else {
      chunks.push(chunkId);
    }

    pos = dataStart + chunkSize + (chunkSize & 1);
  }

  let durationSeconds = 0;
  if (byteRate > 0 && dataSize > 0) {
    durationSeconds = dataSize / byteRate;
  } else if (sampleRate > 0 && channels > 0 && bitDepth > 0 && dataSize > 0) {
    durationSeconds = dataSize / (sampleRate * channels * (bitDepth / 8));
  }

  // Merge RIFF INFO and ID3v2 (ID3v2 preferred when both present)
  const tags = createEmptyTags();
  const infoMap = {
    title: riffInfo.INAM,
    artist: riffInfo.IART,
    album: riffInfo.IPRD,
    year: riffInfo.ICRD,
    genre: riffInfo.IGNR,
    track: riffInfo.ITRK,
    comment: riffInfo.ICMT,
    copyright: riffInfo.ICOP,
    engineer: riffInfo.IENG,
    software: riffInfo.ISFT,
    isrc: riffInfo.ISRC,
  };
  for (const [k, v] of Object.entries(infoMap)) {
    if (v) tags[k] = v;
  }
  if (id3Parsed) {
    for (const [k, v] of Object.entries(id3Parsed.tags)) {
      if (v && (k !== 'lyricsLanguage' || id3Parsed.tags.lyrics)) {
        tags[k] = v;
      }
    }
  }

  const bitrateKbps =
    sampleRate > 0 && channels > 0 && bitDepth > 0
      ? Math.round((sampleRate * channels * bitDepth) / 1000)
      : byteRate > 0
        ? Math.round((byteRate * 8) / 1000)
        : null;

  return {
    format: 'WAV',
    fileName,
    tech: {
      format: 'WAV',
      codec,
      sampleRate,
      channels,
      channelLabel: formatChannelLabel(channels),
      bitDepth: bitDepth || null,
      bitrateKbps,
      isVBR: false,
      durationSeconds,
      fileSizeBytes: bytes.length,
      audioBytesLength: dataSize,
      id3Version: id3Parsed ? id3Parsed.version : null,
      chunks,
    },
    tags,
    riffInfo,
    extraRiffInfo,
    extraVorbisComments: [],
    vorbisVendor: '',
    artworks: id3Parsed ? id3Parsed.artworks : [],
  };
}

function sealWav(originalBytes, tags, artworks, options = {}) {
  const bytes = toUint8Array(originalBytes);
  if (bytes.length < 12 || readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 4) !== 'WAVE') {
    throw new Error('Only standard RIFF WAVE files can be sealed in-browser.');
  }

  const stripAll = Boolean(options.stripAll);
  const syncInfoAndId3 = options.syncInfoAndId3 !== false; // default true
  const extraRiffInfo = stripAll ? {} : (options.extraRiffInfo || {});

  const keptChunks = [];
  const preservedChunkIds = [];
  let pos = 12;

  while (pos + 8 <= bytes.length) {
    const chunkId = readAscii(bytes, pos, 4);
    const chunkSize = readU32LE(bytes, pos + 4);
    const dataStart = pos + 8;
    const clampedSize = Math.min(chunkSize, Math.max(0, bytes.length - dataStart));

    let isListInfo = false;
    if (chunkId === 'LIST' && clampedSize >= 4) {
      if (readAscii(bytes, dataStart, 4) === 'INFO') {
        isListInfo = true;
      }
    }
    const isId3 = chunkId.toLowerCase() === 'id3 ';

    const shouldDrop =
      isId3 || (isListInfo && (stripAll || syncInfoAndId3));

    if (!shouldDrop) {
      const pad = clampedSize & 1;
      const chunkBytes = new Uint8Array(8 + clampedSize + pad);
      chunkBytes.set(bytes.subarray(pos, pos + 4), 0);
      chunkBytes.set(writeU32LE(clampedSize), 4);
      chunkBytes.set(bytes.subarray(dataStart, dataStart + clampedSize), 8);
      // Trailing pad byte is already 0 in freshly allocated Uint8Array
      keptChunks.push(chunkBytes);
      if (chunkId === 'LIST' && clampedSize >= 4) {
        preservedChunkIds.push(`LIST(${readAscii(bytes, dataStart, 4)})`);
      } else {
        preservedChunkIds.push(chunkId);
      }
    }

    pos = dataStart + chunkSize + (chunkSize & 1);
  }

  const emittedChunks = [...keptChunks];
  const writtenBlocks = [];

  if (!stripAll && syncInfoAndId3) {
    const listInfoChunk = buildListInfoChunk(tags, extraRiffInfo);
    if (listInfoChunk) {
      emittedChunks.push(listInfoChunk);
      writtenBlocks.push('LIST(INFO)');
    }
  }

  if (!stripAll) {
    const id3Payload = buildId3v23(tags, artworks);
    if (id3Payload) {
      const pad = id3Payload.length & 1;
      const id3Chunk = new Uint8Array(8 + id3Payload.length + pad);
      id3Chunk.set(writeAscii('id3 '), 0);
      id3Chunk.set(writeU32LE(id3Payload.length), 4);
      id3Chunk.set(id3Payload, 8);
      emittedChunks.push(id3Chunk);
      writtenBlocks.push('ID3v2.3');
    }
  }

  let riffPayloadSize = 4; // 'WAVE'
  for (const ch of emittedChunks) riffPayloadSize += ch.length;
  if (riffPayloadSize > 0xffffffff) {
    throw new Error('Sealed WAV file exceeds the 4 GB standard RIFF size limit.');
  }

  const masterHeader = new Uint8Array(12);
  masterHeader.set(writeAscii('RIFF'), 0);
  masterHeader.set(writeU32LE(riffPayloadSize), 4);
  masterHeader.set(writeAscii('WAVE'), 8);

  const outBytes = concatBytes([masterHeader, ...emittedChunks]);
  return {
    bytes: outBytes,
    mime: 'audio/wav',
    summary: {
      format: 'WAV',
      writtenBlocks,
      preservedChunks: preservedChunkIds,
      artworkCount: stripAll ? 0 : (artworks || []).length,
      stripped: stripAll,
    },
  };
}

// ============================================================================
// MP3 (ID3v2 + MPEG Frame Inspector + ID3v1 Fallback) Reader & Lossless Writer
// ============================================================================

const MPEG_BITRATES = {
  // [versionGroup][layerIndex] where versionGroup: 0 = MPEG1, 1 = MPEG2/2.5; layerIndex: 1=L1, 2=L2, 3=L3
  0: {
    1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0],
    2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
    3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  },
  1: {
    1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
    3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  },
};

const MPEG_SAMPLE_RATES = {
  3: [44100, 48000, 32000], // MPEG-1
  2: [22050, 24000, 16000], // MPEG-2
  0: [11025, 12000, 8000],  // MPEG-2.5
};

function parseMpegHeaderAt(bytes, offset) {
  if (offset + 4 > bytes.length) return null;
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];

  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const versionBits = (b1 >>> 3) & 0x03;
  const layerBits = (b1 >>> 1) & 0x03;
  const bitrateIdx = (b2 >>> 4) & 0x0f;
  const sampleRateIdx = (b2 >>> 2) & 0x03;
  const padding = (b2 >>> 1) & 0x01;
  const channelMode = (b3 >>> 6) & 0x03;

  if (versionBits === 1 || layerBits === 0) return null;
  if (bitrateIdx === 0 || bitrateIdx === 15) return null;
  if (sampleRateIdx === 3) return null;

  const layerNum = 4 - layerBits; // 3->L1, 2->L2, 1->L3
  const versionGroup = versionBits === 3 ? 0 : 1;
  const bitrateKbps = MPEG_BITRATES[versionGroup][layerNum][bitrateIdx];
  const sampleRate = MPEG_SAMPLE_RATES[versionBits][sampleRateIdx];
  if (!bitrateKbps || !sampleRate) return null;

  const samplesPerFrame =
    layerNum === 1 ? 384 : layerNum === 2 ? 1152 : versionBits === 3 ? 1152 : 576;

  let frameLength;
  if (layerNum === 1) {
    frameLength = (Math.floor((12 * bitrateKbps * 1000) / sampleRate) + padding) * 4;
  } else {
    frameLength = Math.floor(((samplesPerFrame / 8) * bitrateKbps * 1000) / sampleRate) + padding;
  }
  if (frameLength < 4) return null;

  const versionName = versionBits === 3 ? 'MPEG-1' : versionBits === 2 ? 'MPEG-2' : 'MPEG-2.5';
  const layerRoman = layerNum === 1 ? 'I' : layerNum === 2 ? 'II' : 'III';
  const channelLabels = ['Stereo', 'Joint Stereo', 'Dual Channel', 'Mono'];

  return {
    offset,
    versionBits,
    layerNum,
    codec: `${versionName} Layer ${layerRoman}`,
    bitrateKbps,
    sampleRate,
    samplesPerFrame,
    frameLength,
    channels: channelMode === 3 ? 1 : 2,
    channelLabel: channelLabels[channelMode] || 'Stereo',
  };
}

function findFirstMpegFrame(bytes, startOffset) {
  const limit = Math.min(bytes.length - 4, startOffset + 65536);
  let fallbackCandidate = null;
  for (let i = startOffset; i <= limit; i++) {
    const hdr = parseMpegHeaderAt(bytes, i);
    if (!hdr) continue;
    if (!fallbackCandidate) fallbackCandidate = hdr;
    const nextPos = i + hdr.frameLength;
    if (nextPos === bytes.length || (nextPos + 4 <= bytes.length && parseMpegHeaderAt(bytes, nextPos))) {
      return hdr;
    }
  }
  return fallbackCandidate;
}

function parseId3v1(bytes) {
  if (bytes.length < 128) return null;
  const base = bytes.length - 128;
  if (bytes[base] !== 0x54 || bytes[base + 1] !== 0x41 || bytes[base + 2] !== 0x47) {
    return null;
  }
  const tags = createEmptyTags();
  tags.title = decodeLatin1(bytes.subarray(base + 3, base + 33)).trim();
  tags.artist = decodeLatin1(bytes.subarray(base + 33, base + 63)).trim();
  tags.album = decodeLatin1(bytes.subarray(base + 63, base + 93)).trim();
  tags.year = decodeLatin1(bytes.subarray(base + 93, base + 97)).trim();
  if (bytes[base + 125] === 0 && bytes[base + 126] !== 0) {
    tags.comment = decodeLatin1(bytes.subarray(base + 97, base + 125)).trim();
    tags.track = String(bytes[base + 126]);
  } else {
    tags.comment = decodeLatin1(bytes.subarray(base + 97, base + 127)).trim();
  }
  const genreByte = bytes[base + 127];
  if (genreByte < ID3V1_GENRES.length) {
    tags.genre = ID3V1_GENRES[genreByte];
  }
  return tags;
}

function findMp3AudioStart(bytes) {
  let offset = 0;
  // Support stacked ID3v2 headers gracefully while guarding against corrupt header lengths
  while (offset + 10 <= bytes.length && readAscii(bytes, offset, 3) === 'ID3') {
    const major = bytes[offset + 3];
    const flags = bytes[offset + 5];
    const size = readSyncsafe32(bytes, offset + 6);
    const hasFooter = major === 4 && (flags & 0x10) !== 0;
    const span = 10 + size + (hasFooter ? 10 : 0);
    if (span < 10) {
      break;
    }
    if (offset + span > bytes.length) {
      // Malformed/truncated ID3v2 size: locate first valid MPEG sync rather than dropping audio
      const rescued = findFirstMpegFrame(bytes, offset + 10);
      if (rescued) {
        return rescued.offset;
      }
      throw new Error('Corrupted ID3v2 header exceeds file length; refusing to modify audio stream.');
    }
    offset += span;
  }
  return offset;
}

function parseMp3(bytes, fileName) {
  const id3Parsed = parseId3v2(bytes);
  const audioStart = findMp3AudioStart(bytes);
  const id3v1 = parseId3v1(bytes);
  const hasId3v1 = id3v1 !== null;
  const audioEnd = hasId3v1 ? bytes.length - 128 : bytes.length;
  const audioBytesLength = Math.max(0, audioEnd - audioStart);

  const chunks = [];
  if (id3Parsed) chunks.push(id3Parsed.version);
  chunks.push('MPEG Frames');
  if (hasId3v1) chunks.push('ID3v1');

  const frame = findFirstMpegFrame(bytes, audioStart);
  let sampleRate = 0;
  let channels = 2;
  let channelLabel = 'Stereo';
  let bitrateKbps = null;
  let codec = 'MPEG Audio';
  let isVBR = false;
  let durationSeconds = 0;

  if (frame) {
    sampleRate = frame.sampleRate;
    channels = frame.channels;
    channelLabel = frame.channelLabel;
    bitrateKbps = frame.bitrateKbps;
    codec = frame.codec;

    // Check for Xing / Info VBR header inside the first frame
    const sideInfoLen =
      frame.versionBits === 3 ? (channels === 1 ? 17 : 32) : channels === 1 ? 9 : 17;
    const xingPos = frame.offset + 4 + sideInfoLen;
    let totalFrames = 0;
    if (xingPos + 12 <= bytes.length) {
      const marker = readAscii(bytes, xingPos, 4);
      if (marker === 'Xing' || marker === 'Info') {
        isVBR = marker === 'Xing';
        const xingFlags = readU32BE(bytes, xingPos + 4);
        if ((xingFlags & 0x01) !== 0 && xingPos + 12 <= bytes.length) {
          totalFrames = readU32BE(bytes, xingPos + 8);
        }
      }
    }
    // Check for Fraunhofer VBRI header at fixed offset 32 after 4-byte header
    const vbriPos = frame.offset + 36;
    if (!totalFrames && vbriPos + 18 <= bytes.length && readAscii(bytes, vbriPos, 4) === 'VBRI') {
      isVBR = true;
      totalFrames = readU32BE(bytes, vbriPos + 14);
    }

    if (totalFrames > 0 && sampleRate > 0) {
      durationSeconds = (totalFrames * frame.samplesPerFrame) / sampleRate;
      if (durationSeconds > 0 && audioBytesLength > 0) {
        bitrateKbps = Math.round((audioBytesLength * 8) / (durationSeconds * 1000));
      }
    } else if (bitrateKbps > 0 && audioBytesLength > 0) {
      durationSeconds = (audioBytesLength * 8) / (bitrateKbps * 1000);
    }
  }

  const tags = id3Parsed ? id3Parsed.tags : id3v1 ? id3v1 : createEmptyTags();

  return {
    format: 'MP3',
    fileName,
    tech: {
      format: 'MP3',
      codec: isVBR ? `${codec} (VBR)` : codec,
      sampleRate,
      channels,
      channelLabel,
      bitDepth: null,
      bitrateKbps,
      isVBR,
      durationSeconds,
      fileSizeBytes: bytes.length,
      audioBytesLength,
      id3Version: id3Parsed ? id3Parsed.version : hasId3v1 ? 'ID3v1' : null,
      chunks,
    },
    tags,
    riffInfo: {},
    extraRiffInfo: {},
    extraVorbisComments: [],
    vorbisVendor: '',
    artworks: id3Parsed ? id3Parsed.artworks : [],
  };
}

function sealMp3(originalBytes, tags, artworks, options = {}) {
  const bytes = toUint8Array(originalBytes);
  const stripAll = Boolean(options.stripAll);
  const audioStart = findMp3AudioStart(bytes);
  let audioEnd = bytes.length;
  if (stripAll && parseId3v1(bytes)) {
    audioEnd = bytes.length - 128;
  }
  const mpegPayload = bytes.subarray(audioStart, audioEnd);

  const writtenBlocks = [];
  let outBytes;
  if (stripAll) {
    outBytes = mpegPayload.slice();
  } else {
    const id3Block = buildId3v23(tags, artworks);
    if (id3Block) {
      writtenBlocks.push('ID3v2.3');
      outBytes = concatBytes([id3Block, mpegPayload]);
    } else {
      outBytes = mpegPayload.slice();
    }
  }

  return {
    bytes: outBytes,
    mime: 'audio/mpeg',
    summary: {
      format: 'MP3',
      writtenBlocks,
      preservedChunks: ['MPEG Audio Frames'],
      artworkCount: stripAll ? 0 : (artworks || []).length,
      stripped: stripAll,
    },
  };
}

// ============================================================================
// FLAC Native Container Reader & Lossless Writer
// ============================================================================

const FLAC_BLOCK_NAMES = {
  0: 'STREAMINFO',
  1: 'PADDING',
  2: 'APPLICATION',
  3: 'SEEKTABLE',
  4: 'VORBIS_COMMENT',
  5: 'CUESHEET',
  6: 'PICTURE',
};

function parseVorbisCommentBlock(payload) {
  if (payload.length < 8) return { vendor: '', tags: createEmptyTags(), extra: [] };
  let pos = 0;
  const vendorLen = readU32LE(payload, pos);
  pos += 4;
  const vendor = textDecoderUtf8.decode(payload.subarray(pos, Math.min(payload.length, pos + vendorLen)));
  pos += vendorLen;
  if (pos + 4 > payload.length) return { vendor, tags: createEmptyTags(), extra: [] };
  const count = readU32LE(payload, pos);
  pos += 4;

  const rawMap = new Map();
  const extra = [];

  for (let i = 0; i < count && pos + 4 <= payload.length; i++) {
    const len = readU32LE(payload, pos);
    pos += 4;
    if (pos + len > payload.length) break;
    const entry = textDecoderUtf8.decode(payload.subarray(pos, pos + len));
    pos += len;
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    const key = entry.slice(0, eq).trim().toUpperCase();
    const val = entry.slice(eq + 1);
    if (KNOWN_VORBIS_KEYS.has(key)) {
      if (!rawMap.has(key)) rawMap.set(key, val);
    } else {
      extra.push([key, val]);
    }
  }

  const get = (...keys) => {
    for (const k of keys) {
      if (rawMap.has(k) && rawMap.get(k).trim() !== '') return rawMap.get(k);
    }
    return '';
  };

  const tags = createEmptyTags();
  tags.title = get('TITLE');
  tags.artist = get('ARTIST');
  tags.albumArtist = get('ALBUMARTIST', 'ALBUM ARTIST');
  tags.album = get('ALBUM');
  tags.year = get('DATE', 'YEAR');

  const trk = get('TRACKNUMBER');
  const trkTotal = get('TRACKTOTAL', 'TOTALTRACKS');
  tags.track = trk && trkTotal && !trk.includes('/') ? `${trk}/${trkTotal}` : trk;

  const disc = get('DISCNUMBER');
  const discTotal = get('DISCTOTAL', 'TOTALDISCS');
  tags.disc = disc && discTotal && !disc.includes('/') ? `${disc}/${discTotal}` : disc;

  tags.genre = get('GENRE');
  tags.bpm = get('BPM', 'TEMPO');
  tags.key = get('INITIALKEY', 'KEY');
  tags.isrc = get('ISRC');
  tags.composer = get('COMPOSER');
  tags.lyricist = get('LYRICIST');
  tags.publisher = get('ORGANIZATION', 'PUBLISHER', 'LABEL');
  tags.copyright = get('COPYRIGHT');
  tags.comment = get('COMMENT', 'DESCRIPTION');
  tags.lyrics = get('LYRICS', 'UNSYNCEDLYRICS');
  tags.mood = get('MOOD');
  tags.engineer = get('ENGINEER');
  tags.encodedBy = get('ENCODED-BY', 'ENCODEDBY');
  tags.software = get('ENCODER', 'SOFTWARE');
  tags.subtitle = get('SUBTITLE', 'VERSION');
  tags.artistUrl = get('WEBSITE', 'URL');

  return { vendor, tags, extra };
}

function parseFlacPictureBlock(payload) {
  let pos = 0;
  if (payload.length < 32) return null;
  const picType = readU32BE(payload, pos);
  pos += 4;
  const mimeLen = readU32BE(payload, pos);
  pos += 4;
  if (pos + mimeLen + 4 > payload.length) return null;
  const rawMime = readAscii(payload, pos, mimeLen);
  pos += mimeLen;
  const descLen = readU32BE(payload, pos);
  pos += 4;
  if (pos + descLen + 20 > payload.length) return null;
  const description = textDecoderUtf8.decode(payload.subarray(pos, pos + descLen));
  pos += descLen;
  const headerWidth = readU32BE(payload, pos);
  const headerHeight = readU32BE(payload, pos + 4);
  // pos+8 = depth, pos+12 = colors
  const dataLen = readU32BE(payload, pos + 16);
  pos += 20;
  const data = payload.slice(pos, Math.min(payload.length, pos + dataLen));
  if (data.length === 0) return null;
  const info = inspectImageBytes(data, rawMime || 'image/jpeg');
  return {
    data,
    mime: info.mime,
    picType,
    description,
    width: info.width || headerWidth,
    height: info.height || headerHeight,
  };
}

function buildVorbisCommentPayload(tags, vendorString, extraVorbisComments = []) {
  const t = { ...createEmptyTags(), ...(tags || {}) };
  const pairs = [];
  const push = (k, v) => {
    const val = (v || '').trim();
    if (val) pairs.push(`${k}=${val}`);
  };

  push('TITLE', t.title);
  push('ARTIST', t.artist);
  push('ALBUMARTIST', t.albumArtist);
  push('ALBUM', t.album);
  push('DATE', t.year);

  const trkStr = (t.track || '').trim();
  if (trkStr) {
    const slash = trkStr.indexOf('/');
    if (slash > 0 && slash < trkStr.length - 1) {
      push('TRACKNUMBER', trkStr.slice(0, slash));
      push('TRACKTOTAL', trkStr.slice(slash + 1));
    } else {
      push('TRACKNUMBER', trkStr);
    }
  }

  const discStr = (t.disc || '').trim();
  if (discStr) {
    const slash = discStr.indexOf('/');
    if (slash > 0 && slash < discStr.length - 1) {
      push('DISCNUMBER', discStr.slice(0, slash));
      push('DISCTOTAL', discStr.slice(slash + 1));
    } else {
      push('DISCNUMBER', discStr);
    }
  }

  push('GENRE', t.genre);
  push('BPM', t.bpm);
  push('INITIALKEY', t.key);
  push('ISRC', t.isrc);
  push('COMPOSER', t.composer);
  push('LYRICIST', t.lyricist);
  push('ORGANIZATION', t.publisher);
  push('COPYRIGHT', t.copyright);
  push('COMMENT', t.comment);
  if ((t.lyrics || '').trim()) {
    pairs.push(`LYRICS=${t.lyrics}`);
  }
  push('MOOD', t.mood);
  push('ENGINEER', t.engineer);
  push('ENCODED-BY', t.encodedBy);
  push('ENCODER', t.software);
  push('SUBTITLE', t.subtitle);
  push('WEBSITE', t.artistUrl);

  for (const [k, v] of extraVorbisComments || []) {
    if (k && !KNOWN_VORBIS_KEYS.has(k.toUpperCase()) && v !== undefined && v !== null) {
      pairs.push(`${k.toUpperCase()}=${String(v)}`);
    }
  }

  if (pairs.length === 0) return null;

  const vendorBytes = textEncoder.encode(vendorString || 'Saint Gordon Tag & Seal');
  const parts = [writeU32LE(vendorBytes.length), vendorBytes, writeU32LE(pairs.length)];
  for (const entry of pairs) {
    const entryBytes = textEncoder.encode(entry);
    parts.push(writeU32LE(entryBytes.length), entryBytes);
  }
  return concatBytes(parts);
}

function buildFlacPicturePayload(art) {
  if (!art || !art.data || art.data.length === 0) return null;
  const imgBytes = toUint8Array(art.data);
  const info = inspectImageBytes(imgBytes, art.mime || 'image/jpeg');
  const mimeBytes = writeAscii(info.mime);
  const descBytes = textEncoder.encode(art.description || '');
  const picType = Number.isInteger(art.picType) ? art.picType >>> 0 : 3;
  const width = (art.width || info.width || 0) >>> 0;
  const height = (art.height || info.height || 0) >>> 0;
  const colorDepth = info.mime === 'image/png' ? 32 : 24;

  return concatBytes([
    writeU32BE(picType),
    writeU32BE(mimeBytes.length),
    mimeBytes,
    writeU32BE(descBytes.length),
    descBytes,
    writeU32BE(width),
    writeU32BE(height),
    writeU32BE(colorDepth),
    writeU32BE(0), // indexed colors (0 for non-indexed)
    writeU32BE(imgBytes.length),
    imgBytes,
  ]);
}

function buildFlacBlock(blockType, payload, isLast) {
  if (payload.length > 0xffffff) {
    throw new Error('FLAC metadata block exceeds the 16 MB format limit (try JPEG or a smaller cover size).');
  }
  const header = new Uint8Array(4);
  header[0] = (isLast ? 0x80 : 0x00) | (blockType & 0x7f);
  header[1] = (payload.length >>> 16) & 0xff;
  header[2] = (payload.length >>> 8) & 0xff;
  header[3] = payload.length & 0xff;
  return concatBytes([header, payload]);
}

function parseFlac(bytes, fileName) {
  let pos = 0;
  if (bytes.length >= 3 && readAscii(bytes, 0, 3) === 'ID3') {
    pos = findMp3AudioStart(bytes);
  }
  if (pos + 4 > bytes.length || readAscii(bytes, pos, 4) !== 'fLaC') {
    throw new Error('Invalid FLAC stream marker (expected fLaC).');
  }

  pos += 4;
  let sampleRate = 0;
  let channels = 0;
  let bitDepth = 0;
  let totalSamples = 0;
  let vorbisVendor = '';
  let extraVorbisComments = [];
  let tags = createEmptyTags();
  const artworks = [];
  const chunks = [];

  while (pos + 4 <= bytes.length) {
    const b0 = bytes[pos];
    const isLast = (b0 & 0x80) !== 0;
    const blockType = b0 & 0x7f;
    const blockLen = readU24BE(bytes, pos + 1);
    const dataStart = pos + 4;
    if (dataStart + blockLen > bytes.length) {
      throw new Error('Truncated FLAC metadata block.');
    }
    const payload = bytes.subarray(dataStart, dataStart + blockLen);
    chunks.push(FLAC_BLOCK_NAMES[blockType] || `BLOCK(${blockType})`);

    if (blockType === 0 && payload.length >= 34) {
      // STREAMINFO
      sampleRate = (payload[10] << 12) | (payload[11] << 4) | (payload[12] >>> 4);
      channels = ((payload[12] >>> 1) & 0x07) + 1;
      bitDepth = (((payload[12] & 0x01) << 4) | (payload[13] >>> 4)) + 1;
      const hi4 = payload[13] & 0x0f;
      const lo32 = readU32BE(payload, 14);
      totalSamples = hi4 * 0x100000000 + lo32;
    } else if (blockType === 4) {
      const parsed = parseVorbisCommentBlock(payload);
      vorbisVendor = parsed.vendor;
      tags = parsed.tags;
      extraVorbisComments = parsed.extra;
    } else if (blockType === 6) {
      const pic = parseFlacPictureBlock(payload);
      if (pic) artworks.push(pic);
    }

    pos = dataStart + blockLen;
    if (isLast) break;
  }

  const audioBytesLength = Math.max(0, bytes.length - pos);
  const durationSeconds = sampleRate > 0 && totalSamples > 0 ? totalSamples / sampleRate : 0;
  const bitrateKbps =
    durationSeconds > 0 && audioBytesLength > 0
      ? Math.round((audioBytesLength * 8) / (durationSeconds * 1000))
      : null;

  return {
    format: 'FLAC',
    fileName,
    tech: {
      format: 'FLAC',
      codec: 'FLAC Lossless',
      sampleRate,
      channels,
      channelLabel: formatChannelLabel(channels),
      bitDepth: bitDepth || null,
      bitrateKbps,
      isVBR: true,
      durationSeconds,
      fileSizeBytes: bytes.length,
      audioBytesLength,
      id3Version: null,
      chunks,
    },
    tags,
    riffInfo: {},
    extraRiffInfo: {},
    extraVorbisComments,
    vorbisVendor,
    artworks,
  };
}

function sealFlac(originalBytes, tags, artworks, options = {}) {
  const bytes = toUint8Array(originalBytes);
  let pos = 0;
  if (bytes.length >= 3 && readAscii(bytes, 0, 3) === 'ID3') {
    pos = findMp3AudioStart(bytes);
  }
  if (pos + 4 > bytes.length || readAscii(bytes, pos, 4) !== 'fLaC') {
    throw new Error('Invalid FLAC file.');
  }

  const stripAll = Boolean(options.stripAll);
  const vorbisVendor = options.vorbisVendor || 'Saint Gordon Tag & Seal';
  const extraVorbisComments = stripAll ? [] : (options.extraVorbisComments || []);

  pos += 4;
  let streamInfoPayload = null;
  const preservedBlocks = []; // { type, payload }
  const preservedNames = [];

  while (pos + 4 <= bytes.length) {
    const b0 = bytes[pos];
    const isLast = (b0 & 0x80) !== 0;
    const blockType = b0 & 0x7f;
    const blockLen = readU24BE(bytes, pos + 1);
    const dataStart = pos + 4;
    if (dataStart + blockLen > bytes.length) {
      throw new Error('Truncated FLAC metadata block.');
    }
    const payload = bytes.subarray(dataStart, dataStart + blockLen);

    if (blockType === 0) {
      streamInfoPayload = payload;
      preservedNames.push('STREAMINFO');
    } else if (blockType !== 4 && blockType !== 6 && blockType !== 1) {
      // Preserve SEEKTABLE (3), CUESHEET (5), APPLICATION (2), etc.
      preservedBlocks.push({ type: blockType, payload });
      preservedNames.push(FLAC_BLOCK_NAMES[blockType] || `BLOCK(${blockType})`);
    }

    pos = dataStart + blockLen;
    if (isLast) break;
  }

  if (!streamInfoPayload) {
    throw new Error('FLAC file is missing mandatory STREAMINFO block.');
  }

  const audioFrames = bytes.subarray(pos);
  const blocksToEmit = [{ type: 0, payload: streamInfoPayload }, ...preservedBlocks];
  const writtenBlocks = [];

  if (!stripAll) {
    const vcPayload = buildVorbisCommentPayload(tags, vorbisVendor, extraVorbisComments);
    if (vcPayload) {
      blocksToEmit.push({ type: 4, payload: vcPayload });
      writtenBlocks.push('VORBIS_COMMENT');
    }
    for (const art of artworks || []) {
      const picPayload = buildFlacPicturePayload(art);
      if (picPayload) {
        blocksToEmit.push({ type: 6, payload: picPayload });
        if (!writtenBlocks.includes('PICTURE')) writtenBlocks.push('PICTURE');
      }
    }
  }

  const emittedParts = [writeAscii('fLaC')];
  for (let i = 0; i < blocksToEmit.length; i++) {
    const blk = blocksToEmit[i];
    const isLast = i === blocksToEmit.length - 1;
    emittedParts.push(buildFlacBlock(blk.type, blk.payload, isLast));
  }
  emittedParts.push(audioFrames);

  return {
    bytes: concatBytes(emittedParts),
    mime: 'audio/flac',
    summary: {
      format: 'FLAC',
      writtenBlocks,
      preservedChunks: [...preservedNames, 'FLAC Audio Frames'],
      artworkCount: stripAll ? 0 : (artworks || []).length,
      stripped: stripAll,
    },
  };
}

// ============================================================================
// Public Format Detection & Unified API
// ============================================================================

function formatChannelLabel(channels) {
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  if (channels === 6) return '5.1 Surround';
  if (channels > 0) return `${channels} ch`;
  return 'Unknown';
}

function hasConsecutiveMpegFrames(bytes, startOffset = 0) {
  const limit = Math.min(bytes.length - 4, startOffset + 65536);
  for (let i = startOffset; i <= limit; i++) {
    const hdr = parseMpegHeaderAt(bytes, i);
    if (!hdr) continue;
    const nextPos = i + hdr.frameLength;
    if (nextPos === bytes.length || (nextPos + 4 <= bytes.length && parseMpegHeaderAt(bytes, nextPos))) {
      return true;
    }
  }
  return false;
}

export function detectAudioFormat(input, fileName = '') {
  const bytes = toUint8Array(input);
  if (bytes.length >= 12 && (readAscii(bytes, 0, 4) === 'RIFF' || readAscii(bytes, 0, 4) === 'RF64') && readAscii(bytes, 8, 4) === 'WAVE') {
    return 'WAV';
  }
  if (bytes.length >= 4 && readAscii(bytes, 0, 4) === 'fLaC') {
    return 'FLAC';
  }
  // Explicitly reject other known non-WAV/MP3/FLAC containers (AIFF, Ogg/Opus, MP4/M4A)
  // so random 0xFF bytes inside them are never misidentified as raw MPEG frames.
  if (bytes.length >= 12 && readAscii(bytes, 0, 4) === 'FORM' && (readAscii(bytes, 8, 4) === 'AIFF' || readAscii(bytes, 8, 4) === 'AIFC')) {
    return null;
  }
  if (bytes.length >= 4 && readAscii(bytes, 0, 4) === 'OggS') {
    return null;
  }
  if (bytes.length >= 8 && readAscii(bytes, 4, 4) === 'ftyp') {
    return null;
  }
  if (bytes.length >= 3 && readAscii(bytes, 0, 3) === 'ID3') {
    // Check if there is an fLaC marker right after an ID3v2 tag (rare non-standard FLAC)
    const span = findMp3AudioStart(bytes);
    if (span + 4 <= bytes.length && readAscii(bytes, span, 4) === 'fLaC') {
      return 'FLAC';
    }
    return 'MP3';
  }
  if (bytes.length >= 4 && hasConsecutiveMpegFrames(bytes, 0)) {
    return 'MP3';
  }

  const ext = (fileName || '').toLowerCase().split('.').pop();
  if (ext === 'wav') return 'WAV';
  if (ext === 'flac') return 'FLAC';
  if (ext === 'mp3' && bytes.length >= 4 && findFirstMpegFrame(bytes, 0)) return 'MP3';
  return null;
}

/**
 * Parse a WAV, MP3, or FLAC audio file into a unified metadata document.
 */
export function parseAudioFile(input, fileName = 'track') {
  const bytes = toUint8Array(input);
  const format = detectAudioFormat(bytes, fileName);
  if (!format) {
    throw new Error(
      `Unsupported audio format for "${fileName}". Tag & Seal supports lossless tagging for WAV, MP3, and FLAC files.`
    );
  }
  if (format === 'WAV') return parseWav(bytes, fileName);
  if (format === 'MP3') return parseMp3(bytes, fileName);
  if (format === 'FLAC') return parseFlac(bytes, fileName);
  throw new Error(`Unsupported format: ${format}`);
}

/**
 * Losslessly write updated tags and cover art into a WAV, MP3, or FLAC buffer.
 * Zero audio frames are re-encoded or modified.
 */
export function sealAudioFile(originalInput, tags, artworks = [], options = {}) {
  const bytes = toUint8Array(originalInput);
  const format = options.format || detectAudioFormat(bytes, options.fileName || '');
  if (!format) {
    throw new Error('Could not determine audio container format for sealing.');
  }
  if (format === 'WAV') return sealWav(bytes, tags, artworks, options);
  if (format === 'MP3') return sealMp3(bytes, tags, artworks, options);
  if (format === 'FLAC') return sealFlac(bytes, tags, artworks, options);
  throw new Error(`Unsupported format: ${format}`);
}

/**
 * Extract raw audio payload slice for byte-level verification (WAV `data`, MP3 MPEG frames, FLAC audio frames).
 */
export function extractAudioPayloadSlice(input) {
  const bytes = toUint8Array(input);
  const format = detectAudioFormat(bytes);
  if (format === 'WAV') {
    let pos = 12;
    while (pos + 8 <= bytes.length) {
      const id = readAscii(bytes, pos, 4);
      const sz = readU32LE(bytes, pos + 4);
      const dataStart = pos + 8;
      if (id === 'data') {
        return bytes.subarray(dataStart, Math.min(bytes.length, dataStart + sz));
      }
      pos = dataStart + sz + (sz & 1);
    }
    return new Uint8Array(0);
  }
  if (format === 'MP3') {
    const start = findMp3AudioStart(bytes);
    const hasV1 = parseId3v1(bytes) !== null;
    const end = hasV1 ? bytes.length - 128 : bytes.length;
    return bytes.subarray(start, end);
  }
  if (format === 'FLAC') {
    let pos = readAscii(bytes, 0, 3) === 'ID3' ? findMp3AudioStart(bytes) : 0;
    pos += 4;
    while (pos + 4 <= bytes.length) {
      const isLast = (bytes[pos] & 0x80) !== 0;
      const len = readU24BE(bytes, pos + 1);
      pos += 4 + len;
      if (isLast) break;
    }
    return bytes.subarray(pos);
  }
  return new Uint8Array(0);
}

function bytesAreIdentical(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function extractWavChunkMap(bytes) {
  const map = new Map();
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const id = readAscii(bytes, pos, 4);
    const sz = readU32LE(bytes, pos + 4);
    const dataStart = pos + 8;
    const clamped = Math.min(sz, Math.max(0, bytes.length - dataStart));
    const slice = bytes.subarray(dataStart, dataStart + clamped);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(slice);
    pos = dataStart + sz + (sz & 1);
  }
  return map;
}

function extractFlacStreamInfo(bytes) {
  let pos = bytes.length >= 3 && readAscii(bytes, 0, 3) === 'ID3' ? findMp3AudioStart(bytes) : 0;
  if (pos + 4 > bytes.length || readAscii(bytes, pos, 4) !== 'fLaC') return null;
  pos += 4;
  while (pos + 4 <= bytes.length) {
    const b0 = bytes[pos];
    const isLast = (b0 & 0x80) !== 0;
    const blockType = b0 & 0x7f;
    const len = readU24BE(bytes, pos + 1);
    const start = pos + 4;
    if (start + len > bytes.length) return null;
    if (blockType === 0) return bytes.subarray(start, start + len);
    pos = start + len;
    if (isLast) break;
  }
  return null;
}

/**
 * Strictly verify bit-for-bit audio & codec header preservation between original and sealed bytes.
 * Compares EVERY byte of the audio stream (not just a hash) plus WAV `fmt `/`fact`/`bext` or FLAC `STREAMINFO`.
 */
export function verifyLosslessAudio(originalInput, sealedInput) {
  const orig = toUint8Array(originalInput);
  const sealed = toUint8Array(sealedInput);
  const origFormat = detectAudioFormat(orig);
  const sealedFormat = detectAudioFormat(sealed);

  if (!origFormat || origFormat !== sealedFormat) {
    return {
      ok: false,
      reason: `Container format changed unexpectedly (${origFormat || 'unknown'} -> ${sealedFormat || 'unknown'}).`,
    };
  }

  const origAudio = extractAudioPayloadSlice(orig);
  const sealedAudio = extractAudioPayloadSlice(sealed);

  if (!bytesAreIdentical(origAudio, sealedAudio)) {
    return {
      ok: false,
      reason: `Audio payload bytes differ (${origAudio.length} B vs ${sealedAudio.length} B).`,
    };
  }

  if (origFormat === 'WAV') {
    const origChunks = extractWavChunkMap(orig);
    const sealedChunks = extractWavChunkMap(sealed);
    for (const criticalId of ['fmt ', 'fact', 'data', 'bext', 'iXML', 'smpl', 'cue ']) {
      const aList = origChunks.get(criticalId) || [];
      const bList = sealedChunks.get(criticalId) || [];
      if (aList.length !== bList.length) {
        return { ok: false, reason: `WAV "${criticalId}" chunk count changed.` };
      }
      for (let i = 0; i < aList.length; i++) {
        if (!bytesAreIdentical(aList[i], bList[i])) {
          return { ok: false, reason: `WAV "${criticalId}" chunk bytes were altered.` };
        }
      }
    }
  } else if (origFormat === 'FLAC') {
    const origSi = extractFlacStreamInfo(orig);
    const sealedSi = extractFlacStreamInfo(sealed);
    if (!origSi || !sealedSi || !bytesAreIdentical(origSi, sealedSi)) {
      return { ok: false, reason: 'FLAC STREAMINFO (sample specs & PCM MD5) was altered.' };
    }
  }

  const checksum = checksumBytes(sealedAudio);
  return {
    ok: true,
    format: origFormat,
    audioByteLength: sealedAudio.length,
    checksum,
  };
}

/**
 * Compute a fast FNV-1a 32-bit hex digest over a Uint8Array (for instant zero-re-encode verification).
 */
export function checksumBytes(input) {
  const bytes = toUint8Array(input);
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

export function formatDuration(seconds) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatFileSize(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatSampleRate(hz) {
  if (!hz || hz <= 0) return '—';
  return hz % 1000 === 0 ? `${hz / 1000} kHz` : `${(hz / 1000).toFixed(1)} kHz`;
}
