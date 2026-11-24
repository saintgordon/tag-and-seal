import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildId3v23,
  checksumBytes,
  createEmptyTags,
  detectAudioFormat,
  extractAudioPayloadSlice,
  inspectImageBytes,
  parseAudioFile,
  parseId3v2,
  sealAudioFile,
} from '../js/metadata-engine.js';
import { applySaintGordonXerox } from '../js/artwork-processor.js';

// ============================================================================
// Pure-JS Binary Fixture Builders (WAV, MP3, FLAC, PNG, JPEG, ID3v2.4, ID3v2.2, ID3v1)
// ============================================================================

const enc = new TextEncoder();

function concat(arrays) {
  let len = 0;
  for (const a of arrays) len += a.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function u32BE(v) {
  return new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}

function u32LE(v) {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
}

function u16LE(v) {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
}

function u16BE(v) {
  return new Uint8Array([(v >>> 8) & 0xff, v & 0xff]);
}

function syncsafe32(v) {
  return new Uint8Array([(v >>> 21) & 0x7f, (v >>> 14) & 0x7f, (v >>> 7) & 0x7f, v & 0x7f]);
}

function ascii(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
  return out;
}

function makeFakePng(width = 1400, height = 1400, extraPayloadBytes = 512) {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = concat([u32BE(width), u32BE(height), new Uint8Array([8, 2, 0, 0, 0])]);
  const ihdr = concat([u32BE(13), ascii('IHDR'), ihdrData, u32BE(0)]);
  const idatPayload = new Uint8Array(extraPayloadBytes);
  for (let i = 0; i < extraPayloadBytes; i++) idatPayload[i] = (i * 37 + 11) & 0xff;
  const idat = concat([u32BE(idatPayload.length), ascii('IDAT'), idatPayload, u32BE(0)]);
  const iend = concat([u32BE(0), ascii('IEND'), u32BE(0)]);
  return concat([sig, ihdr, idat, iend]);
}

function makeFakeJpeg(width = 3000, height = 3000, extraPayloadBytes = 640) {
  const soi = new Uint8Array([0xff, 0xd8]);
  // APP0 JFIF segment
  const app0 = new Uint8Array([
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]);
  // SOF0 marker with exact height & width
  const sof0 = concat([
    new Uint8Array([0xff, 0xc0]),
    u16BE(11),
    new Uint8Array([8]),
    u16BE(height),
    u16BE(width),
    new Uint8Array([1, 1, 0x11, 0]),
  ]);
  const body = new Uint8Array(extraPayloadBytes);
  for (let i = 0; i < extraPayloadBytes; i++) body[i] = (i * 19 + 5) & 0xff;
  const sos = new Uint8Array([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  const eoi = new Uint8Array([0xff, 0xd9]);
  return concat([soi, app0, sof0, sos, body, eoi]);
}

function makeSyntheticWav() {
  // 48 kHz, 24-bit, Stereo PCM (200 sample frames = 1200 bytes)
  const sampleRate = 48000;
  const channels = 2;
  const bitDepth = 24;
  const blockAlign = channels * (bitDepth / 8);
  const byteRate = sampleRate * blockAlign;
  const fmtPayload = concat([
    u16LE(1), // PCM
    u16LE(channels),
    u32LE(sampleRate),
    u32LE(byteRate),
    u16LE(blockAlign),
    u16LE(bitDepth),
  ]);

  // Custom Broadcast Wave `bext` chunk (odd length 63 bytes to verify 2-byte alignment!)
  const bextPayload = new Uint8Array(63);
  bextPayload.set(ascii('BEXT-SAINT-GORDON-STUDIO-ARCHIVE-PAYLOAD-1234567890'), 0);

  // Pre-existing LIST(INFO) with unknown `ITCH` subchunk to verify preservation
  const itchVal = concat([enc.encode('Studio Assistant'), new Uint8Array([0])]);
  const itchChunk = concat([
    ascii('ITCH'),
    u32LE(itchVal.length),
    itchVal,
    itchVal.length & 1 ? new Uint8Array([0]) : new Uint8Array(0),
  ]);
  const listPayload = concat([ascii('INFO'), itchChunk]);
  const listChunk = concat([
    ascii('LIST'),
    u32LE(listPayload.length),
    listPayload,
    listPayload.length & 1 ? new Uint8Array([0]) : new Uint8Array(0),
  ]);

  // Deterministic PCM audio payload (1200 bytes)
  const pcmData = new Uint8Array(1200);
  for (let i = 0; i < pcmData.length; i++) pcmData[i] = (i * 53 + 17) & 0xff;

  const fmtChunk = concat([ascii('fmt '), u32LE(fmtPayload.length), fmtPayload]);
  const bextChunk = concat([
    ascii('bext'),
    u32LE(bextPayload.length),
    bextPayload,
    bextPayload.length & 1 ? new Uint8Array([0]) : new Uint8Array(0),
  ]);
  const dataChunk = concat([ascii('data'), u32LE(pcmData.length), pcmData]);

  const body = concat([ascii('WAVE'), fmtChunk, bextChunk, listChunk, dataChunk]);
  const wav = concat([ascii('RIFF'), u32LE(body.length), body]);
  return { wav, pcmData, bextPayload };
}

function makeSyntheticMp3() {
  // Valid MPEG-1 Layer III, 192 kbps, 44100 Hz, Stereo, no padding:
  // Header bytes: FF FB B0 00 -> frameLength = floor(144 * 192000 / 44100) = 626 bytes
  const frameLen = 626;
  const numFrames = 4;
  const frames = new Uint8Array(frameLen * numFrames);
  for (let f = 0; f < numFrames; f++) {
    const base = f * frameLen;
    frames[base] = 0xff;
    frames[base + 1] = 0xfb; // MPEG1 Layer III, no CRC
    frames[base + 2] = 0xb0; // 192 kbps (idx 11), 44100 Hz (idx 0), padding 0
    frames[base + 3] = 0x00; // Stereo
    for (let i = 4; i < frameLen; i++) {
      frames[base + i] = ((f + 1) * 31 + i * 7) & 0xff;
    }
  }
  return { mp3: frames, mpegFrames: frames };
}

function makeSyntheticFlac() {
  // STREAMINFO (34 bytes): 48000 Hz, 2 channels, 24-bit, totalSamples = 480000 (10.0s)
  const streamInfo = new Uint8Array(34);
  // min/max block size 4096
  streamInfo.set(u16BE(4096), 0);
  streamInfo.set(u16BE(4096), 2);
  // Pack 20-bit sampleRate (48000 = 0x0BB80), 3-bit (channels-1 = 1), 5-bit (bitDepth-1 = 23), 36-bit totalSamples (480000)
  const sr = 48000;
  const chMinus1 = 1; // stereo
  const bpsMinus1 = 23; // 24-bit
  const totalSamples = 480000;
  streamInfo[10] = (sr >>> 12) & 0xff;
  streamInfo[11] = (sr >>> 4) & 0xff;
  streamInfo[12] = ((sr & 0x0f) << 4) | ((chMinus1 & 0x07) << 1) | ((bpsMinus1 >>> 4) & 0x01);
  streamInfo[13] = ((bpsMinus1 & 0x0f) << 4) | (Math.floor(totalSamples / 0x100000000) & 0x0f);
  streamInfo.set(u32BE(totalSamples >>> 0), 14);
  // MD5 bytes 18..33
  for (let i = 18; i < 34; i++) streamInfo[i] = i;

  // Custom SEEKTABLE block (type 3, 18 bytes) to verify non-tag metadata block preservation
  const seekPayload = new Uint8Array(18);
  for (let i = 0; i < 18; i++) seekPayload[i] = 0xa0 + i;

  // Existing VORBIS_COMMENT with a custom REPLAYGAIN_TRACK_GAIN tag to verify preservation
  const vendor = enc.encode('reference libFLAC 1.4.3');
  const customTag = enc.encode('REPLAYGAIN_TRACK_GAIN=-7.25 dB');
  const vcPayload = concat([
    u32LE(vendor.length),
    vendor,
    u32LE(1),
    u32LE(customTag.length),
    customTag,
  ]);

  const blockHdr = (type, len, isLast) =>
    new Uint8Array([(isLast ? 0x80 : 0) | type, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff]);

  // Dummy FLAC audio frame payload
  const audioFrames = new Uint8Array(512);
  audioFrames[0] = 0xff;
  audioFrames[1] = 0xf8; // FLAC frame sync
  for (let i = 2; i < audioFrames.length; i++) audioFrames[i] = (i * 29 + 3) & 0xff;

  const flac = concat([
    ascii('fLaC'),
    blockHdr(0, streamInfo.length, false),
    streamInfo,
    blockHdr(3, seekPayload.length, false),
    seekPayload,
    blockHdr(4, vcPayload.length, true),
    vcPayload,
    audioFrames,
  ]);

  return { flac, audioFrames, seekPayload, streamInfo };
}

function makeRichUnicodeTags() {
  return {
    ...createEmptyTags(),
    title: 'Nuit à Paris — Café Nocturne',
    artist: 'Saint Gordon',
    albumArtist: 'Saint Gordon Collective',
    album: 'Archive IV: Paper & Toner',
    year: '2026-11-24',
    track: '3/10',
    genre: 'Electronic / Post-Punk',
    bpm: '124',
    key: 'C#m (12A)',
    isrc: 'AU-SGC-26-00042',
    publisher: 'Saint Gordon Collective',
    composer: 'Bryn Gordon',
    copyright: '℗ & © 2026 Saint Gordon — Café Press',
    comment: 'Mastered at 24-bit / 48 kHz — zero re-encode verified',
    subtitle: 'Extended Club Master',
    lyricist: 'Bryn Gordon',
    disc: '1/2',
    mood: 'Dark, Driving, Hypnotic',
    engineer: 'Elena Vance',
    encodedBy: 'Saint Gordon Studio',
    software: 'Saint Gordon Tag & Seal 1.0',
    artistUrl: 'https://saintgordon.vercel.app',
    lyrics: 'Silver grain on white paper\nCafé lights at 3 AM — ℗\nEvery sample sealed intact',
    lyricsLanguage: 'eng',
  };
}

function assertAllTagsMatch(actual, expected, formatName) {
  const keys = [
    'title', 'artist', 'albumArtist', 'album', 'year', 'track', 'genre',
    'bpm', 'key', 'isrc', 'publisher', 'composer', 'copyright', 'comment',
    'subtitle', 'lyricist', 'disc', 'mood', 'engineer', 'encodedBy',
    'software', 'artistUrl', 'lyrics',
  ];
  for (const k of keys) {
    assert.equal(actual[k], expected[k], `${formatName}: tag "${k}" round-trip mismatch`);
  }
}

// ============================================================================
// Tests
// ============================================================================

test('Pure-JS image header parser inspects PNG and JPEG dimensions accurately', () => {
  const png = makeFakePng(1400, 1400);
  const pngInfo = inspectImageBytes(png);
  assert.equal(pngInfo.mime, 'image/png');
  assert.equal(pngInfo.width, 1400);
  assert.equal(pngInfo.height, 1400);

  const jpg = makeFakeJpeg(3000, 2000);
  const jpgInfo = inspectImageBytes(jpg);
  assert.equal(jpgInfo.mime, 'image/jpeg');
  assert.equal(jpgInfo.width, 3000);
  assert.equal(jpgInfo.height, 2000);
});

test('WAV lossless round-trip: all tags, Unicode, PNG cover art, LIST(INFO) + ID3v2.3, and bit-for-bit PCM + bext preservation', () => {
  const { wav, pcmData, bextPayload } = makeSyntheticWav();
  const initialDoc = parseAudioFile(wav, 'demo.wav');

  assert.equal(initialDoc.format, 'WAV');
  assert.equal(initialDoc.tech.sampleRate, 48000);
  assert.equal(initialDoc.tech.bitDepth, 24);
  assert.equal(initialDoc.tech.channels, 2);
  assert.equal(initialDoc.tech.codec, 'PCM');
  assert.ok(initialDoc.tech.chunks.includes('bext'));
  assert.equal(initialDoc.extraRiffInfo.ITCH, 'Studio Assistant');

  const tags = makeRichUnicodeTags();
  const coverPng = makeFakePng(1400, 1400, 525); // >128 bytes to prove ID3v2.3 BE frame size
  const sealed = sealAudioFile(
    wav,
    tags,
    [{ data: coverPng, mime: 'image/png', picType: 3, description: 'Front Cover — Café', width: 1400, height: 1400 }],
    {
      format: 'WAV',
      syncInfoAndId3: true,
      extraRiffInfo: initialDoc.extraRiffInfo,
    }
  );

  // Verify RIFF master header length matches file length - 8 exactly
  const riffSize = new DataView(sealed.bytes.buffer, sealed.bytes.byteOffset, sealed.bytes.byteLength).getUint32(4, true);
  assert.equal(riffSize, sealed.bytes.length - 8, 'RIFF master chunk size must equal fileSize - 8');

  // Re-parse and verify every tag, artwork, RIFF INFO sync, and preserved chunks
  const reparsed = parseAudioFile(sealed.bytes, 'sealed.wav');
  assertAllTagsMatch(reparsed.tags, tags, 'WAV');

  // Verify LIST(INFO) was synced AND unknown ITCH subchunk preserved
  assert.equal(reparsed.riffInfo.INAM, tags.title);
  assert.equal(reparsed.riffInfo.IART, tags.artist);
  assert.equal(reparsed.riffInfo.IPRD, tags.album);
  assert.equal(reparsed.riffInfo.ICRD, tags.year);
  assert.equal(reparsed.riffInfo.IENG, tags.engineer);
  assert.equal(reparsed.riffInfo.ISRC, tags.isrc);
  assert.equal(reparsed.extraRiffInfo.ITCH, 'Studio Assistant');
  assert.ok(reparsed.tech.chunks.includes('LIST(INFO)'));
  assert.ok(reparsed.tech.chunks.includes('id3 '));
  assert.ok(reparsed.tech.chunks.includes('bext'));

  // Verify embedded PNG artwork round-trips bit-for-bit
  assert.equal(reparsed.artworks.length, 1);
  assert.equal(reparsed.artworks[0].mime, 'image/png');
  assert.equal(reparsed.artworks[0].picType, 3);
  assert.equal(reparsed.artworks[0].description, 'Front Cover — Café');
  assert.equal(reparsed.artworks[0].width, 1400);
  assert.equal(reparsed.artworks[0].height, 1400);
  assert.deepEqual(reparsed.artworks[0].data, coverPng);

  // Verify PCM audio `data` chunk is 100% bit-for-bit identical
  const afterPcm = extractAudioPayloadSlice(sealed.bytes);
  assert.deepEqual(afterPcm, pcmData);
  assert.equal(checksumBytes(afterPcm), checksumBytes(pcmData));

  // Verify `bext` broadcast chunk bytes are 100% bit-for-bit identical
  let foundBext = null;
  let pos = 12;
  const view = new DataView(sealed.bytes.buffer, sealed.bytes.byteOffset, sealed.bytes.byteLength);
  while (pos + 8 <= sealed.bytes.length) {
    const id = String.fromCharCode(...sealed.bytes.subarray(pos, pos + 4));
    const sz = view.getUint32(pos + 4, true);
    if (id === 'bext') {
      foundBext = sealed.bytes.subarray(pos + 8, pos + 8 + sz);
      break;
    }
    pos += 8 + sz + (sz & 1);
  }
  assert.ok(foundBext, 'bext chunk must remain in sealed WAV');
  assert.deepEqual(foundBext, bextPayload);
});

test('WAV syncInfoAndId3: false preserves existing LIST(INFO) untouched while updating ID3v2.3', () => {
  const { wav } = makeSyntheticWav();
  const tags = { ...createEmptyTags(), title: 'ID3 Only Track', artist: 'Saint Gordon' };
  const sealed = sealAudioFile(wav, tags, [], { format: 'WAV', syncInfoAndId3: false });
  const reparsed = parseAudioFile(sealed.bytes, 'id3only.wav');
  assert.equal(reparsed.tags.title, 'ID3 Only Track');
  assert.equal(reparsed.extraRiffInfo.ITCH, 'Studio Assistant');
  assert.equal(reparsed.riffInfo.INAM, undefined, 'LIST(INFO) should not have INAM written when sync is OFF');
});

test('MP3 lossless round-trip: ID3v2.3 header (non-syncsafe frame sizes), Unicode, JPEG artwork, and untouched MPEG frames', () => {
  const { mp3, mpegFrames } = makeSyntheticMp3();
  const initialDoc = parseAudioFile(mp3, 'track.mp3');

  assert.equal(initialDoc.format, 'MP3');
  assert.equal(initialDoc.tech.sampleRate, 44100);
  assert.equal(initialDoc.tech.bitrateKbps, 192);
  assert.equal(initialDoc.tech.channels, 2);
  assert.equal(initialDoc.tech.codec, 'MPEG-1 Layer III');

  const tags = makeRichUnicodeTags();
  const coverJpg = makeFakeJpeg(3000, 3000, 680); // large enough to verify BE uint32 frame size > 128

  const sealed = sealAudioFile(
    mp3,
    tags,
    [{ data: coverJpg, mime: 'image/jpeg', picType: 3, description: 'Cover', width: 3000, height: 3000 }],
    { format: 'MP3' }
  );

  // Confirm ID3v2.3 header signature & version bytes
  assert.equal(String.fromCharCode(sealed.bytes[0], sealed.bytes[1], sealed.bytes[2]), 'ID3');
  assert.equal(sealed.bytes[3], 3, 'Must write ID3v2.3');
  assert.equal(sealed.bytes[4], 0);

  // Verify APIC frame size is strictly big-endian uint32 (NOT syncsafe)
  const id3TagBodyLen =
    ((sealed.bytes[6] & 0x7f) << 21) |
    ((sealed.bytes[7] & 0x7f) << 14) |
    ((sealed.bytes[8] & 0x7f) << 7) |
    (sealed.bytes[9] & 0x7f);
  const tagBody = sealed.bytes.subarray(10, 10 + id3TagBodyLen);
  let pos = 0;
  let apicFrameSize = 0;
  while (pos + 10 <= tagBody.length) {
    const fid = String.fromCharCode(...tagBody.subarray(pos, pos + 4));
    const fsz = new DataView(tagBody.buffer, tagBody.byteOffset + pos + 4, 4).getUint32(0, false);
    if (fid === 'APIC') {
      apicFrameSize = fsz;
      break;
    }
    pos += 10 + fsz;
  }
  assert.ok(apicFrameSize > coverJpg.length, 'ID3v2.3 APIC frame must use standard big-endian uint32 size');

  // Re-parse and assert every tag + cover art + untouched MPEG bytes
  const reparsed = parseAudioFile(sealed.bytes, 'sealed.mp3');
  assert.equal(reparsed.tech.id3Version, 'ID3v2.3');
  assertAllTagsMatch(reparsed.tags, tags, 'MP3');

  assert.equal(reparsed.artworks.length, 1);
  assert.equal(reparsed.artworks[0].mime, 'image/jpeg');
  assert.equal(reparsed.artworks[0].picType, 3);
  assert.equal(reparsed.artworks[0].width, 3000);
  assert.equal(reparsed.artworks[0].height, 3000);
  assert.deepEqual(reparsed.artworks[0].data, coverJpg);

  const afterMpeg = extractAudioPayloadSlice(sealed.bytes);
  assert.deepEqual(afterMpeg, mpegFrames);
  assert.equal(checksumBytes(afterMpeg), checksumBytes(mpegFrames));
});

test('FLAC lossless round-trip: VORBIS_COMMENT, PICTURE, STREAMINFO + SEEKTABLE + audio frames preserved bit-for-bit', () => {
  const { flac, audioFrames } = makeSyntheticFlac();
  const initialDoc = parseAudioFile(flac, 'master.flac');

  assert.equal(initialDoc.format, 'FLAC');
  assert.equal(initialDoc.tech.sampleRate, 48000);
  assert.equal(initialDoc.tech.bitDepth, 24);
  assert.equal(initialDoc.tech.channels, 2);
  assert.equal(initialDoc.tech.durationSeconds, 10);
  assert.ok(initialDoc.tech.chunks.includes('STREAMINFO'));
  assert.ok(initialDoc.tech.chunks.includes('SEEKTABLE'));
  assert.deepEqual(initialDoc.extraVorbisComments, [['REPLAYGAIN_TRACK_GAIN', '-7.25 dB']]);

  const tags = makeRichUnicodeTags();
  const coverJpg = makeFakeJpeg(1400, 1400, 500);

  const sealed = sealAudioFile(
    flac,
    tags,
    [{ data: coverJpg, mime: 'image/jpeg', picType: 3, description: 'Front Cover', width: 1400, height: 1400 }],
    {
      format: 'FLAC',
      vorbisVendor: initialDoc.vorbisVendor,
      extraVorbisComments: initialDoc.extraVorbisComments,
    }
  );

  const reparsed = parseAudioFile(sealed.bytes, 'sealed.flac');
  assertAllTagsMatch(reparsed.tags, tags, 'FLAC');
  assert.ok(reparsed.tech.chunks.includes('STREAMINFO'));
  assert.ok(reparsed.tech.chunks.includes('SEEKTABLE'));
  assert.ok(reparsed.tech.chunks.includes('VORBIS_COMMENT'));
  assert.ok(reparsed.tech.chunks.includes('PICTURE'));
  assert.deepEqual(reparsed.extraVorbisComments, [['REPLAYGAIN_TRACK_GAIN', '-7.25 dB']]);

  assert.equal(reparsed.artworks.length, 1);
  assert.equal(reparsed.artworks[0].mime, 'image/jpeg');
  assert.equal(reparsed.artworks[0].picType, 3);
  assert.equal(reparsed.artworks[0].width, 1400);
  assert.equal(reparsed.artworks[0].height, 1400);
  assert.deepEqual(reparsed.artworks[0].data, coverJpg);

  const afterFrames = extractAudioPayloadSlice(sealed.bytes);
  assert.deepEqual(afterFrames, audioFrames);
  assert.equal(checksumBytes(afterFrames), checksumBytes(audioFrames));
});

test('ID3v2.4 reader handles syncsafe frame sizes, UTF-8 (0x03), TDRC date, and APIC accurately', () => {
  const { mpegFrames } = makeSyntheticMp3();
  const coverPng = makeFakePng(800, 800, 300); // > 128 bytes so syncsafe != big-endian!

  const makeV24Frame = (id, payload) =>
    concat([ascii(id), syncsafe32(payload.length), new Uint8Array([0, 0]), payload]);

  const tit2 = makeV24Frame('TIT2', concat([new Uint8Array([3]), enc.encode('Velvet Static — Édition')]));
  const tpe1 = makeV24Frame('TPE1', concat([new Uint8Array([3]), enc.encode('Saint Gordon')]));
  const tdrc = makeV24Frame('TDRC', concat([new Uint8Array([3]), enc.encode('2026-08-19')]));
  const tcon = makeV24Frame('TCON', concat([new Uint8Array([3]), enc.encode('(17)')])); // Numeric genre ref -> Rock
  const tbpm = makeV24Frame('TBPM', concat([new Uint8Array([3]), enc.encode('132')]));
  const apicPayload = concat([
    new Uint8Array([3]),
    ascii('image/png'),
    new Uint8Array([0]),
    new Uint8Array([3]),
    enc.encode('v2.4 Cover'),
    new Uint8Array([0]),
    coverPng,
  ]);
  const apic = makeV24Frame('APIC', apicPayload);

  const body = concat([tit2, tpe1, tdrc, tcon, tbpm, apic]);
  const v24Header = concat([ascii('ID3'), new Uint8Array([4, 0, 0]), syncsafe32(body.length)]);
  const mp3v24 = concat([v24Header, body, mpegFrames]);

  const parsed = parseAudioFile(mp3v24, 'v24.mp3');
  assert.equal(parsed.tech.id3Version, 'ID3v2.4');
  assert.equal(parsed.tags.title, 'Velvet Static — Édition');
  assert.equal(parsed.tags.artist, 'Saint Gordon');
  assert.equal(parsed.tags.year, '2026-08-19');
  assert.equal(parsed.tags.genre, 'Rock');
  assert.equal(parsed.tags.bpm, '132');
  assert.equal(parsed.artworks.length, 1);
  assert.equal(parsed.artworks[0].width, 800);
  assert.deepEqual(parsed.artworks[0].data, coverPng);
});

test('ID3v2.2 reader handles 3-character frame IDs and PIC artwork', () => {
  const { mpegFrames } = makeSyntheticMp3();
  const coverJpg = makeFakeJpeg(600, 600, 200);

  const makeV22Frame = (id3Char, payload) =>
    concat([
      ascii(id3Char),
      new Uint8Array([(payload.length >>> 16) & 0xff, (payload.length >>> 8) & 0xff, payload.length & 0xff]),
      payload,
    ]);

  const tt2 = makeV22Frame('TT2', concat([new Uint8Array([0]), ascii('Legacy Single')]));
  const tp1 = makeV22Frame('TP1', concat([new Uint8Array([0]), ascii('Saint Gordon')]));
  const pic = makeV22Frame(
    'PIC',
    concat([new Uint8Array([0]), ascii('JPG'), new Uint8Array([3]), new Uint8Array([0]), coverJpg])
  );
  const body = concat([tt2, tp1, pic]);
  const hdr = concat([ascii('ID3'), new Uint8Array([2, 0, 0]), syncsafe32(body.length)]);
  const mp3v22 = concat([hdr, body, mpegFrames]);

  const parsed = parseAudioFile(mp3v22, 'legacy.mp3');
  assert.equal(parsed.tech.id3Version, 'ID3v2.2');
  assert.equal(parsed.tags.title, 'Legacy Single');
  assert.equal(parsed.tags.artist, 'Saint Gordon');
  assert.equal(parsed.artworks.length, 1);
  assert.equal(parsed.artworks[0].mime, 'image/jpeg');
  assert.equal(parsed.artworks[0].width, 600);
  assert.deepEqual(parsed.artworks[0].data, coverJpg);
});

test('MP3 ID3v1.1 fallback reads tags when no ID3v2 exists, and stripAll wipes metadata losslessly', () => {
  const { mpegFrames } = makeSyntheticMp3();
  const v1 = new Uint8Array(128);
  v1.set(ascii('TAG'), 0);
  v1.set(ascii('Midnight Demo'), 3);
  v1.set(ascii('Saint Gordon'), 33);
  v1.set(ascii('Tape Archive'), 63);
  v1.set(ascii('2026'), 93);
  v1.set(ascii('Analog bounce'), 97);
  v1[125] = 0;
  v1[126] = 4; // Track 4 (ID3v1.1)
  v1[127] = 52; // Electronic

  const mp3WithV1 = concat([mpegFrames, v1]);
  const parsed = parseAudioFile(mp3WithV1, 'v1.mp3');
  assert.equal(parsed.tech.id3Version, 'ID3v1');
  assert.equal(parsed.tags.title, 'Midnight Demo');
  assert.equal(parsed.tags.artist, 'Saint Gordon');
  assert.equal(parsed.tags.album, 'Tape Archive');
  assert.equal(parsed.tags.year, '2026');
  assert.equal(parsed.tags.track, '4');
  assert.equal(parsed.tags.genre, 'Electronic');

  // Strip all metadata from WAV, MP3 (including ID3v1), and FLAC
  const strippedMp3 = sealAudioFile(mp3WithV1, createEmptyTags(), [], { format: 'MP3', stripAll: true });
  assert.deepEqual(strippedMp3.bytes, mpegFrames);

  const { wav, pcmData } = makeSyntheticWav();
  const strippedWav = sealAudioFile(wav, createEmptyTags(), [], { format: 'WAV', stripAll: true });
  const parsedStrippedWav = parseAudioFile(strippedWav.bytes, 'clean.wav');
  assert.equal(parsedStrippedWav.tags.title, '');
  assert.equal(parsedStrippedWav.artworks.length, 0);
  assert.ok(!parsedStrippedWav.tech.chunks.includes('LIST(INFO)'));
  assert.ok(!parsedStrippedWav.tech.chunks.includes('id3 '));
  assert.deepEqual(extractAudioPayloadSlice(strippedWav.bytes), pcmData);

  const { flac, audioFrames } = makeSyntheticFlac();
  const strippedFlac = sealAudioFile(flac, createEmptyTags(), [], { format: 'FLAC', stripAll: true });
  const parsedStrippedFlac = parseAudioFile(strippedFlac.bytes, 'clean.flac');
  assert.equal(parsedStrippedFlac.tags.title, '');
  assert.ok(!parsedStrippedFlac.tech.chunks.includes('VORBIS_COMMENT'));
  assert.ok(!parsedStrippedFlac.tech.chunks.includes('PICTURE'));
  assert.deepEqual(extractAudioPayloadSlice(strippedFlac.bytes), audioFrames);
});

test('Direct ID3v2.3 builder emits null when empty and parses back UTF-16LE + ASCII cleanly', () => {
  assert.equal(buildId3v23(createEmptyTags(), []), null);
  const bytes = buildId3v23({ ...createEmptyTags(), title: 'ASCII Title', comment: 'Unicode — ℗ © 日本語' }, []);
  const parsed = parseId3v2(bytes);
  assert.equal(parsed.version, 'ID3v2.3');
  assert.equal(parsed.tags.title, 'ASCII Title');
  assert.equal(parsed.tags.comment, 'Unicode — ℗ © 日本語');
  assert.equal(detectAudioFormat(bytes), 'MP3');
});

test('ID3v2.3 reader handles global unsynchronization (0x80) and extended headers (0x40)', () => {
  const extHeader = concat([u32BE(6), new Uint8Array([0, 0, 0, 0, 0, 0])]);
  const tit2Payload = concat([new Uint8Array([0]), ascii('Unsynced Master')]);
  const tit2Frame = concat([ascii('TIT2'), u32BE(tit2Payload.length), new Uint8Array([0, 0]), tit2Payload]);
  // Inject a fake FF 00 unsync sequence inside an APIC payload to prove de-unsync works
  const rawImg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const apicPayload = concat([
    new Uint8Array([0]),
    ascii('image/jpeg'),
    new Uint8Array([0]),
    new Uint8Array([3]),
    new Uint8Array([0]),
    rawImg,
  ]);
  const apicFrame = concat([ascii('APIC'), u32BE(apicPayload.length), new Uint8Array([0, 0]), apicPayload]);
  const plainBody = concat([extHeader, tit2Frame, apicFrame]);

  // Apply ID3v2.3 unsynchronization (0xFF -> 0xFF 0x00)
  const unsynced = [];
  for (let i = 0; i < plainBody.length; i++) {
    unsynced.push(plainBody[i]);
    if (plainBody[i] === 0xff) unsynced.push(0x00);
  }
  const unsyncedBody = new Uint8Array(unsynced);
  const hdr = concat([ascii('ID3'), new Uint8Array([3, 0, 0xc0]), syncsafe32(unsyncedBody.length)]);
  const parsed = parseId3v2(concat([hdr, unsyncedBody]));

  assert.equal(parsed.version, 'ID3v2.3');
  assert.equal(parsed.tags.title, 'Unsynced Master');
  assert.equal(parsed.artworks.length, 1);
  assert.deepEqual(parsed.artworks[0].data, rawImg);
});

test('Saint Gordon Xerox filter outputs deterministic 1-bit Rec.709 monochrome pixels', () => {
  const imageData = {
    data: new Uint8ClampedArray([
      0, 0, 0, 255,       // deep black -> stays 0
      255, 255, 255, 255, // pure white -> stays 255
      130, 130, 130, 255, // midtone -> thresholded with grain to 0 or 255
      20, 200, 30, 255,   // high Rec.709 green luma (~149) -> 0 or 255
    ]),
  };
  applySaintGordonXerox(imageData);
  assert.equal(imageData.data[0], 0);
  assert.equal(imageData.data[4], 255);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const v = imageData.data[i];
    assert.ok(v === 0 || v === 255, 'Every output channel must be strictly 0 or 255');
    assert.equal(imageData.data[i + 1], v);
    assert.equal(imageData.data[i + 2], v);
    assert.equal(imageData.data[i + 3], 255);
  }
});
