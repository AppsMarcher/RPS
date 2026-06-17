import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function buildCorsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const APP_USERS_TABLE = "app_users";
const SNAPSHOTS_TABLE = "rps_snapshots";
const SNAPSHOTS_BACKUP_TABLE = "rps_snapshots_backup";
const STORAGE_RUNS_TABLE = "rps_storage_backup_runs";
const SOURCE_BUCKET = "rps-attachments";
const BACKUP_BUCKET = "rps-attachments-backup";
const LIST_PAGE_SIZE = 100;
const DELETE_BATCH_SIZE = 100;

const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
});

type StorageListEntry = {
  name: string;
  id?: string | null;
  metadata?: Record<string, unknown> | null;
};

function jsonResponse(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildCorsHeaders(request),
      "Content-Type": "application/json",
    },
  });
}

function getLocalDateParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function formatBackupDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = getLocalDateParts(date, "America/Sao_Paulo");
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function buildDateRange(days: number) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(end.getDate() - Math.max(0, days - 1));
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function getDateWindowForBackupKey(backupDate: string) {
  const start = new Date(`${backupDate}T00:00:00-03:00`);
  if (Number.isNaN(start.getTime())) {
    throw new Error("Data de backup inválida.");
  }
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return { start, end };
}

function joinStoragePath(basePath: string, name: string) {
  return basePath ? `${basePath}/${name}` : name;
}

function isFolderEntry(entry: StorageListEntry) {
  return !entry.id && !entry.metadata;
}

async function listFilesRecursive(bucket: string, path = ""): Promise<Array<{ path: string; metadata: Record<string, unknown> | null }>> {
  const files: Array<{ path: string; metadata: Record<string, unknown> | null }> = [];
  let offset = 0;

  while (true) {
    const { data, error } = await adminClient.storage.from(bucket).list(path, {
      limit: LIST_PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) {
      throw new Error(`Não foi possível listar "${bucket}/${path}": ${error.message}`);
    }

    const entries = (data || []) as StorageListEntry[];
    for (const entry of entries) {
      const fullPath = joinStoragePath(path, entry.name);
      if (isFolderEntry(entry)) {
        files.push(...await listFilesRecursive(bucket, fullPath));
      } else {
        files.push({ path: fullPath, metadata: entry.metadata || null });
      }
    }

    if (entries.length < LIST_PAGE_SIZE) break;
    offset += LIST_PAGE_SIZE;
  }

  return files;
}

async function deleteFilesInBatches(bucket: string, filePaths: string[]) {
  let deletedCount = 0;
  for (let index = 0; index < filePaths.length; index += DELETE_BATCH_SIZE) {
    const batch = filePaths.slice(index, index + DELETE_BATCH_SIZE);
    const { error } = await adminClient.storage.from(bucket).remove(batch);
    if (error) {
      throw new Error(`Não foi possível limpar arquivos do bucket "${bucket}": ${error.message}`);
    }
    deletedCount += batch.length;
  }
  return deletedCount;
}

function stripBackupPrefix(filePath: string, backupPrefix: string) {
  const prefix = `${backupPrefix}/`;
  if (!filePath.startsWith(prefix)) {
    throw new Error(`O arquivo "${filePath}" não pertence ao prefixo "${backupPrefix}".`);
  }
  return filePath.slice(prefix.length);
}

async function ensureAuthorized(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user?.email) return false;

  const { data: profile, error: profileError } = await adminClient
    .from(APP_USERS_TABLE)
    .select("role, active, can_access")
    .eq("email", authData.user.email.toLowerCase())
    .maybeSingle();

  if (profileError || !profile) return false;
  return profile.role === "admin" && profile.active === true && profile.can_access === true;
}

function buildBackupMap() {
  return new Map<string, {
    backupDate: string;
    hasDatabase: boolean;
    hasStorage: boolean;
    isRestorable: boolean;
    databaseSnapshotCount: number;
    databasePeriods: string[];
    storageBackupPrefix: string;
    storageFilesCopied: number;
    lastDatabaseAt: string;
    lastStorageAt: string;
  }>();
}

