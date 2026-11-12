import { DomainError } from "./errors";

export const MAX_TASK_IMAGE_BYTES = 5 * 1024 * 1024;
export const TASK_IMAGE_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

type ImageTransform = {
  output(options: { format: "image/webp"; quality: number; anim: false }): Promise<{ response(): Response }>;
};

type ImageOptions = { width: number; height: number; fit: "scale-down" | "cover" };
export type ImageBinding = {
  input(stream: ReadableStream<Uint8Array>): {
    transform(options: ImageOptions): ImageTransform;
  };
};

type TaskImageStorage = {
  IMAGES: ImageBinding;
  TASK_IMAGES: {
    put(key: string, body: ArrayBuffer, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
  };
};

export function taskImagePath(orgSlug: string, projectSlug: string, id: string) {
  return `/${orgSlug}/${projectSlug}/images/${id}`;
}

export function taskImageKey(projectId: string, id: string) {
  return `projects/${projectId}/${id}.webp`;
}

export async function readTaskImageBytes(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_TASK_IMAGE_BYTES) {
        await reader.cancel();
        throw new DomainError("Images must be 5 MB or smaller.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function isWebP(bytes: Uint8Array) {
  return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
}

function isRasterImage(bytes: Uint8Array) {
  return (bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG")
    || (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    || isWebP(bytes)
    || ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))
    || (ascii(bytes, 4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(bytes, 8, 12)));
}

export async function convertImageToWebP(
  images: ImageBinding,
  bytes: Uint8Array<ArrayBuffer>,
  options: ImageOptions,
  quality: number,
) {
  if (bytes.byteLength > MAX_TASK_IMAGE_BYTES) {
    throw new DomainError("Images must be 5 MB or smaller.");
  }
  if (!isRasterImage(bytes)) {
    throw new DomainError("Choose a PNG, JPEG, WebP, GIF, or AVIF image.");
  }

  try {
    const result = await images.input(new Blob([bytes]).stream())
      .transform(options)
      .output({ format: "image/webp", quality, anim: false });
    const response = result.response();
    if (!response.ok || !response.body || response.headers.get("Content-Type") !== "image/webp") {
      throw new Error("Missing WebP output");
    }
    const webp = await readTaskImageBytes(response.body);
    if (!isWebP(webp)) throw new Error("Invalid WebP output");
    return webp;
  } catch {
    throw new DomainError("Couldn’t convert the image to WebP. Try a different image.");
  }
}

export async function storeTaskImage(
  env: TaskImageStorage,
  projectId: string,
  bytes: Uint8Array<ArrayBuffer>,
) {
  const webp = await convertImageToWebP(env.IMAGES, bytes, { width: 1920, height: 1920, fit: "scale-down" }, 82);
  const id = crypto.randomUUID();
  await env.TASK_IMAGES.put(taskImageKey(projectId, id), webp.buffer, {
    httpMetadata: { contentType: "image/webp" },
  });
  return id;
}
