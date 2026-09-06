import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'TOUCHLINE ACADEMY | 高校サッカー部育成ゲーム',description:'練習、育成、編成と試合の采配。世代をつなぎ全国の頂点を目指す、オリジナル高校サッカー部育成ゲーム。無料・登録不要。'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>) { return <html lang="ja" className="dark"><body>{children}</body></html>; }
