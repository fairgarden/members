import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import localFont from 'next/font/local'
import { ClientProvider } from '@fairgarden/design/utils/ClientProvider'

const materialSymbols = localFont({
  src: '../../node_modules/@material-symbols/font-600/material-symbols-rounded.woff2',
  style: 'normal',
  weight: '600',
  display: 'block',
  preload: true, // the main reason for using next/font is to preload
  variable: '--font-material-symbols-rounded',
  adjustFontFallback: false,
})
const inter = Inter({ subsets: ['latin'], preload: true })
const fontClasses = [materialSymbols.variable, inter.className].join(' ')

import '@fairgarden/design/utils/global.css'
import './icons.css'

export const metadata: Metadata = {
  title: 'Fair Garden Identity System',
  description: 'Provides authentication services for Fair Garden',
}

export default async function RootLayout(
  layout: Readonly<{
    children: React.ReactNode
    params: Promise<{ locale: string }>
  }>
) {
  const { children, params } = layout
  const { locale } = await params
  console.log(layout)
  return (
    <html lang={locale}>
      <body className={fontClasses}>
        <ClientProvider locale={locale}>{children}</ClientProvider>
      </body>
    </html>
  )
}
