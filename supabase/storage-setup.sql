insert into storage.buckets (id, name, public)
values ('rps-attachments', 'rps-attachments', true)
on conflict (id) do nothing;

create policy "Authenticated users can upload RPS attachments"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'rps-attachments');

create policy "Authenticated users can read RPS attachments"
on storage.objects
for select
to authenticated
using (bucket_id = 'rps-attachments');

create policy "Authenticated users can delete RPS attachments"
on storage.objects
for delete
to authenticated
using (bucket_id = 'rps-attachments');
