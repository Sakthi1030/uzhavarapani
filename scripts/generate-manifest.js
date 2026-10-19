const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const assetsDir = path.join(rootDir, "assets");
const outputDir = path.join(rootDir, "data");
const outputFile = path.join(outputDir, "media.json");

// Any file format is accepted; the gallery decides how to show it from the extension.
const folders = {
  realImages: { dir: "real-images" },
  aiImages: { dir: "ai-images" },
  realVideos: { dir: "real-videos" },
  aiVideos: { dir: "ai-videos" }
};

const IGNORED_EXTS = [".md", ".json", ".yml", ".yaml", ".txt", ".db", ".ini"];

function listFiles(folderPath) {
  if (!fs.existsSync(folderPath)) return [];
  return fs
    .readdirSync(folderPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("."))
    .filter((name) => !IGNORED_EXTS.includes(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "en"));
}

// The CMS stores uploads as "/assets/<dir>/<name>"; reduce those to "<name>" so they
// are not listed twice (once from the folder scan, once from the CMS entry).
function normalizeEntry(item, dir) {
  if (typeof item !== "string") return item;
  const prefix = `/assets/${dir}/`;
  if (item.startsWith(prefix) && !item.slice(prefix.length).includes("/")) {
    return item.slice(prefix.length);
  }
  return item;
}

function readExistingManifest() {
  if (!fs.existsSync(outputFile)) return {};
  try {
    const raw = fs.readFileSync(outputFile, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn("Failed to read existing manifest:", err.message);
    return {};
  }
}

function isLocalFilename(value) {
  if (typeof value !== "string") return false;
  if (/^(https?:)?\/\//.test(value)) return false;
  if (value.startsWith("/")) return false;
  if (value.includes("/")) return false;
  return true;
}

// Keeps the order set in the CMS, drops entries whose local file is gone,
// then appends any files found in the folder that the CMS list doesn't have yet.
function mergeEntries(localFiles, existingList, dir) {
  const result = [];
  const seen = new Set();
  const local = new Set(localFiles);

  const add = (item) => {
    if (!item || seen.has(item)) return;
    seen.add(item);
    result.push(item);
  };

  if (Array.isArray(existingList)) {
    existingList.forEach((raw) => {
      const item = normalizeEntry(raw, dir);
      if (isLocalFilename(item) && !local.has(item)) return;
      add(item);
    });
  }

  localFiles.forEach(add);
  return result;
}

const existingManifest = readExistingManifest();
const manifest = {};

for (const [key, value] of Object.entries(folders)) {
  const folderPath = path.join(assetsDir, value.dir);
  const localFiles = listFiles(folderPath);
  const existingList = existingManifest[key] || [];
  manifest[key] = mergeEntries(localFiles, existingList, value.dir);
}

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(outputFile, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`Wrote ${path.relative(rootDir, outputFile)}`);
