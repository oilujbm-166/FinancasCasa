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

## JWT assimétrico (ES256) e `verify_jwt`

O projeto usa **ECDSA (ES256)** pra assinar tokens de usuário. O gateway das Edge Functions
só valida HS256 automaticamente — tokens ES256 batem em `UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM`.

Por isso [supabase/config.toml](config.toml) marca `verify_jwt = false` pras duas funções:
- `generate-invite` faz validação interna via `admin.auth.getUser(jwt)` (aceita qualquer algoritmo).
- `redeem-invite` é público por desenho (user novo ainda não tem sessão) e valida o código/email contra a tabela.

**Se o deploy vier sem essa config**, o gateway volta a rejeitar ES256 e o botão "Gerar convite"
mostra `UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM`. O fix manual é
`supabase functions deploy generate-invite --no-verify-jwt` — mas o config.toml já garante isso.

## Verificar se as funções estão deployadas

Antes de debugar o app, confirme o estado das Edge Functions:

**Via Dashboard**: abrir https://supabase.com/dashboard/project/nlgqdvekpaxlmywowxnr/functions.
`generate-invite` e `redeem-invite` devem aparecer como "Active". Se a lista
estiver vazia ou só uma aparece, a outra nunca foi deployada — use a Opção A ou B abaixo.

**Via CLI**: `supabase functions list --project-ref nlgqdvekpaxlmywowxnr`.

**Sintoma no app**: mensagens "A função de convites não está deployada" ou
"Não foi possível conectar ao servidor de convites" em Configurações > Convites
quase sempre indicam função ausente do projeto Supabase.

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

## Schema — Envelope Encryption (Fase B)

Adiciona colunas para o fluxo de envelope encryption (wrapped MasterKey + blob
criptografado). Rodar no SQL Editor do projeto `nlgqdvekpaxlmywowxnr`:

```sql
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS wrapped_master_key text,
  ADD COLUMN IF NOT EXISTS master_key_iv text,
  ADD COLUMN IF NOT EXISTS master_key_salt text,
  ADD COLUMN IF NOT EXISTS encrypted_api_key_v2 text,
  ADD COLUMN IF NOT EXISTS api_key_iv_v2 text;

ALTER TABLE public.user_data
  ADD COLUMN IF NOT EXISTS encrypted_data text,
  ADD COLUMN IF NOT EXISTS data_iv text,
  ADD COLUMN IF NOT EXISTS data_version integer DEFAULT 1;
```

Validação:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='user_settings'
  AND column_name IN ('wrapped_master_key','master_key_iv','master_key_salt',
                      'encrypted_api_key_v2','api_key_iv_v2');
-- 5 linhas

SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='user_data'
  AND column_name IN ('encrypted_data','data_iv','data_version');
-- 3 linhas
```

As colunas v1 (`data`, `encrypted_api_key`, `api_key_iv`, `api_key_salt`) ficam
coexistindo até a Fase J, quando são dropadas após confirmar que todos os 4
usuários migraram.

### Hotfix pós-deploy — permitir `data` NULL

O schema original tinha `user_data.data jsonb NOT NULL DEFAULT '{}'`. O código de
migração, signup, save e reset de senha tenta gravar `data = NULL` após mover o
blob pra `encrypted_data`. Isso falhava silenciosamente pela violação de
`NOT NULL` (a Supabase JS retornava `{ error }`, que nosso código só logava).

Correção aplicada:

```sql
ALTER TABLE public.user_data ALTER COLUMN data DROP NOT NULL;
```

Após isso, os 4 caminhos que gravam `data: null` passam a funcionar normalmente.
Usuários que já estavam com migração parcial (wrapped_master_key setado mas
data ainda plaintext) convergem no próximo save após qualquer mudança no app.
