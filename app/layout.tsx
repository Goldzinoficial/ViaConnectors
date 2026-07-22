import type { Metadata } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import { Providers } from "@/components/Providers";
import { BackToTop } from "@/components/BackToTop";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["italic", "normal"],
  variable: "--font-instrument-serif",
});

export const metadata: Metadata = {
  title: "ViaConnectors",
  description: "Discover, install and manage connectors for your AI, zero effort.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" className={`${inter.variable} ${instrumentSerif.variable}`}>
      <body>
        <Providers>{children}</Providers>
        <BackToTop />
      </body>
    </html>
  );
}
