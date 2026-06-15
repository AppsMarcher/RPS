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
const BACKUP_BUCKET = "rps-attachments-backup";
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
      throw new Error(`Não foi possível limpar arquivos do bucket "${bucket}": ${error.message}`);
    }
    deletedCount += batch.length;
  }

  return deletedCount;
}

function normalizeBackupPrefix(rawPrefix: unknown) {
  const prefix = String(rawPrefix || "").trim().replace(/^\/+|\/+$/g, "");
  if (!prefix) {
    throw new Error("Informe um backup_prefix válido. Exemplo: weekly/2026-06-16");
  }
  if (!prefix.startsWith("weekly/")) {
    throw new Error("O backup_prefix precisa começar com 'weekly/'.");
  }
  return prefix;
}

function stripBackupPrefix(filePath: string, backupPrefix: string) {
  const prefix = `${backupPrefix}/`;
  if (!filePath.startsWith(prefix)) {
    throw new Error(`O arquivo "${filePath}" não pertence ao prefixo informado "${backupPrefix}".`);
  }
  return filePath.slice(prefix.length);
}

function isAuthorized(request: Request) {
  if (!storageBackupCronSecret) return false;
  const headerSecret = request.headers.get("x-storage-backup-secret") || "";
  return headerSecret === storageBackupCronSecret;
}

async function createRunLog(backupPrefix: string, clearSourceFirst: boolean) {
  const { data, error } = await adminClient
    .from("rps_storage_backup_runs")
    .insert({
      source_bucket: BACKUP_BUCKET,
      target_bucket: SOURCE_BUCKET,
      backup_prefix: backupPrefix,
      status: "running",
      started_at: new Date().toISOString(),
      details: {
        operation: "restore",
        clear_source_first: clearSourceFirst,
      },
    })
    .select("id")
    .single();

  if (error) {
    console.error("Não foi possível criar log inicial do restore de storage:", error.message);
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
    console.error("Não foi possível finalizar log do restore de storage:", error.message);
  }
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
    return jsonResponse(request, { error: "Não autorizado para executar restore do storage." }, 401);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const backupPrefix = normalizeBackupPrefix(body?.backup_prefix);
    const clearSourceFirst = body?.clear_source_first === true;
    const runId = await createRunLog(backupPrefix, clearSourceFirst);

    try {
      const backupFiles = await listFilesRecursive(BACKUP_BUCKET, backupPrefix);
      if (!backupFiles.length) {
        throw new Error(`Nenhum arquivo encontrado em "${BACKUP_BUCKET}/${backupPrefix}".`);
      }

      let deletedCount = 0;
      if (clearSourceFirst) {
        const currentSourceFiles = await listFilesRecursive(SOURCE_BUCKET);
        deletedCount = await deleteFilesInBatches(SOURCE_BUCKET, currentSourceFiles.map(file => file.path));
      }

      let restoredCount = 0;
      for (const file of backupFiles) {
        const restorePath = stripBackupPrefix(file.path, backupPrefix);
        const { data: downloadedFile, error: downloadError } = await adminClient.storage
          .from(BACKUP_BUCKET)
          .download(file.path);

        if (downloadError) {
          throw new Error(`Não foi possível baixar "${file.path}" do bucket "${BACKUP_BUCKET}": ${downloadError.message}`);
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
          throw new Error(`Não foi possível restaurar "${restorePath}" no bucket "${SOURCE_BUCKET}": ${uploadError.message}`);
        }

        restoredCount += 1;
      }

      const responseBody = {
        ok: true,
        operation: "restore",
        backupPrefix,
        sourceBucket: SOURCE_BUCKET,
        backupBucket: BACKUP_BUCKET,
        clearSourceFirst,
        filesDeleted: deletedCount,
        filesRestored: restoredCount,
      };

      await finishRunLog(runId, {
        status: "success",
        files_copied: restoredCount,
        files_deleted: deletedCount,
        details: responseBody,
      });

      return jsonResponse(request, responseBody, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha inesperada ao restaurar o storage.";
      await finishRunLog(runId, {
        status: "error",
        error_message: message,
      });
      return jsonResponse(request, { error: message, backupPrefix }, 500);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada ao processar a requisição.";
    return jsonResponse(request, { error: message }, 400);
  }
});
