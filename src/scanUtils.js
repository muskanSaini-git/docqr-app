// Auto-crop document from camera image
// Detects document edges, removes background/extra space, enhances contrast

export async function scanAndCropDocument(imageFile) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(imageFile);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Max dimension to keep performance good on mobile
        const MAX = 1800;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const ratio = Math.min(MAX / width, MAX / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);

        const imageData = ctx.getImageData(0, 0, width, height);
        const crop = detectDocumentBounds(imageData, width, height);

        // Crop canvas to detected bounds with small padding
        const PAD = 10;
        const cx = Math.max(0, crop.x - PAD);
        const cy = Math.max(0, crop.y - PAD);
        const cw = Math.min(width - cx, crop.w + PAD * 2);
        const ch = Math.min(height - cy, crop.h + PAD * 2);

        const cropped = document.createElement('canvas');
        cropped.width = cw;
        cropped.height = ch;
        const cCtx = cropped.getContext('2d');
        cCtx.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);

        // Enhance: increase contrast & brightness for scanned look
        enhanceDocument(cCtx, cw, ch);

        cropped.toBlob(blob => resolve(blob), 'image/jpeg', 0.92);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = reject;
    img.src = url;
  });
}

// Detect bounding box of document (non-background content)
function detectDocumentBounds(imageData, width, height) {
  const data = imageData.data;

  // Convert to grayscale and find edges
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  // Sample background color from corners (average of 20x20 corner pixels)
  const bgSamples = [];
  const S = 20;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      bgSamples.push(gray[y * width + x]);                          // top-left
      bgSamples.push(gray[y * width + (width - 1 - x)]);           // top-right
      bgSamples.push(gray[(height - 1 - y) * width + x]);          // bottom-left
      bgSamples.push(gray[(height - 1 - y) * width + (width - 1 - x)]); // bottom-right
    }
  }
  const bgColor = bgSamples.reduce((a, b) => a + b, 0) / bgSamples.length;
  const THRESHOLD = 35; // pixel must differ from bg by this much to be "content"

  let minX = width, maxX = 0, minY = height, maxY = 0;
  let found = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (Math.abs(gray[y * width + x] - bgColor) > THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }

  if (!found) return { x: 0, y: 0, w: width, h: height };

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Enhance contrast for document-like appearance
function enhanceDocument(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const contrast = 1.25;
  const brightness = 15;
  const factor = (259 * (contrast * 100 + 255)) / (255 * (259 - contrast * 100));

  for (let i = 0; i < data.length; i += 4) {
    data[i]     = clamp(factor * (data[i]     - 128) + 128 + brightness);
    data[i + 1] = clamp(factor * (data[i + 1] - 128) + 128 + brightness);
    data[i + 2] = clamp(factor * (data[i + 2] - 128) + 128 + brightness);
  }
  ctx.putImageData(imageData, 0, 0);
}

function clamp(v) { return Math.min(255, Math.max(0, Math.round(v))); }
