import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'AI Frontier Intelligence · Know Before You Build',
  description: '技术情报、证据与时间，帮助你判断下一步该构建、购买还是集成。',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
