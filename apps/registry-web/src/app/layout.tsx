export const metadata = { title: 'Concierge Registry', description: 'Discover AI-actionable platforms.' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
