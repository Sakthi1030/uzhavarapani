const realImages = [
  "img1.jpeg","img2.jpeg","img3.jpeg","img4.jpeg","img5.jpeg",
  "img6.jpeg","img7.jpeg","img8.jpeg","img9.jpeg","img10.jpeg"
];

const aiImages = [
  "ai1.jpeg","ai2.jpeg","ai3.jpeg","ai4.jpeg","ai5.jpeg","ai6.jpeg"
];

const realVideos = [
  "real1.mp4","real2.mp4","real3.mp4","real4.mp4","real5.mp4"
];

const aiVideos = [
  "ai-video1.mp4","ai-video2.mp4","ai-video3.mp4","ai-video4.mp4",
  "ai-video5.mp4","ai-video6.mp4","ai-video7.mp4","ai-video8.mp4",
  "ai-video9.mp4","ai-video10.mp4","ai-video11.mp4","ai-video12.mp4"
];

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

loadImages("real-images", realImages, "realImages");
loadImages("ai-images", aiImages, "aiImages");
loadVideos("real-videos", realVideos, "realVideos");
loadVideos("ai-videos", aiVideos, "aiVideos");

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
