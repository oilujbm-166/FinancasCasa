// ============================================================================
// Edge Function: redeem-invite (Fase 1.1)
// ============================================================================
// Público (sem JWT). Aceita { email, code, password } e cria a conta se o
// invite for válido. Rate limit: 5 tentativas por hash(IP) na última hora.
//
// POST /functions/v1/redeem-invite
//   body: { email: string, code: string, password: string (>=12) }
//   resp: 201 { user: {id,email}, session }   sucesso (já logado)
//         400 invalid input
//         403 code does not match email
//         404 invalid code
//         410 code expired / already used
//         429 too many attempts
//         500 failed to create user
//
// Vars de ambiente:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
//   IP_HASH_SECRET (opcional — pepper pra hash de IP; se ausente, usa fallback
//     constante que ainda protege contra leitura casual mas não contra quem
//     tiver acesso ao código da função)
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const IP_HASH_SECRET =
  Deno.env.get("IP_HASH_SECRET") ?? "financascasa-fallback-pepper";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function hashIP(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip + "|" + IP_HASH_SECRET);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getClientIP(req: Request): string {
  const xf = req.headers.get("x-forwarded-for") || "";
  return (
    xf.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function isValidEmail(e: string): boolean {
  return (
    typeof e === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) &&
    e.length <= 254
  );
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // -------- Rate limit --------
  const ip = getClientIP(req);
  const ipHash = await hashIP(ip);
  const oneHourAgoIso = new Date(Date.now() - 3_600_000).toISOString();

  const { count: attemptsLastHour } = await admin
    .from("signup_attempts")
    .select("*", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("attempted_at", oneHourAgoIso);

  if ((attemptsLastHour ?? 0) >= 5) {
    return json(429, { error: "too many attempts, try again later" });
  }

  // Registra tentativa (vai ser promovida a success=true se der certo)
  const { data: insertedAttempt } = await admin
    .from("signup_attempts")
    .insert({ ip_hash: ipHash, success: false })
    .select("id")
    .single();

  // -------- Parse + validação do input --------
  let body: { email?: string; code?: string; password?: string } = {};
  try {
    body = await req.json();
  } catch {
    // cai na validação abaixo
  }
  const email = (body.email || "").trim().toLowerCase();
  const code = (body.code || "").trim();
  const password = body.password || "";

  if (!isValidEmail(email) || !code || password.length < 12) {
    return json(400, { error: "invalid input" });
  }

  // -------- Busca + validação do invite --------
  const { data: invite, error: inviteErr } = await admin
    .from("invites")
    .select("code, email, expires_at, used_at")
    .eq("code", code)
    .maybeSingle();

  if (inviteErr || !invite) return json(404, { error: "invalid code" });
  if (invite.used_at) return json(410, { error: "code already used" });
  if (new Date(invite.expires_at) < new Date())
    return json(410, { error: "code expired" });
  if (invite.email.toLowerCase() !== email)
    return json(403, { error: "code does not match email" });

  // -------- Cria usuário --------
  const { data: created, error: createErr } = await admin.auth.admin.createUser(
    {
      email,
      password,
      email_confirm: true, // sem double opt-in: convite via email já é autenticação
    },
  );
  if (createErr || !created.user) {
    return json(500, {
      error: "failed to create user",
      detail: createErr?.message,
    });
  }

  // Marca invite como usado (idempotente — se alguém tentar redeem em paralelo, um dos updates
  // não muda nada, o outro é o efetivo; o check used_at acima já protege contra double-redeem)
  await admin
    .from("invites")
    .update({ used_by: created.user.id, used_at: new Date().toISOString() })
    .eq("code", code);

  // Promove tentativa a success=true (informativo — não afeta contagem futura)
  if (insertedAttempt?.id) {
    await admin
      .from("signup_attempts")
      .update({ success: true })
      .eq("id", insertedAttempt.id);
  }

  // Faz login com a senha nova via anon key pra retornar uma sessão "normal"
  // (access_token + refresh_token). Sem isso, o cliente teria só o user e
  // precisaria fazer um signInWithPassword manual logo depois.
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signInData } = await anon.auth.signInWithPassword({
    email,
    password,
  });

  return json(201, {
    user: { id: created.user.id, email: created.user.email },
    session: signInData?.session ?? null,
  });
});
