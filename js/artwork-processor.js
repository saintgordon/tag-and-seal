/**
 * Tag & Seal — Cover Art Studio Processor (Browser Canvas 2D)
 *
 * Handles:
 *  - Loading JPG, PNG, WebP, GIF, BMP into standard JPEG/PNG embedded artwork
 *  - Auto-conversion of non-standard formats (WebP/GIF/BMP) for universal player compatibility
 *  - Square cover presets (Original, 1400×1400, 3000×3000, 800×800) with centered cover-crop
 *  - 1-Click Saint Gordon Xerox Filter (Rec.709 luminance, threshold 105, midtone grain 60)
 *  - Lossless revert back to original uploaded/embedded source bytes
 */

import { inspectImageBytes } from './metadata-engine.js';

export const XEROX_THRESHOLD = 105;
export const XEROX_GRAIN = 60;

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode cover image. Try a standard JPG, PNG, WebP, GIF, or BMP file.'));
    };
    img.src = url;
  });
}

function canvasToBytes(canvas, mime, quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error('Browser failed to encode cover artwork canvas.'));
          return;
        }
        try {
          const buf = await blob.arrayBuffer();
          resolve(new Uint8Array(buf));
        } catch (err) {
          reject(err);
        }
      },
      mime,
      mime === 'image/jpeg' ? quality : undefined
    );
  });
}

/**
 * Apply the Saint Gordon Xerox monochrome photocopy filter in-place to ImageData.
 * Exact Rec.709 luminance with midtone-gated 1-bit toner grain (threshold 105, grain 60).
 */
export function applySaintGordonXerox(imageData, threshold = XEROX_THRESHOLD, grain = XEROX_GRAIN) {
  const data = imageData.data;
  let state = 0x5a17602d; // deterministic xorshift32 seed
  for (let i = 0; i < data.length; i += 4) {
    let luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    if (luma > 50 && luma < 240) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      const rand = (state >>> 0) / 4294967296;
      luma -= rand * grain;
    }
    const v = luma >= threshold ? 255 : 0;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  return imageData;
}

/**
 * Decode raw image file/bytes into a reusable source record so resolution, format,
 * and Xerox toggles always render cleanly from the original without generational loss.
 */
export async function createArtworkSource(fileOrBytes, fallbackMime = '') {
  let rawBytes;
  let hintMime = fallbackMime;
  if (fileOrBytes instanceof Blob) {
    rawBytes = new Uint8Array(await fileOrBytes.arrayBuffer());
    hintMime = fileOrBytes.type || fallbackMime;
  } else {
    rawBytes = fileOrBytes instanceof Uint8Array ? fileOrBytes : new Uint8Array(fileOrBytes);
  }

  const headerInfo = inspectImageBytes(rawBytes, hintMime || 'image/jpeg');
  const blob = new Blob([rawBytes], { type: headerInfo.mime });
  const img = await loadImageFromBlob(blob);

  const width = img.naturalWidth || headerInfo.width;
  const height = img.naturalHeight || headerInfo.height;
  const isNativeEmbeddable = headerInfo.mime === 'image/jpeg' || headerInfo.mime === 'image/png';

  return {
    rawBytes,
    mime: headerInfo.mime,
    width,
    height,
    isNativeEmbeddable,
    wasConvertedFormat: !isNativeEmbeddable,
  };
}

/**
 * Process an artwork source according to user studio options:
 *  - resolution: 'original' | '1400' | '3000' | '800'
 *  - format: 'image/jpeg' | 'image/png'
 *  - xerox: boolean
 *  - picType: number (ID3 APIC / FLAC PICTURE type code, default 3 Front Cover)
 *  - description: string
 */
export async function processArtwork(source, options = {}) {
  if (!source || !source.rawBytes) return null;

  const resolution = options.resolution || 'original';
  const targetFormat = options.format === 'image/png' ? 'image/png' : 'image/jpeg';
  const xerox = Boolean(options.xerox);
  const picType = Number.isInteger(options.picType) ? options.picType : 3;
  const description = options.description || '';

  // Zero-recompression fast path: keep original untouched bytes if format matches & no transforms requested
  if (
    resolution === 'original' &&
    !xerox &&
    source.isNativeEmbeddable &&
    source.mime === targetFormat
  ) {
    return {
      data: source.rawBytes,
      mime: source.mime,
      width: source.width,
      height: source.height,
      picType,
      description,
      xeroxApplied: false,
      converted: false,
    };
  }

  const blob = new Blob([source.rawBytes], { type: source.mime });
  const img = await loadImageFromBlob(blob);
  const srcW = img.naturalWidth || source.width;
  const srcH = img.naturalHeight || source.height;

  let outW = srcW;
  let outH = srcH;
  let sx = 0;
  let sy = 0;
  let sw = srcW;
  let sh = srcH;

  if (resolution !== 'original') {
    const targetPx = parseInt(resolution, 10);
    if (Number.isFinite(targetPx) && targetPx > 0) {
      outW = targetPx;
      outH = targetPx;
      // Centered square cover-crop
      const side = Math.min(srcW, srcH);
      sx = Math.floor((srcW - side) / 2);
      sy = Math.floor((srcH - side) / 2);
      sw = side;
      sh = side;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { willReadFrequently: xerox });
  if (!ctx) {
    throw new Error('Could not initialize Canvas 2D context for artwork processing.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Ensure clean white matte behind transparent PNGs/GIFs when exporting JPEG or Xerox
  if (targetFormat === 'image/jpeg' || xerox) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
  }

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

  if (xerox) {
    const imageData = ctx.getImageData(0, 0, outW, outH);
    applySaintGordonXerox(imageData, XEROX_THRESHOLD, XEROX_GRAIN);
    ctx.putImageData(imageData, 0, 0);
  }

  const encodedBytes = await canvasToBytes(canvas, targetFormat, 0.92);
  const info = inspectImageBytes(encodedBytes, targetFormat);

  return {
    data: encodedBytes,
    mime: info.mime,
    width: info.width || outW,
    height: info.height || outH,
    picType,
    description,
    xeroxApplied: xerox,
    converted: source.wasConvertedFormat || source.mime !== targetFormat || resolution !== 'original',
  };
}
