import type { Metadata } from 'next'
import { ClientProvider } from '@fairgarden/design/utils/ClientProvider'
import '@fairgarden/design/utils/global.css'
import '@fairgarden/design/utils/fonts'
import './[locale]/icons.css'

export const metadata: Metadata = {
  title: 'Members',
  description: 'Your membership, and what you share with the community.',
}

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ locale?: string }>
}>) {
  const { locale = 'en' } = await params
  return (
    <html lang={locale}>
      <body style={{ backgroundColor: 'var(--role-ground)' }}>
        <ClientProvider locale={locale}>{children}</ClientProvider>
      </body>
    </html>
  )
}
