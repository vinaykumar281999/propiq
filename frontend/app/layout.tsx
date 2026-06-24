import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PropIQ — Real Estate Intelligence",
  description: "AI-powered property investment advisor",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-navy-950 text-white antialiased">
        {children}
      </body>
    </html>
  );
}
