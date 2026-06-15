import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function buildCorsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-storage-backup-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const storageBackupCronSecret = Deno.env.get("STORAGE_BACKUP_CRON_SECRET") ?? "";

const SOURCE_BUCKET = "rps-attachments";
const TARGET_BUCKET = "rps-attachments-backup";
const BACKUP_ROOT = "weekly";
const BACKUP_RETENTION_DAYS = 45;
const LIST_PAGE_SIZE = 100;
const DELETE_BATCH_SIZE = 100;

const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
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

function getBackupPrefix(now = new Date()) {
  const local = getLocalDateParts(now, "America/Sao_Paulo");
  const yyyy = String(local.year);
  const mm = String(local.month).padStart(2, "0");
  const dd = String(local.day).padStart(2, "0");
  return `${BACKUP_ROOT}/${yyyy}-${mm}-${dd}`;
}

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
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

  for (const batch of chunkArray(filePaths, DELETE_BATCH_SIZE)) {
    const { error } = await adminClient.storage.from(bucket).remove(batch);
    if (error) {
      throw new Error(`Não foi possível limpar arquivos antigos do bucket "${bucket}": ${error.message}`);
    }
    deletedCount += batch.length;
  }

  return deletedCount;
}

function getOldBackupPrefixes(now = new Date(), folderNames: string[]) {
  const threshold = new Date(now.getTime() - (BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000));

  return folderNames.filter(name => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) return false;
    const folderDate = new Date(`${name}T00:00:00.000Z`);
    return folderDate < threshold;
  }).map(name => `${BACKUP_ROOT}/${name}`);
}

async function cleanupExpiredBackups(now = new Date()) {
  const { data, error } = await adminClient.storage.from(TARGET_BUCKET).list(BACKUP_ROOT, {
    limit: LIST_PAGE_SIZE,
    offset: 0,
    sortBy: { column: "name", order: "asc" },
  });

  if (error) {
    throw new Error(`Não foi possível listar os backups do bucket "${TARGET_BUCKET}": ${error.message}`);
  }

  const folderNames = ((data || []) as StorageListEntry[])
    .filter(isFolderEntry)
    .map(entry => entry.name);

  const expiredPrefixes = getOldBackupPrefixes(now, folderNames);
  let deletedCount = 0;

  for (const prefix of expiredPrefixes) {
    const files = await listFilesRecursive(TARGET_BUCKET, prefix);
    deletedCount += await deleteFilesInBatches(TARGET_BUCKET, files.map(file => file.path));
  }

  return {
    expiredPrefixes,
    deletedCount,
  };
}

async function createRunLog(backupPrefix: string) {
  const { data, error } = await adminClient
    .from("rps_storage_backup_runs")
    .insert({
      source_bucket: SOURCE_BUCKET,
      target_bucket: TARGET_BUCKET,
      backup_prefix: backupPrefix,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("Não foi possível criar log inicial do backup de storage:", error.message);
    return null;
  }

  return data?.id ?? null;
}

async function finishRunLog(
  runId: number | null,
  payload: {
    status: "success" | "error";
    files_copied?: number;
    files_deleted?: number;
    details?: Record<string, unknown>;
    error_message?: string;
  },
) {
  if (!runId) return;

  const { error } = await adminClient
    .from("rps_storage_backup_runs")
    .update({
      status: payload.status,
      files_copied: payload.files_copied ?? 0,
      files_deleted: payload.files_deleted ?? 0,
      details: payload.details ?? {},
      error_message: payload.error_message ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (error) {
    console.error("Não foi possível finalizar log do backup de storage:", error.message);
  }
}

async function copySourceBucketToBackup(backupPrefix: string) {
  const sourceFiles = await listFilesRecursive(SOURCE_BUCKET);
  let copiedCount = 0;

  for (const file of sourceFiles) {
    const { data: downloadedFile, error: downloadError } = await adminClient.storage
      .from(SOURCE_BUCKET)
      .download(file.path);

    if (downloadError) {
      throw new Error(`Não foi possível baixar "${file.path}" do bucket "${SOURCE_BUCKET}": ${downloadError.message}`);
    }

    const targetPath = `${backupPrefix}/${file.path}`;
    const contentType = typeof file.metadata?.mimetype === "string"
      ? String(file.metadata?.mimetype)
      : downloadedFile.type || undefined;

    const { error: uploadError } = await adminClient.storage
      .from(TARGET_BUCKET)
      .upload(targetPath, downloadedFile, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Não foi possível gravar "${targetPath}" no bucket "${TARGET_BUCKET}": ${uploadError.message}`);
    }

    copiedCount += 1;
  }

  return {
    copiedCount,
    sourceFileCount: sourceFiles.length,
  };
}

function isAuthorized(request: Request) {
  if (!storageBackupCronSecret) return false;
  const headerSecret = request.headers.get("x-storage-backup-secret") || "";
  return headerSecret === storageBackupCronSecret;
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: buildCorsHeaders(request) });
  }

  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Método não suportado." }, 405);
  }

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse(request, { error: "Variáveis do Supabase não configuradas." }, 500);
  }

  if (!isAuthorized(request)) {
    return jsonResponse(request, { error: "Não autorizado para executar backup do storage." }, 401);
  }

  const startedAt = new Date();
  const backupPrefix = getBackupPrefix(startedAt);
  const runId = await createRunLog(backupPrefix);

  try {
    const copyResult = await copySourceBucketToBackup(backupPrefix);
    const cleanupResult = await cleanupExpiredBackups(startedAt);

    const responseBody = {
      ok: true,
      backupPrefix,
      sourceBucket: SOURCE_BUCKET,
      targetBucket: TARGET_BUCKET,
      sourceFileCount: copyResult.sourceFileCount,
      filesCopied: copyResult.copiedCount,
      filesDeleted: cleanupResult.deletedCount,
      deletedPrefixes: cleanupResult.expiredPrefixes,
    };

    await finishRunLog(runId, {
      status: "success",
      files_copied: copyResult.copiedCount,
      files_deleted: cleanupResult.deletedCount,
      details: responseBody,
    });

    return jsonResponse(request, responseBody, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada ao processar o backup do storage.";
    await finishRunLog(runId, {
      status: "error",
      error_message: message,
    });
    return jsonResponse(request, { error: message, backupPrefix }, 500);
  }
});
