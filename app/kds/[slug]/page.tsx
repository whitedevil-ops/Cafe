import KdsClient from './kds-client'

export const dynamic = 'force-dynamic'

export default async function KdsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <KdsClient slug={slug} />
}