async function listBackups(days = 30) {
  const { start } = buildDateRange(days);
  const backupMap = buildBackupMap();

  const { data: dbRows, error: dbError } = await adminClient
    .from(SNAPSHOTS_BACKUP_TABLE)
    .select("snapshot_ano, snapshot_mes, backed_up_at")
    .gte("backed_up_at", start.toISOString())
    .order("backed_up_at", { ascending: false });

  if (dbError) {
    throw new Error(`Não foi possível listar os backups do banco. Detalhe: ${dbError.message}`);
  }

  for (const row of dbRows || []) {
    const backupDate = formatBackupDateKey(String(row.backed_up_at));
    const current = backupMap.get(backupDate) || {
      backupDate,
      hasDatabase: false,
      hasStorage: false,
      isRestorable: false,
      databaseSnapshotCount: 0,
      databasePeriods: [],
      storageBackupPrefix: "",
      storageFilesCopied: 0,
      lastDatabaseAt: "",
      lastStorageAt: "",
    };

    current.hasDatabase = true;
    current.databaseSnapshotCount += 1;
    current.lastDatabaseAt = current.lastDatabaseAt || String(row.backed_up_at || "");
    const periodLabel = `${String(row.snapshot_mes).padStart(2, "0")}/${row.snapshot_ano}`;
    if (!current.databasePeriods.includes(periodLabel)) {
      current.databasePeriods.push(periodLabel);
    }
    backupMap.set(backupDate, current);
  }

  const { data: storageRows, error: storageError } = await adminClient
    .from(STORAGE_RUNS_TABLE)
    .select("backup_prefix, files_copied, started_at, source_bucket, target_bucket, status")
    .eq("source_bucket", SOURCE_BUCKET)
    .eq("target_bucket", BACKUP_BUCKET)
    .eq("status", "success")
    .gte("started_at", start.toISOString())
    .order("started_at", { ascending: false });

  if (storageError) {
    throw new Error(`Não foi possível listar os backups do storage. Detalhe: ${storageError.message}`);
  }

  for (const row of storageRows || []) {
    const match = String(row.backup_prefix || "").match(/^weekly\/(\d{4}-\d{2}-\d{2})$/);
    if (!match) continue;
    const backupDate = match[1];
    const current = backupMap.get(backupDate) || {
      backupDate,
      hasDatabase: false,
      hasStorage: false,
      isRestorable: false,
      databaseSnapshotCount: 0,
      databasePeriods: [],
      storageBackupPrefix: "",
      storageFilesCopied: 0,
      lastDatabaseAt: "",
      lastStorageAt: "",
    };

    current.hasStorage = true;
    current.storageBackupPrefix = current.storageBackupPrefix || String(row.backup_prefix || "");
    current.storageFilesCopied = Number(row.files_copied || 0);
    current.lastStorageAt = current.lastStorageAt || String(row.started_at || "");
    backupMap.set(backupDate, current);
  }

  const backups = [...backupMap.values()]
    .map(entry => ({
      ...entry,
      databasePeriods: [...entry.databasePeriods].sort(),
      isRestorable: entry.hasDatabase && entry.hasStorage,
    }))
    .sort((left, right) => right.backupDate.localeCompare(left.backupDate));

  return backups;
}

