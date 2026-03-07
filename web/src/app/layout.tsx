import type { Metadata } from "next";
import { Playfair_Display, Oswald } from "next/font/google";
import "./globals.css";

const playfair = Playfair_Display({ subsets: ["latin"], variable: "--font-playfair", display: "swap" });
const oswald = Oswald({ subsets: ["latin"], variable: "--font-oswald", display: "swap" });

export const metadata: Metadata = {
  title: "TBytes Dashboard",
  description: "Analytics frontend",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${playfair.variable} ${oswald.variable}`}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
