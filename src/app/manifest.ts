import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ClickPath - Open-Source URL Shortener with Analytics",
    short_name: "ClickPath",
    description:
      "Shorten URLs, track clicks, and generate QR codes. Branded URL shortener with powerful analytics.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      {
        src: "/icon.png",
        sizes: "any",
        type: "image/png",
      },
    ],
  };
}
