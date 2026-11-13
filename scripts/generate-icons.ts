/**
 * Rasterizes public/brand/icon.svg into the PNG/ICO icons the PWA needs (plan §2.3).
 * Run with `pnpm icons`. Outputs are committed; re-run only when the SVG changes.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "public/brand/icon.svg");
const OUT = path.join(ROOT, "public/icons");
const BG = "#070A12";

async function main() {
  const svg = await readFile(SRC);
  // High-density render so downscaling stays crisp.
  const render = (size: number) =>
    sharp(svg, { density: 384 }).resize(size, size);

  await mkdir(OUT, { recursive: true });

  await render(192).png().toFile(path.join(OUT, "icon-192.png"));
  await render(512).png().toFile(path.join(OUT, "icon-512.png"));

  // iOS ignores transparency (renders black corners) → flatten onto the brand bg.
  await render(180)
    .flatten({ background: BG })
    .png()
    .toFile(path.join(OUT, "apple-touch-icon.png"));

  // Maskable: artwork at 80% on a full-bleed background (Android safe zone).
  const inner = await render(Math.round(512 * 0.8))
    .flatten({ background: BG })
    .png()
    .toBuffer();
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: BG },
  })
    .composite([{ input: inner, gravity: "center" }])
    .png()
    .toBuffer()
    // sharp applies flatten before composite, so flatten in a second pass.
    .then((buf) =>
      sharp(buf)
        .flatten({ background: BG })
        .png()
        .toFile(path.join(OUT, "icon-maskable-512.png")),
    );

  // Favicon: sharp can't write ICO, so convert a 32×32 PNG.
  const fav32 = await render(32).png().toBuffer();
  await writeFile(path.join(ROOT, "app/favicon.ico"), await pngToIco([fav32]));

  console.log("Icons written to public/icons and app/favicon.ico");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
