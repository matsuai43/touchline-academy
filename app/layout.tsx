import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'TOUCHLINE ACADEMY | 高校サッカー部育成ゲーム',description:'練習、育成、編成と試合の采配。世代をつなぎ全国の頂点を目指す、オリジナル高校サッカー部育成ゲーム。無料・登録不要。',manifest:'/manifest.webmanifest',appleWebApp:{capable:true,statusBarStyle:'black-translucent',title:'TOUCHLINE'}};
export const viewport: Viewport = {width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#0c1316'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>) { return <html lang="ja" className="dark"><body>{children}</body></html>; }
