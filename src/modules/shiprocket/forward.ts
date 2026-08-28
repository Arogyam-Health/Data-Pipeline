import { logger } from "@/lib/logger";

const DEFAULT_FORWARD_TIMEOUT_MS = 45_000;

/** Apps Script Web Apps return 302 to /macros/echo after doPost. That is success. */
export function isSuccessfulAppsScriptForward(status: number): boolean {
  return (status >= 200 && status < 300) || status === 302 || status === 303;
}

function cleanSecret(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = value.trim();
  return text || null;
}

function fromAuthorizationHeader(value: string | null): string | null {
  const text = cleanSecret(value);
  if (!text) return null;
  return cleanSecret(text.replace(/^(Bearer|Token)\s+/i, ""));
}

export function extractShiprocketWebhookSecret(request: {
  headers: { get(name: string): string | null };
  nextUrl?: { searchParams: URLSearchParams };
  url?: string;
}): string | null {
  const header =
    cleanSecret(request.headers.get("x-api-key")) ??
    fromAuthorizationHeader(request.headers.get("authorization")) ??
    cleanSecret(request.headers.get("x-webhook-secret")) ??
    cleanSecret(request.headers.get("x-webhook-key"));
  if (header) return header;

  const params =
    request.nextUrl?.searchParams ??
    (request.url ? new URL(request.url).searchParams : null);
  if (!params) return null;
  return (
    cleanSecret(params.get("hook_key")) ||
    cleanSecret(params.get("token")) ||
    cleanSecret(params.get("secret")) ||
    null
  );
}

export async function forwardRawWebhookToAppsScript(options: {
  url: string;
  rawBody: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; status?: number; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_FORWARD_TIMEOUT_MS
  );

  try {
    const response = await fetch(options.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: options.rawBody,
      redirect: "manual",
      signal: controller.signal,
    });

    if (!isSuccessfulAppsScriptForward(response.status)) {
      logger.error("Apps Script webhook forward failed", {
        status: response.status,
      });
      return { ok: false, status: response.status, error: `status_${response.status}` };
    }

    logger.info("Apps Script webhook forward succeeded", {
      status: response.status,
    });
    return { ok: true, status: response.status };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error("Apps Script webhook forward error", { error });
    return { ok: false, error };
  } finally {
    clearTimeout(timeout);
  }
}
