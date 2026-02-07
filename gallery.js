async function loadManifest() {
  try {
    const response = await fetch("data/media.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Manifest not found");
    return await response.json();
  } catch (err) {
    console.warn("Media manifest load failed:", err);
    return {
      realImages: [],
      aiImages: [],
      realVideos: [],
      aiVideos: []
    };
  }
}

function loadImages(folder, list, targetId) {
  const container = document.getElementById(targetId);
  list.forEach(file => {
    const img = document.createElement("img");
    img.src = `assets/${folder}/${file}`;
    img.loading = "lazy";
    container.appendChild(img);
  });
}

function loadVideos(folder, list, targetId) {
  const container = document.getElementById(targetId);
  list.forEach(file => {
    const video = document.createElement("video");
    video.src = `assets/${folder}/${file}`;
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    container.appendChild(video);
  });
}

loadManifest().then((data) => {
  loadImages("real-images", data.realImages || [], "realImages");
  loadImages("ai-images", data.aiImages || [], "aiImages");
  loadVideos("real-videos", data.realVideos || [], "realVideos");
  loadVideos("ai-videos", data.aiVideos || [], "aiVideos");
});

/* ---------- LIGHTBOX ---------- */

const lightbox = document.createElement("div");
lightbox.id = "lightbox";
lightbox.innerHTML = `
  <span class="close">&times;</span>
  <img id="lightboxImg">
  <button class="nav prev">&#10094;</button>
  <button class="nav next">&#10095;</button>
`;
document.body.appendChild(lightbox);

const lbImg = document.getElementById("lightboxImg");
let currentIndex = 0;
let allImages = [];

setTimeout(() => {
  allImages = document.querySelectorAll(".gallery img");
  allImages.forEach((img, index) => {
    img.onclick = () => {
      currentIndex = index;
      openLightbox();
    };
  });
}, 500);

function openLightbox() {
  lbImg.src = allImages[currentIndex].src;
  lightbox.style.display = "flex";
}

function changeImage(step) {
  currentIndex = (currentIndex + step + allImages.length) % allImages.length;
  lbImg.src = allImages[currentIndex].src;
}

document.querySelector(".close").onclick = () => lightbox.style.display = "none";
document.querySelector(".prev").onclick = () => changeImage(-1);
document.querySelector(".next").onclick = () => changeImage(1);
