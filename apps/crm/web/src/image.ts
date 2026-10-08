const MAX_SIDE = 1600;
const QUALITY = 0.82;

/**
 * Downscales a phone photo to at most 1600px and re-encodes it as JPEG:
 * 10 MB camera shots become ~300 KB, which matters on mobile data at a site.
 */
export const compressImage = async (file: File): Promise<Blob> => {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    return file;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", QUALITY);
  });
  return blob ?? file;
};

export const uploadUrl = (name: string): string => `/uploads/${name}`;
