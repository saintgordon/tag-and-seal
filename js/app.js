/**
 * Tag & Seal — Studio UI Controller
 * Pure Vanilla ES Module (zero external dependencies)
 */

import {
  PICTURE_TYPES,
  checksumBytes,
  createEmptyTags,
  extractAudioPayloadSlice,
  formatDuration,
  formatFileSize,
  formatSampleRate,
  parseAudioFile,
  sealAudioFile,
} from './metadata-engine.js';
import { createArtworkSource, processArtwork } from './artwork-processor.js';

// All 24 Major & Minor keys paired with Camelot Wheel notation
const MUSICAL_KEY_GROUPS = [
  {
    label: 'Minor Keys (Camelot A)',
    keys: [
      'G#m (1A)', 'Ebm (2A)', 'Bbm (3A)', 'Fm (4A)',
      'Cm (5A)', 'Gm (6A)', 'Dm (7A)', 'Am (8A)',
      'Em (9A)', 'Bm (10A)', 'F#m (11A)', 'C#m (12A)',
    ],
  },
  {
    label: 'Major Keys (Camelot B)',
    keys: [
      'B (1B)', 'F# (2B)', 'Db (3B)', 'Ab (4B)',
      'Eb (5B)', 'Bb (6B)', 'F (7B)', 'C (8B)',
      'G (9B)', 'D (10B)', 'A (11B)', 'E (12B)',
    ],
  },
];

// ============================================================================
// Application State
// ============================================================================

const state = {
  originalBytes: null,
  originalFileName: '',
  doc: null,
  originalAudioChecksum: '',
  originalAudioLength: 0,
  // Cover Art Studio state
  originalArtSource: null, // untouched decoded source for lossless re-renders / revert
  currentArt: null,        // processed { data, mime, width, height, picType, description }
  artPreviewUrl: null,
  artRenderSeq: 0,
  // Audio preview player
  audioEl: new Audio(),
  audioUrl: null,
  isSeeking: false,
  // Form & export state
  filenameMode: 'original', // 'original' | 'artist-title' | 'custom'
  dirty: false,
  stripAllPending: false,
};

// ============================================================================
// DOM References
// ============================================================================

const $ = (id) => document.getElementById(id);

const dom = {
  audioInput: $('audio-file-input'),
  coverInput: $('cover-file-input'),
  btnHeaderSwap: $('btn-header-swap'),
  heroBand: $('hero-band'),
  dropzoneSection: $('audio-dropzone-section'),
  dropzoneTarget: $('audio-dropzone-target'),
  btnSelectAudio: $('btn-select-audio'),
  btnLoadDemo: $('btn-load-demo'),
  workspace: $('studio-workspace'),

  // Seal Deck
  studioDeck: $('studio-deck'),
  deckFormatReadout: $('deck-format-readout'),
  deckStatePill: $('deck-state-pill'),
  deckFormatStamp: $('deck-format-stamp'),
  deckFilename: $('deck-filename'),
  deckSpecsRow: $('deck-specs-row'),
  btnAutofillFilename: $('btn-autofill-filename'),
  btnSgDefaults: $('btn-sg-defaults'),
  btnStripAll: $('btn-strip-all'),
  btnPreviewPlay: $('btn-preview-play'),
  previewPlayGlyph: $('preview-play-glyph'),
  previewPlayLabel: $('preview-play-label'),
  previewTimeCur: $('preview-time-cur'),
  previewTimeDur: $('preview-time-dur'),
  previewSeek: $('preview-seek'),
  previewVolume: $('preview-volume'),

  // Cover Art Studio
  artStatusTag: $('art-status-tag'),
  artDropzone: $('art-dropzone'),
  artPreviewImg: $('art-preview-img'),
  artEmptyState: $('art-empty-state'),
  artDimPill: $('art-dim-pill'),
  artFmtPill: $('art-fmt-pill'),
  artSizePill: $('art-size-pill'),
  btnUploadArt: $('btn-upload-art'),
  btnExtractArt: $('btn-extract-art'),
  btnRemoveArt: $('btn-remove-art'),
  artResolution: $('art-resolution'),
  artFormat: $('art-format'),
  artPicType: $('art-pic-type'),
  toggleXerox: $('toggle-xerox'),
  btnRevertArt: $('btn-revert-art'),
  artAutoNote: $('art-auto-note'),

  // Key Track Info
  unsavedIndicator: $('unsaved-indicator'),
  wavSyncBanner: $('wav-sync-banner'),
  toggleWavSync: $('toggle-wav-sync'),
  keyPresetSelect: $('key-preset-select'),
  isrcHint: $('isrc-hint'),

  // Primary fields
  tagTitle: $('tag-title'),
  tagArtist: $('tag-artist'),
  tagAlbumArtist: $('tag-album-artist'),
  tagAlbum: $('tag-album'),
  tagYear: $('tag-year'),
  tagTrack: $('tag-track'),
  tagGenre: $('tag-genre'),
  tagBpm: $('tag-bpm'),
  tagKey: $('tag-key'),
  tagIsrc: $('tag-isrc'),
  tagPublisher: $('tag-publisher'),
  tagComposer: $('tag-composer'),
  tagCopyright: $('tag-copyright'),
  tagComment: $('tag-comment'),

  // Lyrics drawer
  tagLyricsLang: $('tag-lyrics-lang'),
  tagLyrics: $('tag-lyrics'),
  lyricsCountBadge: $('lyrics-count-badge'),
  lyricsLiveStats: $('lyrics-live-stats'),

  // Extended credits drawer
  tagSubtitle: $('tag-subtitle'),
  tagLyricist: $('tag-lyricist'),
  tagDisc: $('tag-disc'),
  tagMood: $('tag-mood'),
  tagEngineer: $('tag-engineer'),
  tagEncodedBy: $('tag-encoded-by'),
  tagArtistUrl: $('tag-artist-url'),
  tagSoftware: $('tag-software'),
  extendedFilledBadge: $('extended-filled-badge'),

  // Technical inspector
  techSummaryBadge: $('tech-summary-badge'),
  techSpecsGrid: $('tech-specs-grid'),
  techChunksList: $('tech-chunks-list'),

  // Seal & Download
  outputFilename: $('output-filename'),
  btnNameOriginal: $('btn-name-original'),
  btnNameArtistTitle: $('btn-name-artist-title'),
  btnSealDownload: $('btn-seal-download'),
  sealBtnLabel: $('seal-btn-label'),
  sealVerifBanner: $('seal-verification-banner'),
  sealVerifBadge: $('seal-verif-badge'),
  sealVerifChecksum: $('seal-verif-checksum'),
  sealVerifSummary: $('seal-verif-summary'),

  toastContainer: $('toast-container'),
  footerYear: $('footer-year'),
};

