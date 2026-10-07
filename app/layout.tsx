import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Fruit Decisions Lab', description: 'Inspect, classify, and compare fruit images with OpenAI Decisions.' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
