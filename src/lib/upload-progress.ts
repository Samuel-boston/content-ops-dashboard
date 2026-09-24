"use client";

/**
 * Sends a file with a real progress callback — fetch() can't report upload
 * progress, XMLHttpRequest can. Resolves on any 2xx; rejects with a message a
 * person can act on (too big, network dropped, …).
 */
export function sendWithProgress(
  url: string,
  body: XMLHttpRequestBodyInit,
  opts: {
    method?: "PUT" | "POST";
    headers?: Record<string, string>;
    onProgress?: (pct: number) => void;
  } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(opts.method ?? "PUT", url);
    for (const [k, v] of Object.entries(opts.headers ?? {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status < 300) return resolve();
      if (xhr.status === 413) return reject(new Error("That file is over the upload size limit."));
      reject(new Error(`The upload was refused (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("The connection dropped before the upload finished. Try again."));
    xhr.onabort = () => reject(new Error("The upload was cancelled."));
    xhr.send(body);
  });
}
