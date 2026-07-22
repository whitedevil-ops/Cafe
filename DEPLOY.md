# Deploying KhaoPiyo

Production host: **Vercel** (Next.js 16 App Router, server components, `proxy.ts`,
Supabase SSR auth). Database: **Supabase** (already cloud-hosted, independent of the host).

## 1. Push to GitHub

```bash
git remote add origin https://github.com/whitedevil-ops/Cafe.git
git push -u origin main
```

## 2. Import on Vercel

1. https://vercel.com/new → Import the `Cafe` repo. Framework auto-detects as Next.js; keep defaults.
2. Add Environment Variables **before** the first deploy (they are inlined at build time):

   | Name | Value |
   |------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://zfoewekgwtvbykyitpig.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_toxT-6hL67Py9PXqLdA2SQ_AZiEthl5` |
   | `NEXT_PUBLIC_APP_URL` | your Vercel URL (set after first deploy, then redeploy) |

   Add later, when anonymous QR ordering is wired to the real DB (server-only, never `NEXT_PUBLIC_`):
   | `SUPABASE_SERVICE_ROLE_KEY` | your `sb_secret_...` key |

3. Deploy.

## 3. Supabase configuration

- **SQL Editor** → run all of `supabase/schema.sql` once. Nothing past the login page works until this is done.
- **Authentication → URL Configuration** → set **Site URL** to the Vercel URL and add it to **Redirect URLs** (so email confirmation/reset links don't point at localhost).
- For testing the full journey without email round-trips: **Authentication → Providers → Email** → turn **Confirm email** off (turn back on before launch).

## Notes

- `.env.local` is gitignored and never deployed. Env vars live in the Vercel dashboard.
- `NEXT_PUBLIC_APP_URL` is chicken-and-egg: deploy once, copy the URL, set the var, redeploy — or attach a custom domain first.
- Production build is verified locally with `npm run build`. Run it before every deploy to catch issues (e.g. missing Suspense boundaries) that dev mode hides.