// ============================================================================
// Toast Notifications
// ============================================================================

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast${type === 'error' ? ' toast-error' : ''}`;
  toast.textContent = message;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
    setTimeout(() => toast.remove(), 260);
  }, 3400);
}

// ============================================================================
// Initialization
// ============================================================================

function initSelectors() {
  // Populate Picture Type selector
  dom.artPicType.innerHTML = '';
  for (const pt of PICTURE_TYPES) {
    const opt = document.createElement('option');
    opt.value = String(pt.code);
    opt.textContent = pt.label;
    dom.artPicType.appendChild(opt);
  }
  dom.artPicType.value = '3'; // Front Cover default

  // Populate Musical Key / Camelot selector
  for (const grp of MUSICAL_KEY_GROUPS) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = grp.label;
    for (const k of grp.keys) {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      optgroup.appendChild(opt);
    }
    dom.keyPresetSelect.appendChild(optgroup);
  }

  if (dom.footerYear) {
    dom.footerYear.textContent = String(new Date().getFullYear());
  }
}

// ============================================================================
// Audio Preview Player
// ============================================================================

function initAudioPreview() {
  const audio = state.audioEl;
  audio.preload = 'metadata';
  audio.volume = parseFloat(dom.previewVolume.value) || 0.85;

  audio.addEventListener('play', () => {
    dom.studioDeck.dataset.state = 'playing';
    dom.deckStatePill.textContent = 'AUDITIONING';
    dom.previewPlayGlyph.textContent = '❚❚';
    dom.previewPlayLabel.textContent = 'Pause';
  });

  audio.addEventListener('pause', () => {
    dom.studioDeck.dataset.state = 'paused';
    dom.deckStatePill.textContent = state.dirty ? 'MODIFIED' : 'READY';
    dom.previewPlayGlyph.textContent = '▶';
    dom.previewPlayLabel.textContent = 'Audition Track';
  });

  audio.addEventListener('ended', () => {
    dom.studioDeck.dataset.state = 'paused';
    dom.deckStatePill.textContent = state.dirty ? 'MODIFIED' : 'READY';
    dom.previewPlayGlyph.textContent = '▶';
    dom.previewPlayLabel.textContent = 'Audition Track';
    dom.previewSeek.value = '0';
    dom.previewTimeCur.textContent = '00:00';
  });

  audio.addEventListener('loadedmetadata', () => {
    const dur = Number.isFinite(audio.duration) ? audio.duration : state.doc?.tech.durationSeconds || 0;
    dom.previewSeek.max = String(Math.max(1, dur));
    dom.previewTimeDur.textContent = formatDuration(dur);
  });

  audio.addEventListener('timeupdate', () => {
    if (state.isSeeking) return;
    const cur = audio.currentTime || 0;
    dom.previewSeek.value = String(cur);
    dom.previewTimeCur.textContent = formatDuration(cur);
  });

  dom.btnPreviewPlay.addEventListener('click', async () => {
    if (!state.audioUrl) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch (err) {
        showToast(`Could not play audio preview in this browser (${err.message || 'unsupported codec'}).`, 'error');
      }
    } else {
      audio.pause();
    }
  });

  dom.previewSeek.addEventListener('input', () => {
    state.isSeeking = true;
    dom.previewTimeCur.textContent = formatDuration(parseFloat(dom.previewSeek.value));
  });

  dom.previewSeek.addEventListener('change', () => {
    audio.currentTime = parseFloat(dom.previewSeek.value) || 0;
    state.isSeeking = false;
  });

  dom.previewVolume.addEventListener('input', () => {
    audio.volume = parseFloat(dom.previewVolume.value);
  });
}

function setAudioPreviewSource(bytes, format) {
  state.audioEl.pause();
  if (state.audioUrl) {
    URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = null;
  }
  const mime = format === 'MP3' ? 'audio/mpeg' : format === 'FLAC' ? 'audio/flac' : 'audio/wav';
  const blob = new Blob([bytes], { type: mime });
  state.audioUrl = URL.createObjectURL(blob);
  state.audioEl.src = state.audioUrl;
  state.audioEl.load();
  dom.previewSeek.value = '0';
  dom.previewTimeCur.textContent = '00:00';
  dom.previewTimeDur.textContent = formatDuration(state.doc?.tech.durationSeconds || 0);
}

// ============================================================================
// Loading Audio Files
// ============================================================================

async function loadAudioBytes(bytes, fileName) {
  let doc;
  try {
    doc = parseAudioFile(bytes, fileName);
  } catch (err) {
    showToast(err.message || 'Could not parse audio file.', 'error');
    return;
  }

  state.originalBytes = bytes;
  state.originalFileName = fileName;
  state.doc = doc;
  state.dirty = false;
  state.stripAllPending = false;
  state.filenameMode = 'original';

  const audioSlice = extractAudioPayloadSlice(bytes);
  state.originalAudioLength = audioSlice.length;
  state.originalAudioChecksum = checksumBytes(audioSlice);

  // Switch UI to active workspace
  dom.dropzoneSection.classList.add('hidden');
  dom.workspace.classList.remove('hidden');
  dom.btnHeaderSwap.classList.remove('hidden');
  dom.heroBand.classList.add('compact');
  dom.sealVerifBanner.classList.add('hidden');

  setAudioPreviewSource(bytes, doc.format);
  populateDeckHeader(doc);
  populateFormFromTags(doc.tags);
  populateTechnicalInspector(doc);
  updateExportControls();

  // Show WAV sync switch only for WAV files
  if (doc.format === 'WAV') {
    dom.wavSyncBanner.classList.remove('hidden');
    dom.toggleWavSync.checked = true;
  } else {
    dom.wavSyncBanner.classList.add('hidden');
  }

  // Load embedded artwork if present
  if (doc.artworks && doc.artworks.length > 0) {
    const firstArt = doc.artworks[0];
    try {
      const source = await createArtworkSource(firstArt.data, firstArt.mime);
      state.originalArtSource = source;
      dom.artResolution.value = 'original';
      dom.artFormat.value = source.mime === 'image/png' ? 'image/png' : 'image/jpeg';
      dom.artPicType.value = String(firstArt.picType ?? 3);
      dom.toggleXerox.checked = false;
      dom.toggleXerox.disabled = false;
      state.currentArt = {
        data: firstArt.data,
        mime: firstArt.mime,
        width: firstArt.width || source.width,
        height: firstArt.height || source.height,
        picType: firstArt.picType ?? 3,
        description: firstArt.description || '',
        xeroxApplied: false,
      };
      renderCoverArtUI('EMBEDDED');
    } catch {
      clearCoverArtState(false);
    }
  } else {
    clearCoverArtState(false);
  }

  markDirty(false);
  showToast(`Loaded ${doc.format} master: ${fileName}`);
}

async function handleAudioFileSelected(file) {
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    await loadAudioBytes(new Uint8Array(buf), file.name);
  } catch (err) {
    showToast(`Failed reading file: ${err.message || err}`, 'error');
  }
}

function populateDeckHeader(doc) {
  const { tech, format } = doc;
  const readoutMap = {
    WAV: 'WAV · RIFF LIST(INFO) + ID3v2.3',
    MP3: 'MP3 · ID3v2.3 HEADER + MPEG FRAMES',
    FLAC: 'FLAC · VORBIS_COMMENT + PICTURE',
  };
  dom.deckFormatReadout.textContent = readoutMap[format] || format;
  dom.deckFormatStamp.textContent = format;
  dom.deckFilename.textContent = doc.fileName;

  const pills = [];
  if (tech.codec) pills.push(tech.codec);
  if (tech.sampleRate) pills.push(formatSampleRate(tech.sampleRate));
  if (tech.bitDepth) pills.push(`${tech.bitDepth}-bit`);
  else if (tech.bitrateKbps) pills.push(`${tech.bitrateKbps} kbps`);
  if (tech.channelLabel) pills.push(tech.channelLabel);
  if (tech.durationSeconds > 0) pills.push(formatDuration(tech.durationSeconds));
  pills.push(formatFileSize(tech.fileSizeBytes));
  if (tech.id3Version) pills.push(tech.id3Version);

  dom.deckSpecsRow.innerHTML = '';
  for (const label of pills) {
    const span = document.createElement('span');
    span.className = 'deck-spec-pill';
    span.textContent = label;
    dom.deckSpecsRow.appendChild(span);
  }
}

function populateTechnicalInspector(doc) {
  const { tech } = doc;
  const summaryParts = [
    tech.format,
    tech.sampleRate ? formatSampleRate(tech.sampleRate) : null,
    tech.bitDepth ? `${tech.bitDepth}-BIT` : tech.bitrateKbps ? `${tech.bitrateKbps} KBPS` : null,
  ].filter(Boolean);
  dom.techSummaryBadge.textContent = summaryParts.join(' · ');

  const rows = [
    ['Container Format', tech.format],
    ['Audio Codec', tech.codec || '—'],
    ['Sample Rate', tech.sampleRate ? `${tech.sampleRate.toLocaleString()} Hz (${formatSampleRate(tech.sampleRate)})` : '—'],
    ['Bit Depth / Bitrate', tech.bitDepth ? `${tech.bitDepth}-bit (${tech.bitrateKbps ? `${tech.bitrateKbps} kbps` : 'Lossless'})` : tech.bitrateKbps ? `${tech.bitrateKbps} kbps${tech.isVBR ? ' VBR' : ' CBR'}` : '—'],
    ['Channels', tech.channels ? `${tech.channelLabel} (${tech.channels} ch)` : '—'],
    ['Duration', formatDuration(tech.durationSeconds)],
    ['Total File Size', `${formatFileSize(tech.fileSizeBytes)} (${tech.fileSizeBytes.toLocaleString()} B)`],
    ['Audio Payload Size', `${formatFileSize(tech.audioBytesLength)} (${tech.audioBytesLength.toLocaleString()} B)`],
    ['Tag Header Detected', tech.id3Version || (tech.format === 'FLAC' ? (tech.chunks.includes('VORBIS_COMMENT') ? 'VORBIS_COMMENT' : 'None') : tech.chunks.includes('LIST(INFO)') ? 'RIFF LIST(INFO)' : 'None')],
    ['Audio Stream Checksum', `FNV1A:${state.originalAudioChecksum}`],
  ];

  dom.techSpecsGrid.innerHTML = '';
  for (const [label, value] of rows) {
    const cell = document.createElement('div');
    cell.className = 'tech-cell';
    const lbl = document.createElement('span');
    lbl.className = 'tech-cell-label micro';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.className = 'tech-cell-value';
    val.textContent = value;
    cell.append(lbl, val);
    dom.techSpecsGrid.appendChild(cell);
  }

  dom.techChunksList.innerHTML = '';
  for (const ch of tech.chunks) {
    const pill = document.createElement('span');
    pill.className = 'chunk-pill';
    pill.textContent = ch;
    dom.techChunksList.appendChild(pill);
  }
}

// ============================================================================
// Form Binding & Validation
// ============================================================================

function populateFormFromTags(tags) {
  const t = { ...createEmptyTags(), ...(tags || {}) };
  dom.tagTitle.value = t.title;
  dom.tagArtist.value = t.artist;
  dom.tagAlbumArtist.value = t.albumArtist;
  dom.tagAlbum.value = t.album;
  dom.tagYear.value = t.year;
  dom.tagTrack.value = t.track;
  dom.tagGenre.value = t.genre;
  dom.tagBpm.value = t.bpm;
  dom.tagKey.value = t.key;
  dom.tagIsrc.value = t.isrc;
  dom.tagPublisher.value = t.publisher;
  dom.tagComposer.value = t.composer;
  dom.tagCopyright.value = t.copyright;
  dom.tagComment.value = t.comment;

  dom.tagLyrics.value = t.lyrics;
  dom.tagLyricsLang.value = t.lyricsLanguage || 'eng';

  dom.tagSubtitle.value = t.subtitle;
  dom.tagLyricist.value = t.lyricist;
  dom.tagDisc.value = t.disc;
  dom.tagMood.value = t.mood;
  dom.tagEngineer.value = t.engineer;
  dom.tagEncodedBy.value = t.encodedBy;
  dom.tagArtistUrl.value = t.artistUrl;
  dom.tagSoftware.value = t.software;

  syncKeyPresetSelect();
  updateIsrcHint();
  updateLyricsStats();
  updateExtendedCounter();
}

function readTagsFromForm() {
  return {
    title: dom.tagTitle.value.trim(),
    artist: dom.tagArtist.value.trim(),
    albumArtist: dom.tagAlbumArtist.value.trim(),
    album: dom.tagAlbum.value.trim(),
    year: dom.tagYear.value.trim(),
    track: dom.tagTrack.value.trim(),
    genre: dom.tagGenre.value.trim(),
    bpm: dom.tagBpm.value.trim(),
    key: dom.tagKey.value.trim(),
    isrc: dom.tagIsrc.value.trim().toUpperCase(),
    publisher: dom.tagPublisher.value.trim(),
    composer: dom.tagComposer.value.trim(),
    copyright: dom.tagCopyright.value.trim(),
    comment: dom.tagComment.value.trim(),
    subtitle: dom.tagSubtitle.value.trim(),
    lyricist: dom.tagLyricist.value.trim(),
    disc: dom.tagDisc.value.trim(),
    mood: dom.tagMood.value.trim(),
    engineer: dom.tagEngineer.value.trim(),
    encodedBy: dom.tagEncodedBy.value.trim(),
    software: dom.tagSoftware.value.trim(),
    artistUrl: dom.tagArtistUrl.value.trim(),
    lyrics: dom.tagLyrics.value,
    lyricsLanguage: (dom.tagLyricsLang.value.trim() || 'eng').toLowerCase().slice(0, 3),
  };
}

function markDirty(isDirty = true) {
  state.dirty = isDirty;
  if (isDirty) state.stripAllPending = false;
  dom.unsavedIndicator.classList.toggle('hidden', !isDirty);
  if (dom.studioDeck.dataset.state !== 'playing') {
    dom.deckStatePill.textContent = isDirty ? 'MODIFIED' : 'READY';
  }
}

function syncKeyPresetSelect() {
  const val = dom.tagKey.value.trim();
  const options = Array.from(dom.keyPresetSelect.options);
  const exact = options.find((o) => o.value === val);
  dom.keyPresetSelect.value = exact ? exact.value : '';
}

function updateIsrcHint() {
  const raw = dom.tagIsrc.value.trim().toUpperCase();
  if (!raw) {
    dom.isrcHint.textContent = 'FORMAT: CC-XXX-YY-NNNNN (12 CHARS)';
    dom.isrcHint.classList.remove('valid');
    return;
  }
  const compact = raw.replace(/-/g, '');
  if (/^[A-Z]{2}[A-Z0-9]{3}\d{2}\d{5}$/.test(compact)) {
    const formatted = `${compact.slice(0, 2)}-${compact.slice(2, 5)}-${compact.slice(5, 7)}-${compact.slice(7)}`;
    dom.isrcHint.textContent = `✓ VALID ISRC (${formatted})`;
    dom.isrcHint.classList.add('valid');
  } else {
    dom.isrcHint.textContent = 'EXPECTED 12 CHARS: CC-XXX-YY-NNNNN (E.G. US-S1Z-26-00001)';
    dom.isrcHint.classList.remove('valid');
  }
}

function updateLyricsStats() {
  const raw = dom.tagLyrics.value;
  const trimmed = raw.trim();
  const lines = trimmed ? trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0).length : 0;
  const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
  dom.lyricsCountBadge.textContent = `${lines} ${lines === 1 ? 'LINE' : 'LINES'} · ${words} ${words === 1 ? 'WORD' : 'WORDS'}`;
  dom.lyricsLiveStats.textContent = `${lines} LINES · ${words} WORDS · ${raw.length} CHARS`;
}

function updateExtendedCounter() {
  const extendedInputs = [
    dom.tagSubtitle, dom.tagLyricist, dom.tagDisc, dom.tagMood,
    dom.tagEngineer, dom.tagEncodedBy, dom.tagArtistUrl, dom.tagSoftware,
  ];
  const count = extendedInputs.filter((el) => el.value.trim().length > 0).length;
  dom.extendedFilledBadge.textContent = `${count} SET`;
}

// ============================================================================
// Cover Art Studio Controller
// ============================================================================

function clearCoverArtState(markEdited = true) {
  state.originalArtSource = null;
  state.currentArt = null;
  if (state.artPreviewUrl) {
    URL.revokeObjectURL(state.artPreviewUrl);
    state.artPreviewUrl = null;
  }
  dom.artPreviewImg.src = '';
  dom.artPreviewImg.classList.add('hidden');
  dom.artEmptyState.classList.remove('hidden');
  dom.artDropzone.classList.remove('has-art');
  dom.artStatusTag.textContent = 'EMPTY';
  dom.artStatusTag.classList.remove('loaded');
  dom.artDimPill.textContent = 'NO IMAGE';
  dom.artFmtPill.textContent = '—';
  dom.artSizePill.textContent = '0 KB';
  dom.btnUploadArt.textContent = 'Upload Cover Art';
  dom.btnExtractArt.disabled = true;
  dom.btnRemoveArt.disabled = true;
  dom.toggleXerox.checked = false;
  dom.toggleXerox.disabled = true;
  dom.btnRevertArt.classList.add('hidden');
  if (markEdited) markDirty(true);
}

function renderCoverArtUI(statusLabel = 'READY') {
  const art = state.currentArt;
  if (!art || !art.data) {
    clearCoverArtState(false);
    return;
  }

  if (state.artPreviewUrl) URL.revokeObjectURL(state.artPreviewUrl);
  const blob = new Blob([art.data], { type: art.mime });
  state.artPreviewUrl = URL.createObjectURL(blob);

  dom.artPreviewImg.src = state.artPreviewUrl;
  dom.artPreviewImg.classList.remove('hidden');
  dom.artEmptyState.classList.add('hidden');
  dom.artDropzone.classList.add('has-art');

  const fmtLabel = art.mime === 'image/png' ? 'PNG' : 'JPEG';
  dom.artDimPill.textContent = art.width && art.height ? `${art.width} × ${art.height} PX` : 'IMAGE';
  dom.artFmtPill.textContent = art.xeroxApplied ? `${fmtLabel} · XEROX` : fmtLabel;
  dom.artSizePill.textContent = formatFileSize(art.data.length);

  dom.artStatusTag.textContent = art.xeroxApplied ? 'XEROX' : statusLabel;
  dom.artStatusTag.classList.add('loaded');

  dom.btnUploadArt.textContent = 'Replace Cover Art';
  dom.btnExtractArt.disabled = false;
  dom.btnRemoveArt.disabled = false;
  dom.toggleXerox.disabled = false;

  // Show Revert button if resized, xeroxed, or format-switched relative to original source
  const src = state.originalArtSource;
  const nativeFmt = src && src.mime === 'image/png' ? 'image/png' : 'image/jpeg';
  const isModifiedFromOriginal =
    dom.toggleXerox.checked ||
    dom.artResolution.value !== 'original' ||
    (src && src.isNativeEmbeddable && dom.artFormat.value !== nativeFmt);
  dom.btnRevertArt.classList.toggle('hidden', !isModifiedFromOriginal);
}

async function reprocessCurrentArt(statusLabel = 'READY') {
  if (!state.originalArtSource) return;
  const seq = ++state.artRenderSeq;
  dom.artStatusTag.textContent = 'RENDERING...';
  try {
    const processed = await processArtwork(state.originalArtSource, {
      resolution: dom.artResolution.value,
      format: dom.artFormat.value,
      xerox: dom.toggleXerox.checked,
      picType: parseInt(dom.artPicType.value, 10) || 3,
      description: state.currentArt?.description || '',
    });
    if (seq !== state.artRenderSeq) return; // stale render
    state.currentArt = processed;
    renderCoverArtUI(statusLabel);
    markDirty(true);
  } catch (err) {
    if (seq !== state.artRenderSeq) return;
    showToast(err.message || 'Artwork processing failed.', 'error');
    renderCoverArtUI('READY');
  }
}

async function handleCoverFileSelected(file) {
  if (!file) return;
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name)) {
    showToast('Please select a valid image file (JPG, PNG, WebP, GIF, or BMP).', 'error');
    return;
  }
  try {
    const source = await createArtworkSource(file);
    state.originalArtSource = source;
    // Match uploaded native format unless user specifically chose PNG/JPEG; for WebP/GIF/BMP default JPEG
    if (source.mime === 'image/png') {
      dom.artFormat.value = 'image/png';
    } else if (source.mime === 'image/jpeg') {
      dom.artFormat.value = 'image/jpeg';
    }
    dom.toggleXerox.disabled = false;
    await reprocessCurrentArt('READY');
    if (source.wasConvertedFormat) {
      const outFmt = dom.artFormat.value === 'image/png' ? 'PNG' : 'JPEG';
      showToast(`Auto-converted ${source.mime.split('/')[1].toUpperCase()} → ${outFmt} for universal player support.`);
    } else {
      showToast(`Cover art staged (${state.currentArt.width}×${state.currentArt.height}).`);
    }
  } catch (err) {
    showToast(err.message || 'Could not load cover artwork.', 'error');
  }
}

function extractCurrentArt() {
  if (!state.currentArt || !state.currentArt.data) return;
  const ext = state.currentArt.mime === 'image/png' ? 'png' : 'jpg';
  const baseName = stripExtension(state.originalFileName || 'cover');
  triggerDownload(
    new Blob([state.currentArt.data], { type: state.currentArt.mime }),
    `${baseName} - Cover.${ext}`
  );
  showToast(`Extracted cover artwork (.${ext})`);
}

// ============================================================================
// Quick Fill Helpers & Export Filename
// ============================================================================

function stripExtension(name) {
  return name.replace(/\.[^.]+$/, '');
}

function getFileExtension(format) {
  if (format === 'MP3') return 'mp3';
  if (format === 'FLAC') return 'flac';
  return 'wav';
}

function sanitizeFilename(str) {
  return str.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim();
}

function updateExportControls() {
  if (!state.doc) return;
  const fmt = state.doc.format;
  const ext = getFileExtension(fmt);
  dom.sealBtnLabel.textContent = `Seal & Download ${fmt} ↓`;

  if (state.filenameMode === 'original') {
    dom.outputFilename.value = state.originalFileName || `master.${ext}`;
  } else if (state.filenameMode === 'artist-title') {
    const artist = sanitizeFilename(dom.tagArtist.value);
    const title = sanitizeFilename(dom.tagTitle.value);
    const stem = artist && title ? `${artist} - ${title}` : title || artist || stripExtension(state.originalFileName);
    dom.outputFilename.value = `${stem}.${ext}`;
  }
  dom.btnNameOriginal.classList.toggle('active', state.filenameMode === 'original');
  dom.btnNameArtistTitle.classList.toggle('active', state.filenameMode === 'artist-title');
}

function autoFillFromFilename() {
  if (!state.originalFileName) return;
  let stem = stripExtension(state.originalFileName).replace(/_/g, ' ').trim();
  // Optional leading track number like "01 - " or "01. "
  const trackMatch = /^(\d{1,2})\s*[-.)]\s*(.+)$/.exec(stem);
  if (trackMatch) {
    if (!dom.tagTrack.value.trim()) dom.tagTrack.value = String(parseInt(trackMatch[1], 10));
    stem = trackMatch[2].trim();
  }
  // Pattern "Artist - Title"
  const parts = stem.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    dom.tagArtist.value = parts[0].trim();
    dom.tagTitle.value = parts.slice(1).join(' - ').trim();
  } else {
    dom.tagTitle.value = stem;
  }
  markDirty(true);
  updateExportControls();
  showToast('Auto-filled track details from filename.');
}

function stampSaintGordonDefaults() {
  const year = String(new Date().getFullYear());
  if (!dom.tagArtist.value.trim()) dom.tagArtist.value = 'Saint Gordon';
  if (!dom.tagAlbumArtist.value.trim()) dom.tagAlbumArtist.value = 'Saint Gordon Collective';
  dom.tagPublisher.value = 'Saint Gordon Collective';
  dom.tagCopyright.value = `℗ & © ${year} Saint Gordon Collective`;
  if (!dom.tagYear.value.trim()) dom.tagYear.value = year;
  if (!dom.tagArtistUrl.value.trim()) dom.tagArtistUrl.value = 'https://saintgordon.vercel.app';
  if (!dom.tagSoftware.value.trim()) dom.tagSoftware.value = 'Saint Gordon Tag & Seal';
  updateExtendedCounter();
  markDirty(true);
  updateExportControls();
  showToast('Stamped Saint Gordon Collective defaults.');
}

function stripAllMetadata() {
  populateFormFromTags(createEmptyTags());
  clearCoverArtState(false);
  state.dirty = true;
  state.stripAllPending = true;
  dom.unsavedIndicator.classList.remove('hidden');
  dom.deckStatePill.textContent = 'STRIP QUEUED';
  dom.sealVerifBanner.classList.add('hidden');
  showToast('All tags & artwork cleared. Click Seal & Download to export a stripped lossless file.');
}

// ============================================================================
// Seal & Download (with Bit-for-Bit Audio Stream Verification)
// ============================================================================

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function sealAndDownload() {
  if (!state.originalBytes || !state.doc) return;

  try {
    const tags = readTagsFromForm();
    const artworks = state.currentArt
      ? [
          {
            ...state.currentArt,
            picType: parseInt(dom.artPicType.value, 10) || 3,
          },
        ]
      : [];

    const hasAnyText = Object.entries(tags).some(
      ([k, v]) => k !== 'lyricsLanguage' && String(v || '').trim().length > 0
    );
    const stripAll = state.stripAllPending && !hasAnyText && artworks.length === 0;

    const result = sealAudioFile(state.originalBytes, tags, artworks, {
      format: state.doc.format,
      fileName: state.originalFileName,
      syncInfoAndId3: dom.toggleWavSync.checked,
      extraRiffInfo: state.doc.extraRiffInfo,
      extraVorbisComments: state.doc.extraVorbisComments,
      vorbisVendor: state.doc.vorbisVendor,
      stripAll,
    });

    // Self-verify bit-for-bit preservation of the audio payload
    const afterAudioSlice = extractAudioPayloadSlice(result.bytes);
    const afterChecksum = checksumBytes(afterAudioSlice);
    const audioMatch =
      afterAudioSlice.length === state.originalAudioLength &&
      afterChecksum === state.originalAudioChecksum;

    if (!audioMatch) {
      throw new Error('Internal verification failed: audio payload checksum mismatch.');
    }

    // Re-parse sealed output to confirm clean container integrity
    const ext = getFileExtension(state.doc.format);
    let outName = sanitizeFilename(dom.outputFilename.value) || `sealed.${ext}`;
    if (!outName.toLowerCase().endsWith(`.${ext}`)) {
      outName = `${outName}.${ext}`;
    }
    parseAudioFile(result.bytes, outName);

    const blob = new Blob([result.bytes], { type: result.mime });
    triggerDownload(blob, outName);

    // Build human-readable verification report
    const parts = ['Audio frames preserved bit-for-bit'];
    if (result.summary.stripped) {
      parts.push('Stripped all metadata chunks & cover art');
    } else {
      const blocksLabel = result.summary.writtenBlocks.length
        ? result.summary.writtenBlocks.join(' + ')
        : 'Container headers updated';
      let wroteStr = `Wrote ${blocksLabel}`;
      if (artworks.length > 0) {
        const a = artworks[0];
        const fmtLbl = a.mime === 'image/png' ? 'PNG' : 'JPEG';
        const ptObj = PICTURE_TYPES.find((p) => p.code === a.picType);
        const ptName = ptObj ? ptObj.label : 'Cover';
        wroteStr += ` + ${a.width}×${a.height} ${fmtLbl} ${ptName} (${formatFileSize(a.data.length)})`;
      }
      parts.push(wroteStr);
    }
    parts.push(`Output: ${formatFileSize(result.bytes.length)}`);

    dom.sealVerifBadge.textContent = `✓ SEALED ${state.doc.format} · BIT-FOR-BIT VERIFIED`;
    dom.sealVerifChecksum.textContent = `AUDIO CHECKSUM: ${afterChecksum} == ${state.originalAudioChecksum}`;
    dom.sealVerifSummary.textContent = parts.join(' · ');
    dom.sealVerifBanner.classList.remove('hidden');

    markDirty(false);
    showToast(`Sealed & downloaded ${outName}`);
  } catch (err) {
    showToast(err.message || 'Sealing failed.', 'error');
  }
}

// ============================================================================
// Synthesized Demo WAV (48 kHz 16-bit Stereo Warm Chord + Cover Art + `bext`)
// ============================================================================

async function generateDemoWav() {
  const sampleRate = 48000;
  const durationSec = 1.8;
  const numSamples = Math.floor(sampleRate * durationSec);
  const channels = 2;
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;

  // Build minimal RIFF WAVE with fmt + custom bext chunk + warm stereo PCM data
  const bextPayload = new Uint8Array(64);
  const bextText = 'SAINT GORDON STUDIO DEMO MASTER BEXT CHUNK';
  for (let i = 0; i < bextText.length; i++) bextPayload[i] = bextText.charCodeAt(i);

  const totalSize = 12 + (8 + 16) + (8 + bextPayload.length) + (8 + dataSize);
  const wav = new Uint8Array(totalSize);
  const view = new DataView(wav.buffer);

  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) wav[off + i] = s.charCodeAt(i);
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeStr(8, 'WAVE');

  // fmt chunk
  let off = 12;
  writeStr(off, 'fmt ');
  view.setUint32(off + 4, 16, true);
  view.setUint16(off + 8, 1, true); // PCM
  view.setUint16(off + 10, channels, true);
  view.setUint32(off + 12, sampleRate, true);
  view.setUint32(off + 16, byteRate, true);
  view.setUint16(off + 20, blockAlign, true);
  view.setUint16(off + 22, bitsPerSample, true);
  off += 24;

  // bext chunk (demonstrates broadcast chunk preservation)
  writeStr(off, 'bext');
  view.setUint32(off + 4, bextPayload.length, true);
  wav.set(bextPayload, off + 8);
  off += 8 + bextPayload.length;

  // data chunk (warm Am9 chord pad)
  writeStr(off, 'data');
  view.setUint32(off + 4, dataSize, true);
  off += 8;

  const freqs = [220.0, 261.63, 329.63, 392.0, 493.88];
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const env = Math.pow(Math.sin(Math.PI * (t / durationSec)), 0.75);
    let l = 0;
    let r = 0;
    for (let k = 0; k < freqs.length; k++) {
      const detune = 1 + (k - 2) * 0.0014;
      l += Math.sin(2 * Math.PI * freqs[k] * t) * 0.16;
      r += Math.sin(2 * Math.PI * freqs[k] * detune * t + 0.4) * 0.16;
    }
    const sL = Math.max(-32767, Math.min(32767, Math.round(l * env * 26000)));
    const sR = Math.max(-32767, Math.min(32767, Math.round(r * env * 26000)));
    view.setInt16(off + i * 4, sL, true);
    view.setInt16(off + i * 4 + 2, sR, true);
  }

  // Render a crisp monochrome Saint Gordon geometric cover PNG via Canvas
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 800;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 800, 800);
  grad.addColorStop(0, '#181818');
  grad.addColorStop(0.5, '#3b3b3b');
  grad.addColorStop(1, '#0e0e0e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 800, 800);

  // Subtle architectural frame + radial rings
  ctx.strokeStyle = '#f2f2f2';
  ctx.lineWidth = 4;
  ctx.strokeRect(48, 48, 704, 704);
  for (let r = 80; r <= 280; r += 40) {
    ctx.strokeStyle = `rgba(242, 242, 242, ${0.95 - r / 360})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(400, 400, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#f2f2f2';
  ctx.font = 'bold 28px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('SAINT GORDON COLLECTIVE', 400, 128);
  ctx.fillText('DEMO MASTER // 48 KHZ', 400, 696);

  const coverBytes = await new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });

  const demoTags = {
    ...createEmptyTags(),
    title: 'Afterglow Study No. 4',
    artist: 'Saint Gordon',
    albumArtist: 'Saint Gordon Collective',
    album: 'Archive Sessions',
    year: '2026-11-24',
    track: '1/1',
    genre: 'Electronic',
    bpm: '118',
    key: 'Am (8A)',
    isrc: 'AU-SGC-26-00004',
    publisher: 'Saint Gordon Collective',
    composer: 'Saint Gordon',
    copyright: '℗ & © 2026 Saint Gordon Collective',
    comment: '48 kHz 16-bit Demo Master — Preserves broadcast bext chunk',
    subtitle: 'Original Studio Master',
    engineer: 'Saint Gordon Studio',
    software: 'Saint Gordon Tag & Seal',
    artistUrl: 'https://saintgordon.vercel.app',
    lyrics: 'Static in the corridor\nPaper grain and silver light\nEvery frame stays sealed',
  };

  const sealed = sealAudioFile(
    wav,
    demoTags,
    [{ data: coverBytes, mime: 'image/png', picType: 3, description: 'Front Cover', width: 800, height: 800 }],
    { format: 'WAV', syncInfoAndId3: true }
  );

  await loadAudioBytes(sealed.bytes, 'Saint Gordon - Afterglow Study No. 4.wav');
}

