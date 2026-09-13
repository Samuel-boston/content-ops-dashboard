"use client";

import { useEffect, useRef } from "react";
import QRCode from "qrcode";

/** A QR code for a URL, drawn locally — nothing about the link ever leaves the browser. */
export function QR({ url, size = 190 }: { url: string; size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvas.current) return;
    void QRCode.toCanvas(canvas.current, url, {
      width: size,
      margin: 1,
      color: { dark: "#0a0a0d", light: "#ffffff" },
    });
  }, [url, size]);

  return <canvas ref={canvas} className="rounded-lg bg-white p-1" />;
}
