// ============================================================================
// Edge Function: generate-invite (Fase 1.1)
// ============================================================================
// Gera um código de convite email-bound. Requer JWT do usuário autenticado —
// o dono (quem chama) vira created_by do invite.
//
// POST /functions/v1/generate-invite
//   headers:  Authorization: Bearer <user JWT>
//             Content-Type: application/json
//   body:     { email: string, durationHours?: number (1..168, default 24) }
//   resp:     201 { code, expires_at }
//             400 invalid email
//             401 unauthenticated / invalid token
//             500 could not generate unique code
//
// Vars de ambiente (já providas pelo Supabase no deploy):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Alfabeto sem caracteres ambíguos (0/O, 1/l/I) — facilita digitação manual do código
const ALPHABET =
  "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";

function nanoid(len = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
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

  // Autentica via JWT
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { error: "unauthenticated" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData.user) return json(401, { error: "invalid token" });
  const currentUser = userData.user;

  let body: { email?: string; durationHours?: number } = {};
  try {
    body = await req.json();
  } catch {
    // body vazio ou malformado — cai na validação abaixo
  }

  const email = (body.email || "").trim().toLowerCase();
  const durationHours = Math.min(
    168,
    Math.max(1, Math.round(body.durationHours ?? 24)),
  );

  if (!isValidEmail(email)) return json(400, { error: "invalid email" });

  // Gera código e insere. Colisão de nanoid(10) é improvável, mas se der retry.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = nanoid(10);
    const expiresAt = new Date(
      Date.now() + durationHours * 3_600_000,
    ).toISOString();

    const { data, error } = await admin
      .from("invites")
      .insert({
        code,
        email,
        created_by: currentUser.id,
        expires_at: expiresAt,
      })
      .select("code, expires_at")
      .single();

    if (!error) {
      return json(201, { code: data.code, expires_at: data.expires_at });
    }
    // 23505 = unique_violation (colisão de code). Tenta outro.
    if (error.code !== "23505") {
      return json(500, { error: "insert failed", detail: error.message });
    }
  }

  return json(500, { error: "could not generate unique code" });
});