async function restoreDatabaseFromBackupDate(backupDate: string) {
  const { start, end } = getDateWindowForBackupKey(backupDate);
  const { data: backupRows, error: backupError } = await adminClient
    .from(SNAPSHOTS_BACKUP_TABLE)
    .select("snapshot_ano, snapshot_mes, snapshot_version, snapshot_payload, backed_up_at")
    .gte("backed_up_at", start.toISOString())
    .lt("backed_up_at", end.toISOString())
    .order("backed_up_at", { ascending: false });

  if (backupError) {
    throw new Error(`Não foi possível carregar o backup do banco. Detalhe: ${backupError.message}`);
  }

  if (!backupRows?.length) {
    throw new Error(`Nenhum backup de banco encontrado para ${backupDate}.`);
  }

  const latestByPeriod = new Map<string, typeof backupRows[number]>();
  for (const row of backupRows) {
    const key = `${row.snapshot_ano}|${row.snapshot_mes}`;
    if (!latestByPeriod.has(key)) {
      latestByPeriod.set(key, row);
    }
  }

  const { data: currentRows, error: currentError } = await adminClient
    .from(SNAPSHOTS_TABLE)
    .select("ano, mes, version");

  if (currentError) {
    throw new Error(`Não foi possível ler os snapshots atuais. Detalhe: ${currentError.message}`);
  }

  const currentMap = new Map((currentRows || []).map(row => [`${row.ano}|${row.mes}`, row]));
  let restoredCount = 0;

  for (const row of latestByPeriod.values()) {
    const key = `${row.snapshot_ano}|${row.snapshot_mes}`;
    const current = currentMap.get(key);

    if (current) {
      const { error } = await adminClient
        .from(SNAPSHOTS_TABLE)
        .update({
          payload: row.snapshot_payload,
          version: Number(current.version || 0) + 1,
        })
        .eq("ano", row.snapshot_ano)
        .eq("mes", row.snapshot_mes);

      if (error) {
        throw new Error(`Não foi possível restaurar o período ${row.snapshot_mes}/${row.snapshot_ano}. Detalhe: ${error.message}`);
      }
    } else {
      const { error } = await adminClient
        .from(SNAPSHOTS_TABLE)
        .insert({
          ano: row.snapshot_ano,
          mes: row.snapshot_mes,
          payload: row.snapshot_payload,
          version: Math.max(Number(row.snapshot_version || 1), 1),
        });

      if (error) {
        throw new Error(`Não foi possível recriar o período ${row.snapshot_mes}/${row.snapshot_ano}. Detalhe: ${error.message}`);
      }
    }

    restoredCount += 1;
  }

  return {
    restoredCount,
    periods: [...latestByPeriod.values()].map(row => `${String(row.snapshot_mes).padStart(2, "0")}/${row.snapshot_ano}`).sort(),
  };
}

async function createStorageRestoreRunLog(backupPrefix: string) {
  const { data, error } = await adminClient
    .from(STORAGE_RUNS_TABLE)
    .insert({
      source_bucket: BACKUP_BUCKET,
      target_bucket: SOURCE_BUCKET,
      backup_prefix: backupPrefix,
      status: "running",
      started_at: new Date().toISOString(),
      details: {
        operation: "restore",
        clear_source_first: true,
      },
    })
    .select("id")
    .single();

  if (error) {
    console.error("Não foi possível criar log do restore de storage:", error.message);
    return null;
  }

  return data?.id ?? null;
}

