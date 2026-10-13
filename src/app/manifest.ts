import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "IAG Engineering and Utilities",
    // Home-screen labels truncate past ~12 characters.
    short_name: "IAG E&U",
    description: "Inspire Africa Group engineering and utilities: machines, maintenance work, schedules, utilities and downtime",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    categories: ["business", "finance", "productivity"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
