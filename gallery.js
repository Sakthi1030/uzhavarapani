/* ---------- FILE TYPES ---------- */
// Anything uploaded from the admin is shown here; the type is decided by the file extension,
// so a video added under "Real Images" (or any other mix-up) still renders correctly.

const IMAGE_EXTS = ["jpg", "jpeg", "jfif", "png", "webp", "gif", "avif", "svg", "bmp"];
const VIDEO_EXTS = ["mp4", "webm", "ogv", "mov", "m4v"];
const AUDIO_EXTS = ["mp3", "m4a", "wav", "aac", "ogg", "oga", "opus", "flac"];

const PAGE_SIZE = 8;

function fileExt(file) {
  const clean = String(file).split(/[?#]/)[0];
  const name = clean.substring(clean.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.substring(dot + 1).toLowerCase() : "";
}

function fileName(file) {
  const clean = String(file).split(/[?#]/)[0].replace(/\/$/, "");
  try {
    return decodeURIComponent(clean.substring(clean.lastIndexOf("/") + 1));
  } catch (e) {
    return clean.substring(clean.lastIndexOf("/") + 1);
  }
}

function mediaKind(file, fallback) {
  const ext = fileExt(file);
  if (IMAGE_EXTS.includes(ext)) return "image";
  if (VIDEO_EXTS.includes(ext)) return "video";
  if (AUDIO_EXTS.includes(ext)) return "audio";
  if (!ext) return fallback; // e.g. CDN links without an extension
  return "file";
}

function resolveAssetPath(folder, file) {
  if (!file) return "";
  if (/^(https?:)?\/\//.test(file)) return file;
  if (file.startsWith("/")) return encodeURI(file);
  if (file.includes("/")) return encodeURI(`/${file}`);
  return encodeURI(`assets/${folder}/${file}`);
}

/* ---------- MANIFEST ---------- */

async function loadManifest() {
  try {
    const response = await fetch("data/media.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Manifest not found");
    return await response.json();
  } catch (err) {
    console.warn("Media manifest load failed:", err);
    return { realImages: [], aiImages: [], realVideos: [], aiVideos: [] };
  }
}

/* ---------- GALLERY ---------- */

const lightboxItems = []; // { kind, src } for every image / video on the page

function buildTile(src, kind) {
  if (kind === "image") {
    const btn = document.createElement("button");
    btn.className = "g-item";
    btn.type = "button";
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.onerror = () => btn.classList.add("broken");
    btn.appendChild(img);
    return { el: btn, viewable: true };
  }

  if (kind === "video") {
    const btn = document.createElement("button");
    btn.className = "g-item is-video";
    btn.type = "button";
    const video = document.createElement("video");
    video.src = src + "#t=0.1"; // shows the first frame as a thumbnail
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.setAttribute("aria-hidden", "true");
    video.tabIndex = -1;
    const play = document.createElement("span");
    play.className = "g-play";
    btn.append(video, play);
    return { el: btn, viewable: true };
  }

  // audio + any other format (pdf, heic, docx...) → card with download / play
  const card = document.createElement(kind === "audio" ? "div" : "a");
  card.className = "g-item g-file";
  if (kind !== "audio") {
    card.href = src;
    card.target = "_blank";
    card.rel = "noopener";
  }
  const ext = document.createElement("span");
  ext.className = "g-ext";
  ext.textContent = (fileExt(src) || "file").toUpperCase();
  const name = document.createElement("span");
  name.className = "g-name";
  name.textContent = fileName(src);
  card.append(ext, name);
  if (kind === "audio") {
    const audio = document.createElement("audio");
    audio.src = src;
    audio.controls = true;
    audio.preload = "none";
    card.appendChild(audio);
  }
  return { el: card, viewable: false };
}

function renderGallery(targetId, folder, list, fallbackKind) {
  const container = document.getElementById(targetId);
  if (!container) return;

  const files = (list || []).filter(Boolean);
  if (!files.length) {
    container.closest("section").hidden = true;
    return;
  }

  const tiles = files.map((file) => {
    const src = resolveAssetPath(folder, file);
    const kind = mediaKind(file, fallbackKind);
    const tile = buildTile(src, kind);
    if (tile.viewable) {
      const index = lightboxItems.push({ kind, src }) - 1;
      tile.el.addEventListener("click", () => openLightbox(index));
    }
    return tile.el;
  });

  tiles.forEach((el, i) => {
    if (i >= PAGE_SIZE) el.hidden = true;
    container.appendChild(el);
  });

  if (tiles.length > PAGE_SIZE) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "g-more";
    more.textContent = `மேலும் காண்க (${tiles.length - PAGE_SIZE})`;
    more.onclick = () => {
      tiles.forEach((el) => (el.hidden = false));
      more.remove();
    };
    container.after(more);
  }
}

loadManifest().then((data) => {
  renderGallery("realImages", "real-images", data.realImages, "image");
  renderGallery("realVideos", "real-videos", data.realVideos, "video");
  renderGallery("aiImages", "ai-images", data.aiImages, "image");
  renderGallery("aiVideos", "ai-videos", data.aiVideos, "video");
});

/* ---------- LIGHTBOX ---------- */

const lightbox = document.createElement("div");
lightbox.id = "lightbox";
lightbox.setAttribute("role", "dialog");
lightbox.setAttribute("aria-modal", "true");
lightbox.innerHTML = `
  <div class="lb-stage"></div>
  <button class="lb-btn lb-close" type="button" aria-label="மூடு">&times;</button>
  <button class="lb-btn lb-prev" type="button" aria-label="முந்தைய">&#10094;</button>
  <button class="lb-btn lb-next" type="button" aria-label="அடுத்து">&#10095;</button>
  <div class="lb-count"></div>
`;
document.body.appendChild(lightbox);

const lbStage = lightbox.querySelector(".lb-stage");
const lbCount = lightbox.querySelector(".lb-count");
let currentIndex = 0;

function showItem() {
  const item = lightboxItems[currentIndex];
  lbStage.innerHTML = "";
  if (item.kind === "video") {
    const video = document.createElement("video");
    video.src = item.src;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    lbStage.appendChild(video);
  } else {
    const img = document.createElement("img");
    img.src = item.src;
    img.alt = "";
    lbStage.appendChild(img);
  }
  lbCount.textContent = `${currentIndex + 1} / ${lightboxItems.length}`;
}

function openLightbox(index) {
  currentIndex = index;
  showItem();
  lightbox.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  lightbox.classList.remove("open");
  lbStage.innerHTML = ""; // stops any playing video
  document.body.style.overflow = "";
}

function changeItem(step) {
  currentIndex = (currentIndex + step + lightboxItems.length) % lightboxItems.length;
  showItem();
}

lightbox.querySelector(".lb-close").onclick = closeLightbox;
lightbox.querySelector(".lb-prev").onclick = () => changeItem(-1);
lightbox.querySelector(".lb-next").onclick = () => changeItem(1);
lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox || e.target === lbStage) closeLightbox();
});

document.addEventListener("keydown", (e) => {
  if (!lightbox.classList.contains("open")) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") changeItem(-1);
  if (e.key === "ArrowRight") changeItem(1);
});

let touchX = null;
lightbox.addEventListener("touchstart", (e) => (touchX = e.touches[0].clientX), { passive: true });
lightbox.addEventListener("touchend", (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50) changeItem(dx < 0 ? 1 : -1);
  touchX = null;
});

/* ---------- NAV ---------- */

const topbar = document.getElementById("topbar");
const menuBtn = document.getElementById("menuBtn");
const navLinks = document.getElementById("navLinks");

function onScroll() {
  topbar.classList.toggle("scrolled", window.scrollY > 40);
}
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

menuBtn.addEventListener("click", () => {
  const open = navLinks.classList.toggle("open");
  menuBtn.setAttribute("aria-expanded", String(open));
  if (open) topbar.classList.add("scrolled");
  else onScroll();
});

navLinks.addEventListener("click", (e) => {
  if (e.target.closest("a")) {
    navLinks.classList.remove("open");
    menuBtn.setAttribute("aria-expanded", "false");
    onScroll();
  }
});

/* ---------- REVEAL ON SCROLL ---------- */

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("in");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll(".section .wrap, .cta-inner").forEach((el) => {
    el.classList.add("reveal");
    observer.observe(el);
  });
}

document.getElementById("year").textContent = new Date().getFullYear();