async function finishStorageRestoreRunLog(
  runId: number | null,
  payload: {
    status: "success" | "error";
    filesCopied?: number;
    filesDeleted?: number;
    details?: Record<string, unknown>;
    errorMessage?: string;
  },
) {
  if (!runId) return;

  const { error } = await adminClient
    .from(STORAGE_RUNS_TABLE)
    .update({
      status: payload.status,
      files_copied: payload.filesCopied ?? 0,
      files_deleted: payload.filesDeleted ?? 0,
      details: payload.details ?? {},
      error_message: payload.errorMessage ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (error) {
    console.error("Não foi possível finalizar log do restore de storage:", error.message);
  }
}

async function restoreStorageFromBackupDate(backupDate: string) {
  const backupPrefix = `weekly/${backupDate}`;
  const { data: backupRun, error: backupRunError } = await adminClient
    .from(STORAGE_RUNS_TABLE)
    .select("id, backup_prefix, files_copied, started_at")
    .eq("source_bucket", SOURCE_BUCKET)
    .eq("target_bucket", BACKUP_BUCKET)
    .eq("status", "success")
    .eq("backup_prefix", backupPrefix)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (backupRunError) {
    throw new Error(`Não foi possível localizar o backup do storage. Detalhe: ${backupRunError.message}`);
  }

  if (!backupRun?.backup_prefix) {
    throw new Error(`Nenhum backup de storage encontrado para ${backupDate}.`);
  }

  const runId = await createStorageRestoreRunLog(backupPrefix);

  try {
    const backupFiles = await listFilesRecursive(BACKUP_BUCKET, backupPrefix);
    if (!backupFiles.length) {
      throw new Error(`Nenhum arquivo encontrado em "${BACKUP_BUCKET}/${backupPrefix}".`);
    }

    const currentSourceFiles = await listFilesRecursive(SOURCE_BUCKET);
    const deletedCount = currentSourceFiles.length
      ? await deleteFilesInBatches(SOURCE_BUCKET, currentSourceFiles.map(file => file.path))
      : 0;

    let restoredCount = 0;
    for (const file of backupFiles) {
      const restorePath = stripBackupPrefix(file.path, backupPrefix);
      const { data: downloadedFile, error: downloadError } = await adminClient.storage
        .from(BACKUP_BUCKET)
        .download(file.path);

      if (downloadError) {
        throw new Error(`Não foi possível baixar "${file.path}" do backup. Detalhe: ${downloadError.message}`);
      }

      const contentType = typeof file.metadata?.mimetype === "string"
        ? String(file.metadata?.mimetype)
        : downloadedFile.type || undefined;

      const { error: uploadError } = await adminClient.storage
        .from(SOURCE_BUCKET)
        .upload(restorePath, downloadedFile, {
          contentType,
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`Não foi possível restaurar "${restorePath}" no storage principal. Detalhe: ${uploadError.message}`);
      }

      restoredCount += 1;
    }

    const details = {
      operation: "restore",
      clear_source_first: true,
      backupPrefix,
      restoredCount,
      deletedCount,
    };
    await finishStorageRestoreRunLog(runId, {
      status: "success",
      filesCopied: restoredCount,
      filesDeleted: deletedCount,
      details,
    });

    return {
      restoredCount,
      deletedCount,
      backupPrefix,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada ao restaurar o storage.";
    await finishStorageRestoreRunLog(runId, {
      status: "error",
      errorMessage: message,
    });
    throw error;
  }
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: buildCorsHeaders(request) });
  }

  try {
    if (request.method !== "POST") {
      return jsonResponse(request, { error: "Método não suportado." }, 405);
    }

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return jsonResponse(request, { error: "Variáveis do Supabase não configuradas." }, 500);
    }

    const authorized = await ensureAuthorized(request);
    if (!authorized) {
      return jsonResponse(request, { error: "Não autorizado para gerenciar backups." }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "list");

    if (action === "list") {
      const days = Math.max(1, Math.min(60, Number(body?.days || 30) || 30));
      const backups = await listBackups(days);
      return jsonResponse(request, { backups }, 200);
    }

    if (action === "restore") {
      const backupDate = String(body?.backup_date || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(backupDate)) {
        return jsonResponse(request, { error: "Informe uma data de backup válida no formato YYYY-MM-DD." }, 400);
      }

      const databaseResult = await restoreDatabaseFromBackupDate(backupDate);
      const storageResult = await restoreStorageFromBackupDate(backupDate);

      return jsonResponse(request, {
        ok: true,
        backupDate,
        databaseRestoredCount: databaseResult.restoredCount,
        databasePeriods: databaseResult.periods,
        storageRestoredCount: storageResult.restoredCount,
        storageDeletedCount: storageResult.deletedCount,
        storageBackupPrefix: storageResult.backupPrefix,
      }, 200);
    }

    return jsonResponse(request, { error: "Ação não suportada." }, 400);
  } catch (error) {
    return jsonResponse(request, {
      error: error instanceof Error ? error.message : "Falha inesperada ao processar a solicitação.",
    }, 500);
  }
});
