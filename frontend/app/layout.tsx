import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "PropIQ — Real Estate Intelligence",
  description: "AI-powered property investment advisor",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans min-h-screen bg-[#070A13] text-white antialiased`}>
        {children}
      </body>
    </html>
  );
}
