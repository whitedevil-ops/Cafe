-- ============================================================================
-- 0004 — Menu image storage.
-- Bucket "menu-images": public READ (photos appear on the anonymous QR menu),
-- but writes are tenant-scoped — the object path must start with a cafe_id the
-- caller is an active member of ("{cafe_id}/{filename}"). One café can never
-- overwrite or delete another café's images. 2MB cap + image MIME enforced at
-- the bucket level as defense-in-depth (the client also validates).
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 2097152,
        array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update
  set public = true,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/avif'];

drop policy if exists "menu images public read"   on storage.objects;
drop policy if exists "menu images member insert" on storage.objects;
drop policy if exists "menu images member update" on storage.objects;
drop policy if exists "menu images member delete" on storage.objects;

create policy "menu images public read" on storage.objects
  for select using (bucket_id = 'menu-images');

create policy "menu images member insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'menu-images'
              and is_cafe_member(((storage.foldername(name))[1])::uuid));

create policy "menu images member update" on storage.objects
  for update to authenticated
  using (bucket_id = 'menu-images'
         and is_cafe_member(((storage.foldername(name))[1])::uuid));

create policy "menu images member delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'menu-images'
         and is_cafe_member(((storage.foldername(name))[1])::uuid));
