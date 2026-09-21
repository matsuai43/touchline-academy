import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';
export const metadata: Metadata = {title:'TOUCHLINE ACADEMY | 高校サッカー部育成ゲーム',description:'練習、育成、編成と試合の采配。世代をつなぎ全国の頂点を目指す、オリジナル高校サッカー部育成ゲーム。無料・登録不要。',manifest:'/manifest.webmanifest',appleWebApp:{capable:true,statusBarStyle:'black-translucent',title:'TOUCHLINE'}};
export const viewport: Viewport = {width:'device-width',initialScale:1,viewportFit:'cover',themeColor:[{media:'(prefers-color-scheme: light)',color:'#ffffff'},{media:'(prefers-color-scheme: dark)',color:'#0c1316'}]};
// D1: テーマは既定で端末設定（prefers-color-scheme）に追従し、保存・設定ダイアログで
// 「端末に合わせる／ライト／ダーク」を選ぶと localStorage に保存される（app/game-ui.tsx）。
// このインラインスクリプトは描画前（ハイドレーション前）に2つのことをする。
//   1. 明示的にライト/ダークが選ばれている場合だけ <html data-theme> を付ける
//      （globals.css の自前トークンはこれと @media (prefers-color-scheme: dark) だけで
//      切り替わるので、「端末に合わせる」は data-theme を付けずJSを待たず最初の描画から効く）。
//   2. shadcn/ui コンポーネント側の Tailwind `dark:` バリアント
//      （globals.css の `@custom-variant dark (&:is(.dark *));`）は data-theme ではなく
//      .dark クラスを見ているため、実際に適用される色（明示指定 or 端末設定）に合わせて
//      <html> に .dark クラスも付け外しする。端末設定が変わった場合の追従は
//      app/game-ui.tsx 側の matchMedia リスナーが担当する。
const THEME_INIT_SCRIPT = `(function(){try{var v=localStorage.getItem('touchline-academy-theme');var dark=v==='dark'||(v!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',dark);if(v==='light'||v==='dark'){document.documentElement.setAttribute('data-theme',v);}}catch(e){}})();`;
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>) {
  return (
    <html lang="ja">
      <body>
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        {children}
      </body>
    </html>
  );
}
