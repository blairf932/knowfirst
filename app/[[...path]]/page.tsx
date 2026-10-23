import { notFound } from 'next/navigation';
import { snapshot, userContext } from '@/lib/knowledge';
import { currentUser } from '@/lib/auth';
import FrontierApp from '@/components/frontier-app';
import { research } from '@/lib/research';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = (await params).path ?? [];
  const route = p[0] ?? 'dashboard';
  if (
    ![
      'dashboard',
      'search',
      'concept',
      'tool',
      'compare',
      'radar',
      'build',
      'sources',
      'settings',
    ].includes(route) ||
    p.length > 2
  )
    notFound();
  const query = await searchParams;
  const at =
    typeof query.at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.at) ? query.at : undefined;
  const data = await snapshot(at ? `${at}T23:59:59.999Z` : undefined);
  const user = await currentUser();
  if (
    route === 'search' &&
    typeof query.q === 'string' &&
    query.q.trim().length &&
    query.q.length <= 500
  )
    await research(data, query.q, await userContext(user?.id), user?.id);
  if (
    (route === 'concept' || route === 'tool') &&
    !data.entities.some(
      (e) => e.slug === p[1] && e.kind === (route === 'concept' ? 'Concept' : 'Tool'),
    )
  )
    notFound();
  return (
    <FrontierApp
      modelConfigured={process.env.LLM_PROVIDER === 'deepseek' && !!process.env.LLM_API_KEY}
      data={data}
      initialContext={await userContext(user?.id)}
      user={user}
      route={route}
      slug={p[1]}
      initialQuery={typeof query.q === 'string' ? query.q : ''}
      asOf={at}
    />
  );
}
