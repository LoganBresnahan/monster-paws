/**
 * Builds the social-account assets into var/social/ from the brand files
 * (ADR-0032): the square logo on the site's cream for LinkedIn, a round-safe
 * avatar for X and Bluesky, the LinkedIn page cover and the 3:1 header the
 * other two share, each a band of Beetle's painting with no wordmark on it,
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

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  await logo("logo-cream", 400, 0.08); // LinkedIn page logo, shown square
  await logo("logo-cream", 1024, 0.08);
  await logo("avatar-cream", 400, 0.14); // X and Bluesky, shown round
  await band("cover-beetle", 88, 1128, 1128, 191); // LinkedIn: her eyes to her muzzle, as painted
  await band("header-beetle", 40, 1216, 1500, 500); // X and Bluesky: ears to shoulders
  console.log(`written to ${path.relative(process.cwd(), OUT)}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
