import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Teino AI Gateway",
  description: "多供应商 AI 网关：标签路由、优先级与流量配比",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${geist.variable} ${geistMono.variable}`}>
      <body>
        <div className="aurora" aria-hidden>
          <span />
          <i />
        </div>
        {children}
      </body>
    </html>
  );
}
