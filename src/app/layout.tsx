import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { CrashAnalyticsProvider } from "@/components/crash-analytics-provider";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { browserStorageGuardScript } from "@/lib/browser-storage-guard";
import { CONSOLE_LOCK_SCRIPT } from "@/lib/console-lock";
import { HIDE_DEV_CHROME_SCRIPT } from "@/lib/hide-dev-chrome";
import { LOGIN_FIRST_SCRIPT } from "@/lib/login-first-boot";
import { RESIZE_OBSERVER_NOISE_SCRIPT } from "@/lib/resize-observer-noise";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

// Auth ERP: never emit Next's static `s-maxage=31536000` on HTML. That CDN cache
// is the main source of post-deploy ChunkLoadError (stale document → dead chunks).
export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "IAG — Maintenance",
  description: "Inspire Africa Group machinery maintenance: machines, work orders, schedules, and downtime",
  applicationName: "IAG Maintenance",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "IAG Maintenance",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/iag-logo.png", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0f172a" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isProduction = process.env.NODE_ENV === "production";
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full overflow-hidden antialiased`}
    >
      <head>
        {/* Before body paints: cold visits go to /login, not the dashboard shimmer. */}
        <script dangerouslySetInnerHTML={{ __html: LOGIN_FIRST_SCRIPT }} />
        {/* Must run before any app or vendor code can log / write storage. */}
        {isProduction ? (
          <script dangerouslySetInnerHTML={{ __html: CONSOLE_LOCK_SCRIPT }} />
        ) : null}
        <script
          dangerouslySetInnerHTML={{
            __html: browserStorageGuardScript(!isProduction),
          }}
        />
        <script dangerouslySetInnerHTML={{ __html: RESIZE_OBSERVER_NOISE_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: HIDE_DEV_CHROME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex h-full flex-col overflow-hidden font-sans">
        <CrashAnalyticsProvider>
          <Toaster>
            <TooltipProvider>{children}</TooltipProvider>
          </Toaster>
        </CrashAnalyticsProvider>
      </body>
    </html>
  );
}
