import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function buildCorsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-reminder-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
const reminderFromEmail = Deno.env.get("REMINDER_FROM_EMAIL") ?? "";
const reminderCronSecret = Deno.env.get("REMINDER_CRON_SECRET") ?? "";
const appBaseUrl = Deno.env.get("APP_BASE_URL") ?? "";

const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
});

function normalizeReminderSettings(row: Record<string, unknown> | null) {
  return {
    id: row?.id ?? null,
    enabled: !!row?.enabled,
    subject_template: String(row?.subject_template ?? ""),
    body_template: String(row?.body_template ?? ""),
    recurrence: String(row?.recurrence ?? "weekly"),
    weekday: Number(row?.weekday ?? 1),
    time_hhmm: String(row?.time_hhmm ?? "11:00"),
    timezone: String(row?.timezone ?? "America/Sao_Paulo"),
    last_sent_at: row?.last_sent_at ?? null,
    last_sent_by: String(row?.last_sent_by ?? ""),
  };
}

function getLocalDateParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value]),
  );

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekdayMap[String(parts.weekday)] ?? 0,
  };
}

function getWeekOfMonth(day: number) {
  return Math.ceil(day / 7);
}

function formatMonthName(monthIndex: number) {
  return [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ][monthIndex] ?? "";
}

function renderTemplate(template: string, variables: Record<string, string>) {
  return Object.entries(variables).reduce(
    (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value),
    template,
  );
}

function isScheduleDue(settings: ReturnType<typeof normalizeReminderSettings>, now = new Date()) {
  const local = getLocalDateParts(now, settings.timezone);
  const [hour, minute] = settings.time_hhmm.split(":").map(Number);

  if (local.hour !== hour || local.minute !== minute) return false;
  if (settings.recurrence === "daily") return true;
  if (settings.recurrence === "monthly") return local.day === settings.weekday;
  return local.weekday === settings.weekday;
}

function alreadySentForThisMinute(lastSentAt: unknown, timezone: string, now = new Date()) {
  if (!lastSentAt) return false;
  const current = getLocalDateParts(now, timezone);
  const previous = getLocalDateParts(new Date(String(lastSentAt)), timezone);
  return current.year === previous.year &&
    current.month === previous.month &&
    current.day === previous.day &&
    current.hour === previous.hour &&
    current.minute === previous.minute;
}

function jsonResponse(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildCorsHeaders(request),
      "Content-Type": "application/json",
    },
  });
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendEmailWithRetry(payload: Record<string, unknown>, toEmail: string, attempt = 0): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (response.ok) return;

  const errorText = await response.text();
  if (response.status === 429 && attempt < 3) {
    await sleep(600 * (attempt + 1));
    return sendEmailWithRetry(payload, toEmail, attempt + 1);
  }

  throw new Error(`Falha ao enviar para ${toEmail}: ${errorText}`);
}

async function ensureAuthorized(request: Request, trigger: string) {
  if (trigger === "scheduled") {
    const secret = request.headers.get("x-reminder-secret") || "";
    return secret && secret === reminderCronSecret;
  }

  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user?.email) return false;

  const { data: profile, error: profileError } = await adminClient
    .from("app_users")
    .select("role, active, can_access")
    .eq("email", authData.user.email.toLowerCase())
    .maybeSingle();

  if (profileError || !profile) return false;
  return profile.role === "admin" && profile.active === true && profile.can_access === true;
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: buildCorsHeaders(request) });
  }

  try {
    if (request.method !== "POST") {
      return jsonResponse(request, { error: "MÃ©todo nÃ£o suportado." }, 405);
    }

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return jsonResponse(request, { error: "VariÃ¡veis do Supabase nÃ£o configuradas." }, 500);
    }

    if (!resendApiKey || !reminderFromEmail) {
      return jsonResponse(request, { error: "RESEND_API_KEY ou REMINDER_FROM_EMAIL nÃ£o configurados." }, 500);
    }

    const body = await request.json().catch(() => ({}));
    const trigger = String(body?.trigger || "manual");
    const authorized = await ensureAuthorized(request, trigger);
    if (!authorized) {
      return jsonResponse(request, { error: "NÃ£o autorizado para disparar lembretes." }, 401);
    }

    const { data: rawSettings, error: settingsError } = await adminClient
      .from("app_reminder_settings")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (settingsError) {
      return jsonResponse(request, { error: settingsError.message }, 500);
    }

    const settings = normalizeReminderSettings(rawSettings);
    if (!settings.id) {
      return jsonResponse(request, { error: "ConfiguraÃ§Ã£o de lembrete nÃ£o encontrada." }, 400);
    }

    if (trigger === "scheduled") {
      if (!settings.enabled) {
        return jsonResponse(request, { skipped: true, reason: "Lembrete pausado." }, 200);
      }
      if (!isScheduleDue(settings)) {
        return jsonResponse(request, { skipped: true, reason: "Fora da janela configurada." }, 200);
      }
      if (alreadySentForThisMinute(settings.last_sent_at, settings.timezone)) {
        return jsonResponse(request, { skipped: true, reason: "Lembrete jÃ¡ enviado nesta janela." }, 200);
      }
    }

    const { data: recipients, error: recipientsError } = await adminClient
      .from("app_users")
      .select("email, name, role")
      .in("role", ["admin", "editor"])
      .eq("active", true)
      .eq("can_access", true)
      .order("email", { ascending: true });

    if (recipientsError) {
      return jsonResponse(request, { error: recipientsError.message }, 500);
    }

    const now = new Date();
    const local = getLocalDateParts(now, settings.timezone);
    const monthName = formatMonthName(local.month - 1);
    const weekLabel = body?.focusedSemana || `S${getWeekOfMonth(local.day)}`;
    const baseUrl = String(body?.appUrl || appBaseUrl || "");
    const sentEmails: string[] = [];

    for (const recipient of recipients || []) {
      const name = String(recipient.name || recipient.email.split("@")[0] || "");
      const variables = {
        nome: name,
        email: String(recipient.email || ""),
        mes: monthName,
        ano: String(local.year),
        semana: weekLabel,
        link_app: baseUrl,
      };

      const subject = renderTemplate(settings.subject_template, variables);
      const htmlBody = renderTemplate(settings.body_template, variables)
        .replaceAll("\n", "<br>");

      await sendEmailWithRetry({
        from: reminderFromEmail,
        to: [recipient.email],
        subject,
        html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937">${htmlBody}</div>`,
      }, recipient.email);

      sentEmails.push(recipient.email);
      await sleep(250);
    }

    const lastSentAt = now.toISOString();
    const lastSentBy = trigger === "scheduled" ? "automatico" : String(body?.triggeredBy || "manual");

    const { error: updateError } = await adminClient
      .from("app_reminder_settings")
      .update({
        last_sent_at: lastSentAt,
        last_sent_by: lastSentBy,
      })
      .eq("id", settings.id);

    if (updateError) {
      return jsonResponse(request, { error: updateError.message }, 500);
    }

    return jsonResponse(request, {
      ok: true,
      recipientCount: sentEmails.length,
      lastSentAt,
      lastSentBy,
    }, 200);
  } catch (error) {
    return jsonResponse(request, {
      error: error instanceof Error ? error.message : "Falha inesperada ao processar o lembrete.",
    }, 500);
  }
});