// ============================================================================
// Event Wiring
// ============================================================================

function bindEvents() {
  // Audio Dropzone & File Picker
  dom.btnSelectAudio.addEventListener('click', (e) => {
    e.stopPropagation();
    dom.audioInput.click();
  });
  dom.btnLoadDemo.addEventListener('click', (e) => {
    e.stopPropagation();
    generateDemoWav();
  });
  dom.dropzoneTarget.addEventListener('click', () => dom.audioInput.click());
  dom.dropzoneTarget.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      dom.audioInput.click();
    }
  });
  dom.btnHeaderSwap.addEventListener('click', () => dom.audioInput.click());

  dom.audioInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleAudioFileSelected(file);
    e.target.value = '';
  });

  // Drag & Drop onto Audio Dropzone
  const audioDrop = dom.dropzoneSection;
  ['dragenter', 'dragover'].forEach((evt) => {
    audioDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      audioDrop.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    audioDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      audioDrop.classList.remove('drag-over');
    });
  });
  audioDrop.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) handleAudioFileSelected(file);
  });

  // Global drag-and-drop fallback (swaps audio if dropped outside art dropzone)
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dom.artDropzone.contains(e.target) || dom.dropzoneSection.contains(e.target)) return;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (/\.(wav|mp3|flac)$/i.test(file.name) || file.type.startsWith('audio/')) {
      handleAudioFileSelected(file);
    } else if (state.doc && (file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name))) {
      handleCoverFileSelected(file);
    }
  });

  // Cover Art Dropzone & Controls
  dom.artDropzone.addEventListener('click', () => dom.coverInput.click());
  dom.artDropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      dom.coverInput.click();
    }
  });
  dom.btnUploadArt.addEventListener('click', () => dom.coverInput.click());
  dom.coverInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleCoverFileSelected(file);
    e.target.value = '';
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    dom.artDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dom.artDropzone.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dom.artDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dom.artDropzone.classList.remove('drag-over');
    });
  });
  dom.artDropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) handleCoverFileSelected(file);
  });

  dom.btnExtractArt.addEventListener('click', extractCurrentArt);
  dom.btnRemoveArt.addEventListener('click', () => {
    clearCoverArtState(true);
    showToast('Cover art removed.');
  });

  dom.artResolution.addEventListener('change', () => reprocessCurrentArt('RESIZED'));
  dom.artFormat.addEventListener('change', () => reprocessCurrentArt('READY'));
  dom.artPicType.addEventListener('change', () => {
    if (state.currentArt) {
      state.currentArt.picType = parseInt(dom.artPicType.value, 10) || 3;
      markDirty(true);
    }
  });
  dom.toggleXerox.addEventListener('change', () => reprocessCurrentArt('READY'));

  dom.btnRevertArt.addEventListener('click', async () => {
    if (!state.originalArtSource) return;
    dom.artResolution.value = 'original';
    dom.toggleXerox.checked = false;
    dom.artFormat.value = state.originalArtSource.mime === 'image/png' ? 'image/png' : 'image/jpeg';
    await reprocessCurrentArt('ORIGINAL');
    showToast('Reverted to original cover artwork.');
  });

  // Musical Key Quick Selector
  dom.keyPresetSelect.addEventListener('change', () => {
    if (dom.keyPresetSelect.value) {
      dom.tagKey.value = dom.keyPresetSelect.value;
      markDirty(true);
    }
  });
  dom.tagKey.addEventListener('input', () => {
    syncKeyPresetSelect();
    markDirty(true);
  });

  // ISRC formatting hint
  dom.tagIsrc.addEventListener('input', () => {
    updateIsrcHint();
    markDirty(true);
  });

  // Lyrics & Extended counters
  dom.tagLyrics.addEventListener('input', () => {
    updateLyricsStats();
    markDirty(true);
  });
  dom.tagLyricsLang.addEventListener('input', () => markDirty(true));

  const extendedEls = [
    dom.tagSubtitle, dom.tagLyricist, dom.tagDisc, dom.tagMood,
    dom.tagEngineer, dom.tagEncodedBy, dom.tagArtistUrl, dom.tagSoftware,
  ];
  for (const el of extendedEls) {
    el.addEventListener('input', () => {
      updateExtendedCounter();
      markDirty(true);
    });
  }

  // Primary inputs dirty tracking + dynamic filename updates
  const primaryEls = [
    dom.tagTitle, dom.tagArtist, dom.tagAlbumArtist, dom.tagAlbum,
    dom.tagYear, dom.tagTrack, dom.tagGenre, dom.tagBpm,
    dom.tagPublisher, dom.tagComposer, dom.tagCopyright, dom.tagComment,
  ];
  for (const el of primaryEls) {
    el.addEventListener('input', () => {
      markDirty(true);
      if (state.filenameMode === 'artist-title') updateExportControls();
    });
  }

  dom.toggleWavSync.addEventListener('change', () => markDirty(true));

  // Quick Action buttons
  dom.btnAutofillFilename.addEventListener('click', autoFillFromFilename);
  dom.btnSgDefaults.addEventListener('click', stampSaintGordonDefaults);
  dom.btnStripAll.addEventListener('click', stripAllMetadata);

  // Output Filename Presets
  dom.btnNameOriginal.addEventListener('click', () => {
    state.filenameMode = 'original';
    updateExportControls();
  });
  dom.btnNameArtistTitle.addEventListener('click', () => {
    state.filenameMode = 'artist-title';
    updateExportControls();
  });
  dom.outputFilename.addEventListener('input', () => {
    state.filenameMode = 'custom';
    dom.btnNameOriginal.classList.remove('active');
    dom.btnNameArtistTitle.classList.remove('active');
  });

  // Seal & Download CTA
  dom.btnSealDownload.addEventListener('click', sealAndDownload);
}

// Boot
initSelectors();
initAudioPreview();
bindEvents();
