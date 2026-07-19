import { notFound } from 'next/navigation'
import { getTableContext } from '@/lib/db'
import MenuClient from './menu-client'

export const dynamic = 'force-dynamic'

export default async function TablePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const ctx = await getTableContext(token)
  if (!ctx) notFound()
  return <MenuClient cafe={ctx.cafe} table={ctx.table} menu={ctx.menu} />
}
