import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Anboud 智能锁管理平台',
  description: 'LoRa-BLE Smart Lock Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
