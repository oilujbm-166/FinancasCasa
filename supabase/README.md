# Supabase — Edge Functions do FinançasCasa

Este diretório contém o código das Edge Functions que rodam no Supabase
(Deno runtime). O cliente PWA chama essas funções para operações que
precisam de privilégios (service role) ou que não devem rodar diretamente
no browser.

## Funções

### `generate-invite/`
Gera um código de convite email-bound. Requer JWT do usuário autenticado.
Usado pelo botão "Gerar convite" na tela de Configurações.

### `redeem-invite/`
Público. Aceita `{ email, code, password }` e cria a conta se o convite
for válido. Rate limit: 5 tentativas por hash(IP) por hora.

## Deploy

### Opção A — via Supabase CLI (local, recomendado quando for iterar muito)

```bash
# 1. Instale o CLI: brew install supabase/tap/supabase
# 2. Faça login: supabase login
# 3. Linke ao projeto:
supabase link --project-ref nlgqdvekpaxlmywowxnr
# 4. Deploy:
supabase functions deploy generate-invite
supabase functions deploy redeem-invite
```

### Opção B — via Dashboard (browser)

1. Abra https://supabase.com/dashboard/project/nlgqdvekpaxlmywowxnr/functions
2. **Create a new function** → nome `generate-invite` → cole o conteúdo de
   `supabase/functions/generate-invite/index.ts` → Deploy.
3. Repita para `redeem-invite`.

## Variáveis de ambiente

O Supabase já fornece automaticamente em toda Edge Function:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### Variável opcional

- `IP_HASH_SECRET` — pepper para o hash de IPs do rate limit da
  `redeem-invite`. Se não configurada, usa um fallback constante (que ainda
  protege contra leitura casual mas não contra quem tenha acesso ao código
  da função). Configure em **Project Settings → Edge Functions → Secrets**.

  Exemplo de geração:
  ```bash
  openssl rand -hex 32
  ```

## Testando localmente (opcional)

Com o Supabase CLI instalado:
```bash
supabase functions serve generate-invite --no-verify-jwt
# em outro terminal:
curl -X POST http://localhost:54321/functions/v1/generate-invite \
  -H "Authorization: Bearer <user JWT>" \
  -H "Content-Type: application/json" \
  -d '{"email":"amigo@example.com","durationHours":24}'
```

## Schema (Fase 1.1)

Criado via DDL direto no SQL Editor — ver o plano em
`~/.claude/plans/declarative-chasing-globe.md` Fase 1.1 para os statements.
As tabelas necessárias são:

- `public.invites` (code, email, created_by, expires_at, used_by, used_at)
- `public.signup_attempts` (ip_hash, attempted_at, success)
- `public.cleanup_old_signup_attempts()` função de limpeza
