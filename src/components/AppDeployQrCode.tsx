"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { CANONICAL_URL } from "@/lib/site-config";

interface AppDeployQrCodeProps {
  size?: number;
}

export function AppDeployQrCode({ size = 56 }: AppDeployQrCodeProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  const deployUrl = typeof window !== "undefined" && window.location.origin.includes("vercel.app")
    ? window.location.origin
    : CANONICAL_URL;

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(deployUrl, {
      margin: 1,
      width: 140,
      color: {
        dark: "#0f766e",
        light: "#ffffff"
      }
    }).then(url => {
      if (active) setQrDataUrl(url);
    }).catch(err => {
      console.warn("QR code generation failed:", err);
    });

    return () => {
      active = false;
    };
  }, [deployUrl]);

  if (!qrDataUrl) return null;

  return (
    <a
      href={deployUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`Scan to open ${deployUrl} on mobile`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#ffffff",
        padding: 3,
        borderRadius: 8,
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)",
        border: "1px solid rgba(255, 255, 255, 0.4)",
        lineHeight: 0,
        textDecoration: "none",
        flexShrink: 0,
        cursor: "pointer"
      }}
      aria-label="Scan QR code to open AIPICO on mobile"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qrDataUrl}
        alt={`QR code for ${deployUrl}`}
        width={size}
        height={size}
        style={{
          borderRadius: 5,
          display: "block"
        }}
      />
    </a>
  );
}
