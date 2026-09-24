import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: '@fairgarden-private/members',
  description: 'Membership, and the profile members share with the community',
}

/**
 * Unstyled on purpose. The nav is here so every page has a way back, since the
 * pages themselves only cross-link within a section.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/">Home</Link> · <Link href="/overview">Overview</Link> ·{' '}
          <Link href="/commands">Commands</Link> ·{' '}
          <Link href="/configuration">Configuration</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  )
}
