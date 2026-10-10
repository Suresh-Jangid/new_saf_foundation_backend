import fs from "fs";
import path from "path";

const uploadsDir = path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

/**
 * Normalizes an image payload (base64 data URL or relative URL) into a stored disk URL.
 * If base64 data URL (`data:image/jpeg;base64,...`) is provided, it decodes the image,
 * saves it into `uploads/` directory, and returns the short relative path `/uploads/filename.ext`
 * that safely fits within PostgreSQL varchar limits.
 */
export function saveImagePayload(val?: string | null): string | null {
  if (!val || typeof val !== "string") return null;

  const trimmed = val.trim();
  if (!trimmed) return null;

  // If already a relative URL or absolute URL, return as is
  if (trimmed.startsWith("/uploads/") || trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  // Helper to optimize image with sharp in background
  const optimizeOnDisk = (buf: Buffer, targetPath: string) => {
    try {
      const sharp = require("sharp");
      const tempOptPath = targetPath + ".opt.jpg";
      sharp(buf)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toFile(tempOptPath)
        .then(() => {
          try {
            if (fs.existsSync(tempOptPath)) {
              fs.renameSync(tempOptPath, targetPath);
            }
          } catch {}
        })
        .catch(() => {});
    } catch {}
  };

  // Handle base64 Data URL (data:image/jpeg;base64,....)
  if (trimmed.startsWith("data:image/")) {
    try {
      const parts = trimmed.split(";base64,");
      if (parts.length === 2) {
        const mime = parts[0].replace("data:image/", "");
        const ext = mime === "jpeg" ? "jpg" : mime === "svg+xml" ? "svg" : mime;
        const buffer = Buffer.from(parts[1], "base64");
        
        const filename = `photo-${Date.now()}-${Math.floor(Math.random() * 1e9)}.${ext}`;
        const filePath = path.join(uploadsDir, filename);
        fs.writeFileSync(filePath, buffer);

        // Automatically optimize image in background
        if (ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "webp") {
          optimizeOnDisk(buffer, filePath);
        }

        return `/uploads/${filename}`;
      }
    } catch (err) {
      console.error("Failed to save base64 image:", err);
      return null;
    }
  }

  // Handle raw base64 string without data prefix if long enough
  if (trimmed.length > 500 && !trimmed.includes("/") && !trimmed.includes(" ")) {
    try {
      const buffer = Buffer.from(trimmed, "base64");
      const filename = `photo-${Date.now()}-${Math.floor(Math.random() * 1e9)}.jpg`;
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, buffer);

      // Automatically optimize image in background
      optimizeOnDisk(buffer, filePath);

      return `/uploads/${filename}`;
    } catch (err) {
      console.error("Failed to save raw base64 image:", err);
      return null;
    }
  }

  return trimmed.length <= 512 ? trimmed : null;
}
