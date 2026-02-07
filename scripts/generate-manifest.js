const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const assetsDir = path.join(rootDir, "assets");
const outputDir = path.join(rootDir, "data");
const outputFile = path.join(outputDir, "media.json");

const folders = {
  realImages: { dir: "real-images", exts: [".jpg", ".jpeg", ".png", ".webp"] },
  aiImages: { dir: "ai-images", exts: [".jpg", ".jpeg", ".png", ".webp"] },
  realVideos: { dir: "real-videos", exts: [".mp4", ".webm", ".ogg"] },
  aiVideos: { dir: "ai-videos", exts: [".mp4", ".webm", ".ogg"] }
};

function listFiles(folderPath, exts) {
  if (!fs.existsSync(folderPath)) return [];
  return fs
    .readdirSync(folderPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => exts.includes(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "en"));
}

const manifest = {};

for (const [key, value] of Object.entries(folders)) {
  const folderPath = path.join(assetsDir, value.dir);
  manifest[key] = listFiles(folderPath, value.exts);
}

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(outputFile, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`Wrote ${path.relative(rootDir, outputFile)}`);
