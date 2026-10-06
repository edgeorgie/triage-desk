import type { Metadata } from "next";
import { JetBrains_Mono, Onest, Syne } from "next/font/google";
import "./globals.css";

const display = Syne({ variable: "--font-display", subsets: ["latin"], weight: ["600", "700", "800"] });
const body = Onest({ variable: "--font-body", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Triage Desk",
  description: "An agent that investigates open GitHub issues and rules on them.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
