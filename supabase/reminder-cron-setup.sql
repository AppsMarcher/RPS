-- Configura o agendamento automático do lembrete da RPS no Supabase Cron.
-- Execute este script no SQL Editor do projeto Supabase depois de:
-- 1. Criar a secret REMINDER_CRON_SECRET nas Edge Functions.
-- 2. Ajustar o valor da secret project_url abaixo, se necessário.
-- 3. Confirmar que a função send-rps-reminder já foi publicada.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists vault;

-- Salve estes segredos uma única vez. Ajuste o project_url se mudar de projeto.
select vault.create_secret('https://ddyrxjlbtihhnokbdlan.supabase.co', 'project_url')
where not exists (
  select 1 from vault.decrypted_secrets where name = 'project_url'
);

select vault.create_secret('sb_publishable_5O8LN8KmqEZtHrkYFWbuRg_eWUlUZfz', 'publishable_key')
where not exists (
  select 1 from vault.decrypted_secrets where name = 'publishable_key'
);

-- Substitua pelo mesmo valor configurado como REMINDER_CRON_SECRET nas secrets da Edge Function.
select vault.create_secret('SUBSTITUA_PELO_MESMO_SECRET_DA_EDGE_FUNCTION', 'reminder_cron_secret')
where not exists (
  select 1 from vault.decrypted_secrets where name = 'reminder_cron_secret'
);

do $$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
  from cron.job
  where jobname = 'send-rps-reminder-scheduler'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end $$;

select
  cron.schedule(
    'send-rps-reminder-scheduler',
    '* * * * *',
    $$
    select
      net.http_post(
        url:= (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
          || '/functions/v1/send-rps-reminder',
        headers:= jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key'),
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key'),
          'x-reminder-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_secret')
        ),
        body:= jsonb_build_object(
          'trigger', 'scheduled'
        ),
        timeout_milliseconds:= 10000
      ) as request_id;
    $$
  );

-- Consulta rápida para conferir se o job ficou cadastrado.
select jobid, jobname, schedule, active
from cron.job
where jobname = 'send-rps-reminder-scheduler';
