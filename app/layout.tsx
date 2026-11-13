import type { Metadata, Viewport } from "next";
import { Inter, Orbitron } from "next/font/google";
import { InlineScript } from "@/components/brand/InlineScript";
import {
  LaunchSplash,
  SPLASH_HEAD_SCRIPT,
} from "@/components/brand/LaunchSplash";
import { RegisterServiceWorker } from "@/components/brand/RegisterServiceWorker";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const orbitron = Orbitron({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-orbitron",
});

export const metadata: Metadata = {
  title: { default: "Questrix", template: "%s · Questrix" },
  description: "Level up your real life.",
  applicationName: "Questrix",
  appleWebApp: {
    capable: true,
    title: "Questrix",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#070A12",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${orbitron.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <InlineScript html={SPLASH_HEAD_SCRIPT} />
      </head>
      <body className="flex min-h-full flex-col">
        <ToastProvider>{children}</ToastProvider>
        <LaunchSplash />
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
