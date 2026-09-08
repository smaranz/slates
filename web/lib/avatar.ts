/** Center-crop to a square and encode small enough to keep in localStorage. */
export async function readAvatarFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose a photo (JPEG, PNG, or WebP).");
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error("That photo is too large. Try one under 12 MB.");
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error("Couldn’t read that photo.");

    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn’t read that photo.");

    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

    const jpeg = canvas.toDataURL("image/jpeg", 0.86);
    if (jpeg.length > 400_000) {
      return canvas.toDataURL("image/jpeg", 0.7);
    }
    return jpeg;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn’t read that photo."));
    img.src = src;
  });
}
