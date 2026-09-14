
/**
 * Thin HTTP client for the Flutterwave v3 API.
 * Server-side only. Never import from a client component.
 */

export class FlutterwaveApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "FlutterwaveApiError";
  }
}

const FLW_BASE_URL = () =>
  process.env.FLW_BASE_URL?.trim().replace(/\/$/, "") || "https://api.flutterwave.com/v3";

function secretKey(): string {
  const key = process.env.FLW_SECRET_KEY_TEST;
  if (!key || key.includes("change-me")) {
    throw new FlutterwaveApiError(
      "Flutterwave test secret key is not configured. Set FLW_SECRET_KEY_TEST.",
      500,
    );
  }
  return key;
}

interface FlutterwaveResponse<T> {
  status: "success" | "error";
  message: string;
  data: T;
}

async function rawRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<FlutterwaveResponse<T>> {
  const res = await fetch(`${FLW_BASE_URL()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  let parsed: FlutterwaveResponse<T> | null = null;
  try {
    parsed = (await res.json()) as FlutterwaveResponse<T>;
  } catch {
    parsed = null;
  }

  if (!res.ok || parsed?.status !== "success") {
    throw new FlutterwaveApiError(
      parsed?.message || `Flutterwave request failed with status ${res.status}`,
      res.status,
      parsed ?? null,
    );
  }

  return parsed;
}

export async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await rawRequest<T>("POST", path, body);
  return res.data;
}

export async function get<T>(path: string): Promise<T> {
  const res = await rawRequest<T>("GET", path);
  return res.data;
}