// The one name for "this café's cached menu catalog". Both server-side caches
// that hold menu data — the customer QR menu (lib/menu-cache.ts) and the POS
// catalog (lib/pos-cache.ts) — attach this tag, and app/api/menu/revalidate
// expires it after a menu write. Kept in its own import-free file so the
// route, both caches and any future cache share one definition and can't drift.
export const menuCacheTag = (cafeId: string) => `menu:${cafeId}`
