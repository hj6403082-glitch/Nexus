import { inflateSync } from 'node:zlib';

/**
 * A minimal PNG reader, so the visual suite can assert things about actual
 * PIXELS rather than only about application state.
 *
 * This exists because of a specific bug class that no state-based check could
 * ever see: the colour grade was sampling neighbouring texels of the buffer it
 * was writing, and the driver's answer was to erase thin bright features. Every
 * store said the card was open, focused and painted — and it was, right up
 * until the composer ate the type off its face. The only witness is the frame
 * buffer, so the suite had to learn to read one.
 *
 * Handles 8-bit truecolour with and without alpha, which is what Playwright
 * produces. Anything else throws rather than guessing.
 */
export function readPng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');

  let offset = 8;
  let width = 0;
  let height = 0;
  let colourType = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data.readUInt8(8);
      colourType = data.readUInt8(9);
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
      if (colourType !== 2 && colourType !== 6) {
        throw new Error(`unsupported colour type ${colourType}`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const channels = colourType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);

  // Undo the per-scanline filters. Each scanline is prefixed with its filter
  // type and is predicted from the pixel to its left and the scanline above.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prior ? prior[x] : 0;
      const c = prior && x >= channels ? prior[x - channels] : 0;
      let value = line[x];
      switch (filter) {
        case 0: break;
        case 1: value += a; break;
        case 2: value += b; break;
        case 3: value += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`unknown filter ${filter}`);
      }
      out[x] = value & 0xff;
    }
  }

  return { width, height, channels, pixels };
}

/** Counts pixels matching a predicate over the whole image. */
export function countPixels({ width, height, channels, pixels }, predicate) {
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width * channels + x * channels;
      if (predicate(pixels[i], pixels[i + 1], pixels[i + 2])) n++;
    }
  }
  return n;
}

/**
 * Mean of (green − red) across an image, in 0–255.
 *
 * A far steadier signal than counting pixels above a brightness threshold: a
 * thin grid of lines covers few pixels, so a count is dominated by exactly how
 * bright the lines happen to be, and the threshold has to be re-tuned every
 * time the art changes. The mean hue shift of a region does not care.
 */
export function meanGreenOverRed({ width, height, channels, pixels }) {
  let total = 0;
  const count = width * height;
  for (let i = 0; i < count; i++) {
    const o = i * channels;
    total += pixels[o + 1] - pixels[o];
  }
  return total / count;
}
