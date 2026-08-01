import type { Metadata } from "next"; import "./globals.css";
export const metadata: Metadata = { title:"OAO Translate",description:"OAO real-time AI interpreter" };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
