# FinançasCasa — guia de uso

App de finanças pessoais para casais que compartilham as contas. Roda no navegador e instala como app no celular. Os dados ficam na nuvem criptografada, com sincronização automática entre os dispositivos.

---

## O que o app faz

- Painel único com receitas, despesas, orçamento por categoria, metas, investimentos e projeções de 12 meses.
- IA integrada para responder perguntas sobre os números ("onde estamos gastando mais?", "quanto dá para investir?").
- Importação automática de extratos bancários, faturas de cartão e contracheques — cola o texto, a IA classifica.
- Funciona offline. Os dados ficam no celular e sincronizam quando voltar a internet.

---

## Setup em 10 minutos

### 1. Criar a conta

1. Acesse: **https://oilujbm-166.github.io/FinancasCasa/**
2. Clique em **Criar Conta**.
3. Informe:
   - **E-mail** (vai ser o login compartilhado pelos dois)
   - **Senha com no mínimo 12 caracteres**
4. Confirme o e-mail (verifique o spam se não chegar).
5. Entre no app.

> Os dois usam o **mesmo login**. Guardem as credenciais num gerenciador de senhas ou local seguro. Se um trocar a senha, avise o outro.

### 2. Ativar a IA (grátis)

A IA do app é o Google Gemini. Cada usuário precisa de uma chave própria, gratuita e sem cartão de crédito.

1. Acesse: **https://aistudio.google.com/app/apikey**
2. Entre com uma conta Google.
3. Clique em **Create API key**.
4. Aceite criar um projeto Google Cloud (é automático).
5. Copie a chave (começa com `AIza`).
6. No app: **Configurações** → campo **Chave API Google Gemini** → colar → **Salvar Chave**.
7. A confirmação "Conexão testada com sucesso" deve aparecer em verde.

> Tier gratuito: 1.500 requisições/dia e 1 milhão de tokens/dia. Suficiente para uso diário sem custo.

### 3. Instalar no celular

O app é uma PWA — instala na tela inicial, sem loja.

**iPhone (Safari):** ícone de compartilhar → **Adicionar à Tela de Início**.

**Android (Chrome):** banner **Instalar app** que aparece na parte inferior, ou menu ⋮ → **Instalar app**.

### 4. Personalizar (opcional)

Em **Configurações → Perfil**, coloquem o nome do casal. A IA usa esse nome nas respostas.

---

## Começando

Roteiro sugerido para os primeiros dias:

**Importar o extrato do mês**
- Aba **Importar** → cole o texto do extrato → **Analisar com IA**.
- Revise a classificação e clique em **Salvar Todas**.

**Importar a fatura do cartão**
- Mesma aba. A IA detecta que é fatura, agrupa as compras sob uma transação-pai.

**Definir orçamento**
- Aba **Orçamento** → coloque limites nas categorias principais (Alimentação, Moradia, Transporte, Lazer).

**Criar uma meta**
- Aba **Metas** → algo concreto como "Reserva de emergência — R$ 30.000" ou "Viagem — R$ 8.000".

**Consultar a IA**
- Aba **Consultor IA**. Perguntas específicas funcionam melhor: "quanto gastamos com Alimentação em março?" traz resposta mais útil que "como estamos?".

---

## Conta compartilhada

Os dois usam o mesmo login, então os dados são sempre os mesmos em todos os dispositivos. Pontos de atenção:

- **Edição simultânea**: se os dois editarem ao mesmo tempo, o último a salvar sobrescreve. Combinem quem importa cada coisa.
- **Offline**: o app funciona sem internet e sincroniza depois. Se os dois editarem em paralelo sem conexão, pode haver conflito. Em dúvida, faça backup antes.

---

## Backup

Os dados ficam na nuvem criptografada, mas um backup local semanal é recomendado.

1. **Configurações → Backup e Restauração → Fazer Backup**.
2. Um arquivo `.json` é baixado. Guardem no Drive, iCloud ou e-mail.
3. Para restaurar: mesma tela → **Restaurar Backup**.

Façam backup pelo menos uma vez por semana, e sempre antes de importações grandes.

---

## Privacidade

- Cada usuário tem uma caixa de dados isolada. Os dados de vocês não são acessíveis a mim nem a nenhum outro usuário.
- A chave da IA é criptografada (AES-GCM) no celular antes de ser armazenada. Só quem tem a senha do login consegue decifrar. Se esquecerem a senha, a chave se perde — basta gerar outra no AI Studio (gratuito).
- As conversas com a IA vão direto do celular para os servidores do Google, usando a chave de vocês. Não passam por nenhum servidor intermediário.
- Código-fonte público: **https://github.com/oilujbm-166/FinancasCasa**.

---

## Dicas de uso

- Importem o mês inteiro de uma vez, não lançamento por lançamento. A IA acerta a maior parte das categorias.
- Em **Configurações → Categorias**, criem categorias próprias (ex.: Pet, Academia, Presente).
- A aba **Projeções** mostra onde o ritmo atual leva em 12 meses — útil para decisões de médio prazo.
- Se o app não atualizar depois de uma versão nova: hard refresh (puxar a tela pra baixo com força, ou `Ctrl+Shift+R` no computador).

---

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Não consegui logar | Confirme o e-mail. Se mesmo assim não funcionar, use o link de recuperação de senha. |
| IA não responde | Confira a chave em Configurações. Se expirou, gere outra em aistudio.google.com/app/apikey. |
| Importei algo errado | Cada transação tem um botão para remover. Ou restaure um backup anterior. |
| Perdi um lançamento | Configurações → Restaurar Backup. |

---

## Contato

Dúvidas, sugestões ou bugs: me avisem.

---

### Versão curta para WhatsApp

> FinançasCasa — app de finanças pessoais para casais.
>
> **1) Criar conta**: https://oilujbm-166.github.io/FinancasCasa/ → Criar Conta → senha com 12+ caracteres → confirmar e-mail.
>
> **2) Ativar IA grátis**: https://aistudio.google.com/app/apikey → Create API key → colar a chave (começa com AIza) em Configurações → Chave API Gemini → Salvar.
>
> **3) Instalar no celular**: abrir no Safari (iPhone) ou Chrome (Android) → Adicionar à tela inicial.
>
> **4) Importar extrato**: aba Importar → colar texto → IA classifica.
>
> Guia completo em anexo.
