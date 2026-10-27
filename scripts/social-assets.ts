/**
 * Builds the social-account assets into var/social/ from the brand files
 * (ADR-0032): the square logo on the site's cream for LinkedIn, a round-safe
 * avatar for X and Bluesky, the LinkedIn page cover and the 3:1 header the
 * other two share, the YouTube banner, each a band of Beetle's painting with no wordmark on it,
 * because every platform lays the account's avatar over its cover.
 * var/ is gitignored: this script, not the files, is the record of how they
 * were made. Pixels only, like every crew-derived file (tests/crew-assets.test.ts).
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const CREAM = { r: 0xfa, g: 0xf4, b: 0xe8 }; // --background in src/app/globals.css
const WORDMARK = path.resolve("public/brand/wordmark-v1.png");
const PAINTING = path.resolve("public/brand/crew/beetle-painting.jpg");
const OUT = path.resolve("var/social");

// A square avatar is shown in a circle on X and Bluesky: the wordmark's
// corners (582×326) sit 8 px inside the circle at 8% and 35 px inside at 14%.
async function logo(name: string, size: number, insetShare: number) {
  const inset = Math.round(size * insetShare);
  const mark = await sharp(WORDMARK).resize({ width: size - 2 * inset }).toBuffer({ resolveWithObject: true });
  await sharp({ create: { width: size, height: size, channels: 3, background: CREAM } })
    .composite([{ input: mark.data, left: inset, top: Math.round((size - mark.info.height) / 2) }])
    .png()
    .toFile(path.join(OUT, `${name}-${size}.png`));
}

// A band of the painting cropped around her head: `top` in the painting's
// own pixels, `bandWidth` the width taken (the whole painting for a 3:1
// header), then scaled to the platform's size with its ratio preserved.
async function band(name: string, top: number, bandWidth: number, width: number, height: number) {
  const meta = await sharp(PAINTING).metadata();
  const bandHeight = Math.round((bandWidth * height) / width);
  const left = Math.round((meta.width! - bandWidth) / 2);
  await sharp(PAINTING)
    .extract({ left, top, width: bandWidth, height: bandHeight })
    .resize(width, height)
    .png()
    .toFile(path.join(OUT, `${name}-${width}x${height}.png`));
}

// YouTube shows the middle 29% of the banner on every device and the rest
// only on a TV, so her eyes and nose (painting rows 121 and 190) must sit at
// the banner's vertical centre. Her head is at the top of the painting, so
// the canvas is extended above it with the painting's own top wash,
// stretched and flipped so the seam is continuous, and the painting's whole
// width is kept rather than zooming in on her. Two passes: sharp applies
// extend after extract whatever the call order.
const EYE_NOSE_MID = 155;
const PAPER_ROWS = 48; // rows above her ears (ink starts at 63)
async function youtubeBanner(width: number, height: number) {
  const meta = await sharp(PAINTING).metadata();
  const w = meta.width!;
  const canvasHeight = Math.round((w * height) / width);
  const padTop = Math.round(canvasHeight / 2) - EYE_NOSE_MID;
  const paper = await sharp(PAINTING)
    .extract({ left: 0, top: 0, width: w, height: PAPER_ROWS })
    .resize(w, padTop, { fit: "fill" })
    .flip()
    .toBuffer();
  const painting = await sharp(PAINTING)
    .extract({ left: 0, top: 0, width: w, height: canvasHeight - padTop })
    .toBuffer();
  await sharp({ create: { width: w, height: canvasHeight, channels: 3, background: CREAM } })
    .composite([
      { input: paper, left: 0, top: 0 },
      { input: painting, left: 0, top: padTop },
    ])
    .png()
    .toBuffer()
    .then((buf) => sharp(buf).resize(width, height).png().toFile(path.join(OUT, `banner-beetle-${width}x${height}.png`)));
}

// YouTube's video watermark sits over the bottom-right of every video: the
// wordmark on nothing, and the same on cream for Logan to compare.
async function watermark(size: number) {
  const mark = await sharp(WORDMARK).resize({ width: size - 10 }).toBuffer({ resolveWithObject: true });
  const top = Math.round((size - mark.info.height) / 2);
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark.data, left: 5, top }])
    .png()
    .toFile(path.join(OUT, `watermark-${size}.png`));
  await logo("watermark-cream", size, 0.06);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  await logo("logo-cream", 400, 0.08); // LinkedIn page logo, shown square
  await logo("logo-cream", 1024, 0.08);
  await logo("avatar-cream", 400, 0.14); // X and Bluesky, shown round
  await band("cover-beetle", 88, 1128, 1128, 191); // LinkedIn: her eyes to her muzzle, as painted
  await band("header-beetle", 40, 1216, 1500, 500); // X and Bluesky: ears to shoulders
  await youtubeBanner(1024, 576); // as the channel asked
  await youtubeBanner(2560, 1440); // the size its upload wants
  await watermark(150);
  console.log(`written to ${path.relative(process.cwd(), OUT)}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
