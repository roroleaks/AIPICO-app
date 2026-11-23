"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { CANONICAL_URL } from "@/lib/site-config";

interface AppDeployQrCodeProps {
  compact?: boolean;
}

export function AppDeployQrCode({ compact = false }: AppDeployQrCodeProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const deployUrl = typeof window !== "undefined" && window.location.origin.includes("vercel.app")
    ? window.location.origin
    : CANONICAL_URL;

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(deployUrl, {
      margin: 1,
      width: 160,
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

  const handleCopy = () => {
    if (navigator?.clipboard) {
      void navigator.clipboard.writeText(deployUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!qrDataUrl) return null;

  if (compact) {
    return (
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          background: "rgba(255, 255, 255, 0.95)",
          padding: "6px 10px",
          borderRadius: 8,
          border: "1px solid rgba(15, 118, 110, 0.2)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)"
        }}
        title={`Scan or visit ${deployUrl}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrDataUrl}
          alt={`QR Code for ${deployUrl}`}
          width={44}
          height={44}
          style={{ borderRadius: 4, display: "block" }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: "0.74rem", fontWeight: 700, color: "#0f766e", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Deploy URL
          </span>
          <a
            href={deployUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: "0.78rem", color: "#1e293b", textDecoration: "none", fontWeight: 600 }}
          >
            {deployUrl.replace(/^https?:\/\//, "")}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        background: "linear-gradient(135deg, #f0fdfa 0%, #ecfdf5 100%)",
        border: "1px solid #99f6e4",
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 16,
        boxShadow: "0 1px 3px rgba(15, 118, 110, 0.08)",
        flexWrap: "wrap"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrDataUrl}
          alt={`QR Code for ${deployUrl}`}
          width={76}
          height={76}
          style={{
            borderRadius: 6,
            display: "block",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            background: "#ffffff",
            padding: 2
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: "0.88rem", fontWeight: 700, color: "#0f766e" }}>
              📱 Mobile & Deploy QR Code
            </span>
            <span
              style={{
                fontSize: "0.72rem",
                fontWeight: 600,
                background: "#ccfbf1",
                color: "#115e59",
                padding: "2px 6px",
                borderRadius: 4
              }}
            >
              Live App
            </span>
          </div>
          <p style={{ margin: 0, fontSize: "0.82rem", color: "#475569" }}>
            Scan with your smartphone camera to access this deployed version directly.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
            <a
              href={deployUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: "0.82rem",
                color: "#0f766e",
                fontWeight: 600,
                textDecoration: "underline"
              }}
            >
              {deployUrl}
            </a>
            <button
              type="button"
              onClick={handleCopy}
              style={{
                background: "#ffffff",
                border: "1px solid #cbd5e1",
                borderRadius: 4,
                padding: "2px 8px",
                fontSize: "0.75rem",
                cursor: "pointer",
                color: copied ? "#059669" : "#475569",
                fontWeight: 600
              }}
            >
              {copied ? "✓ Copied!" : "📋 Copy URL"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
