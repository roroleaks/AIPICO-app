import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { CANONICAL_URL } from "@/lib/site-config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0f766e",
};

export const metadata: Metadata = {
  title: "AI PICO v3.1 — Clinical Question Assistant · Obs/Gyn",
  description:
    "AI-assisted formulation of answerable clinical questions and evidence synthesis in Obstetrics and Gynecology (Obs/Gyn)",
  metadataBase: new URL(CANONICAL_URL),
  alternates: {
    canonical: "/",
  },
  applicationName: "AI PICO",
  appleWebApp: {
    capable: true,
    title: "AI PICO",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: ["/favicon.ico"],
  },
  manifest: "/manifest.json",
  openGraph: {
    title: "AI PICO v3.1 — Clinical Question Assistant · Obs/Gyn",
    description:
      "AI-assisted formulation of answerable clinical questions and evidence synthesis in Obstetrics and Gynecology (Obs/Gyn)",
    url: CANONICAL_URL,
    siteName: "AI PICO",
    images: [
      {
        url: "/og-image.png",
        width: 1024,
        height: 1008,
        alt: "AI PICO Clinical Assistant Icon",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI PICO v3.1 — Clinical Question Assistant",
    description:
      "AI-assisted formulation of answerable clinical questions in Obs/Gyn",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
