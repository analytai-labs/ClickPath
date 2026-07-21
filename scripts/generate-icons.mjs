import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

const rawImagePath = path.join(rootDir, "public/images/raw-logo.png");

async function generateIcons() {
  if (!fs.existsSync(rawImagePath)) {
    console.error(`Source image not found at ${rawImagePath}`);
    process.exit(1);
  }

  const image = sharp(rawImagePath);

  // 1. App Icon (icon.png - 32x32)
  await image
    .resize(32, 32)
    .toFile(path.join(rootDir, "src/app/icon.png"));
  console.log("✅ Generated src/app/icon.png (32x32)");

  // 2. Apple Touch Icon (apple-icon.png - 180x180)
  await image
    .resize(180, 180)
    .toFile(path.join(rootDir, "src/app/apple-icon.png"));
  console.log("✅ Generated src/app/apple-icon.png (180x180)");

  // 3. PWA Icon (192x192)
  await image
    .resize(192, 192)
    .toFile(path.join(rootDir, "public/android-chrome-192x192.png"));
  console.log("✅ Generated public/android-chrome-192x192.png");

  // 4. PWA Icon (512x512)
  await image
    .resize(512, 512)
    .toFile(path.join(rootDir, "public/android-chrome-512x512.png"));
  console.log("✅ Generated public/android-chrome-512x512.png");

  // 5. Replace logo-text-white.png
  await image
    .resize(800, null, { withoutEnlargement: true })
    .toFile(path.join(rootDir, "public/images/logo-text-white.png"));
  console.log("✅ Replaced public/images/logo-text-white.png");
}

generateIcons().catch(console.error);
