/**
 * Builds the link-preview card at src/app/opengraph-image.jpg (ADR-0030):
 * Beetle's painting as it is, uncropped, with the wordmark laid over the
 * backdrop to her left. Her silhouette is read from the ink row by row, so
 * the wordmark takes the widest spot beside her and never touches her
 * (Logan, 2026-10-27). Output is pixels only (tests/crew-assets.test.ts).
 */
import path from "node:path";
import sharp from "sharp";

const PAINTING = path.resolve("public/brand/crew/beetle-painting.jpg");
const WORDMARK = path.resolve("public/brand/wordmark-v1.png");
const OUT = path.resolve("src/app/opengraph-image.jpg");
const INK = 140; // greyscale below this is the dog, never the wash
const GUTTER = 28; // paper kept between the wordmark and the dog, and from the edges

/** The leftmost ink on each row — the dog's silhouette seen from the left. */
async function silhouette(file: string): Promise<{ leftmost: number[]; width: number; height: number }> {
  const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const leftmost: number[] = new Array(height).fill(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] < INK) {
        leftmost[y] = x;
        break;
      }
    }
  }
  return { leftmost, width, height };
}

async function main() {
  const { leftmost, width, height } = await silhouette(PAINTING);
  const mark = await sharp(WORDMARK).metadata();
  const ratio = mark.width! / mark.height!;
  const rows = leftmost.map((x, y) => ({ x, y })).filter((r) => r.x < width);
  const dogMid = (rows[0].y + rows[rows.length - 1].y) / 2;

  // The widest wordmark that fits beside the dog, at the fitting spot nearest her middle.
  let best: { w: number; h: number; top: number } | undefined;
  for (let w = Math.floor(width / 2); w >= 160 && !best; w -= 2) {
    const h = Math.round(w / ratio);
    let nearest: number | undefined;
    for (let top = GUTTER; top + h <= height - GUTTER; top += 2) {
      let fits = true;
      for (let y = top; y < top + h && fits; y++) fits = leftmost[y] > GUTTER + w + GUTTER;
      if (fits && (nearest === undefined || Math.abs(top + h / 2 - dogMid) < Math.abs(nearest + h / 2 - dogMid))) nearest = top;
    }
    if (nearest !== undefined) best = { w, h, top: nearest };
  }
  if (!best) throw new Error("no room for the wordmark beside the subject");

  const wordmark = await sharp(WORDMARK).resize({ width: best.w }).toBuffer();
  await sharp(PAINTING)
    .composite([{ input: wordmark, left: GUTTER, top: best.top }])
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
    .toFile(OUT);
  console.log(`${path.relative(process.cwd(), OUT)}: ${width}×${height}, the painting as it is; wordmark ${best.w}×${best.h} at (${GUTTER}, ${best.top})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
