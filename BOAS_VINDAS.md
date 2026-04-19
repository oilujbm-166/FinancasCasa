# Bem-vindos ao FinançasCasa 🎉

> Um app de finanças pessoais feito para casais que organizam as contas juntos. Simples, privado e com uma IA que entende o dia a dia financeiro brasileiro.

---

## O que vocês vão ter nas mãos

- **Um painel único** com receitas, despesas, orçamento por categoria, metas, investimentos e projeções.
- **IA integrada** para responder perguntas como "como está nossa saúde financeira?", "onde gastamos demais?", "quanto dá para investir por mês?".
- **Importação inteligente**: cola o texto do extrato, da fatura de cartão ou do contracheque — a IA identifica e categoriza tudo.
- **Funciona offline**: instala no celular como app, os dados ficam no aparelho e sincronizam para a nuvem quando tem internet.
- **Privado por padrão**: os dados de vocês só vocês acessam. Criptografia de ponta a ponta na chave da IA.

---

## Setup em 10 minutos

### Passo 1 — Criar a conta (3 min)

1. Acesse: **https://oilujbm-166.github.io/FinancasCasa/**
2. Clique em **"Criar Conta"**.
3. Coloque:
   - **E-mail** (pode ser o do casal ou de um dos dois — o importante é que os dois vão usar esse login)
   - **Senha com no mínimo 12 caracteres**. Sugestão: frase longa e memorável, ex.: `nossacasaem2026!`
4. Confirme o e-mail que chegou na caixa de entrada (pode ir para spam).
5. Faça login no app.

> **Importante — vocês vão compartilhar um único login.** Combinados os dados (e-mail + senha), guardem num gerenciador de senhas ou num lugar seguro que os dois acessem. Se um trocar a senha, avise o outro.

### Passo 2 — Ativar a IA (grátis, 5 min)

A IA que responde as perguntas e classifica os extratos é o **Google Gemini**. Vocês precisam de uma chave própria, **100% gratuita**, sem cartão de crédito.

1. Acesse: **https://aistudio.google.com/app/apikey**
2. Entre com uma conta Google qualquer (a mesma do Gmail serve).
3. Clique em **"Create API key"**.
4. Se pedir, aceite criar um projeto Google Cloud (é automático).
5. **Copie a chave** que aparece (começa com `AIza...`).
6. De volta ao app, vá em **Configurações** (ícone ⚙ no menu) → colar a chave no campo **"Chave API Google Gemini"** → **Salvar Chave**.
7. Deve aparecer "Conexão testada com sucesso!" em verde.

> **Tier gratuito do Gemini**: 1.500 requisições/dia e 1 milhão de tokens/dia. Na prática, dá para classificar dezenas de extratos e conversar bastante com a IA sem nunca pagar nada.

### Passo 3 — Instalar no celular como app (2 min)

O FinançasCasa é uma **PWA** (app progressivo). Instala na tela inicial como qualquer app, mas sem precisar de loja.

**No iPhone (Safari):**
1. Abra o app no Safari (tem que ser Safari, não Chrome).
2. Toque no ícone de compartilhar (quadrado com seta pra cima).
3. Role e toque em **"Adicionar à Tela de Início"**.
4. Confirme. O ícone aparece na tela igual aos outros apps.

**No Android (Chrome):**
1. Abra o app no Chrome.
2. Vai aparecer um banner **"Instalar app"** na parte de baixo — toque.
3. Ou: menu ⋮ (três pontinhos) → **"Instalar app"** / **"Adicionar à tela inicial"**.

Depois de instalado, abre direto sem passar pelo navegador, e funciona mesmo offline.

### Passo 4 — Personalizar (opcional, 1 min)

Em **Configurações → Perfil**, coloquem o nome do casal (ex.: `Ana e Pedro`). A IA vai usar esse nome para personalizar as respostas.

---

## A primeira semana — como usar

Sugestão de roteiro para tirar o melhor do app nos primeiros dias:

**Dia 1 — Importar o extrato do mês atual**
- Vá em **Importar** no menu.
- Abra o app do banco de vocês, vá no extrato do mês, copie tudo (ou salve em PDF e arraste).
- Cole no campo do FinançasCasa e clique **"Analisar com IA"**.
- Revise a categorização (pode editar qualquer categoria antes de salvar).
- **Salvar Todas**.

**Dia 2 — Importar a fatura do cartão**
- Mesma aba Importar, mas cola o texto da fatura. A IA detecta que é cartão de crédito e agrupa tudo sob uma transação-pai de "Fatura Cartão".

**Dia 3 — Definir orçamento**
- Vá em **Orçamento** e coloque um limite mensal para as categorias principais (Alimentação, Transporte, Moradia, Lazer).
- O app vai te avisar quando estiver se aproximando do limite.

**Dia 4 — Criar uma meta**
- Em **Metas**, crie algo concreto: "Reserva de emergência — R$ 30.000" ou "Viagem fim de ano — R$ 8.000".
- Atualize o valor guardado conforme for poupando.

**Dia 5 em diante — conversa com a IA**
- Abra **Consultor IA** e pergunte coisas como:
  - "Como está nossa saúde financeira este mês?"
  - "Onde estamos gastando mais que deveríamos?"
  - "Quanto conseguimos investir por mês no ritmo atual?"
  - "Quando atingimos a reserva de emergência?"

---

## Conta compartilhada — o que saber ⚠️

Como os dois usam o **mesmo login**, os dados são sempre os mesmos nos dois celulares. Isso é ótimo, mas tem uma consideração:

- **Se os dois editarem ao mesmo tempo**, o último a salvar "ganha" (sobrescreve). Na prática isso raramente é um problema — são edições rápidas, e sincronizam em meio segundo. Mas evitem, por exemplo, importar dois extratos simultaneamente em celulares diferentes. **Combinem: um importa de cada vez.**
- **Se um de vocês está sem internet**, o app continua funcionando localmente. Quando voltar online, sincroniza. Mas se o outro também editou nesse meio tempo... pode dar conflito. Regra de ouro: em dúvida, faça backup antes (veja abaixo).

---

## Backup manual — faça toda semana 💾

Os dados ficam na nuvem criptografada, mas é sempre bom ter um backup local.

1. **Configurações → Backup e Restauração → Fazer Backup**.
2. Um arquivo `.json` é baixado. Guardem no Google Drive, iCloud ou e-mail.
3. Se algum dia precisar restaurar: mesma tela → **Restaurar Backup** → selecionar o arquivo.

Façam backup pelo menos **1× por semana**, principalmente antes de importações grandes.

---

## Privacidade e segurança 🔒

- **Os dados de vocês são só de vocês.** Cada usuário tem uma caixa isolada — ninguém, nem mesmo eu (Júlio), vê o que vocês lançam no app.
- **A chave da IA que vocês colaram é criptografada** (AES-GCM) antes de sair do celular. Só vocês, com a senha do login, conseguem decifrá-la. Se esquecerem a senha, a chave se perde também — aí é só gerar outra no AI Studio (de graça).
- **As conversas com a IA Gemini** vão direto do celular de vocês para os servidores do Google, usando a chave de vocês. Nunca passam por mim ou por nenhum outro servidor.
- **Fonte aberta**: o código do app é público (https://github.com/oilujbm-166/FinancasCasa). Se tiverem curiosidade técnica, dá para auditar.

---

## Dicas que fazem diferença

- **Importe logo o mês inteiro**, não transação por transação. A IA acerta ~95% das categorias e vocês só revisam o que ficou estranho.
- **Categorias personalizadas**: em Configurações → Categorias, crie categorias que façam sentido para vocês (ex.: "Pet", "Academia", "Presente"). O app já vem com as básicas.
- **Perguntas específicas funcionam melhor**: "quanto gastamos com Alimentação em março?" traz resposta mais útil que "como estamos?".
- **Projeções**: a aba **Projeções** mostra para onde o ritmo atual leva em 12 meses. Ótimo para discussões do tipo "se continuarmos assim, daqui a quanto a gente paga a casa / compra o carro / sai de férias".
- **Hard refresh** (puxar a tela pra baixo com força, ou Ctrl+Shift+R no computador) se alguma vez o app não atualizar após um update.

---

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| "Não consegui logar" | Confirme que validou o e-mail. Se sim, peça reset de senha na tela de login (se tiver) ou use o link de recuperação. |
| "IA não responde" | Confira a chave em Configurações. Se expirou ou foi apagada, gere outra em aistudio.google.com/app/apikey. |
| "Importei errado, como desfazer?" | Cada transação tem um botão ✕ para remover. Para apagar todas de uma importação, vá na aba Despesas/Receitas e remova uma a uma, ou restaure um backup anterior. |
| "Perdi um lançamento" | Se tiver backup recente: Configurações → Restaurar Backup. |

---

## Contato

Qualquer dúvida, sugestão ou bug encontrado: me avisem. Estou cuidando da manutenção do app e adoro feedback real de quem usa.

**Bom uso — que ajude a família de vocês a dormir mais tranquilos com o dinheiro.**

---

### Versão curta para copiar no WhatsApp

> Oi! 👋 Bem-vindos ao FinançasCasa, o app que eu criei para organizar as finanças da casa.
>
> **1) Criar conta**: https://oilujbm-166.github.io/FinancasCasa/ → "Criar Conta" → senha com 12+ caracteres → confirmar e-mail.
>
> **2) Ativar IA grátis**: https://aistudio.google.com/app/apikey → "Create API key" → colar a chave (começa com AIza) em Configurações → Chave API Gemini → Salvar.
>
> **3) Instalar no celular**: abra no Safari (iPhone) ou Chrome (Android) → "Adicionar à tela inicial".
>
> **4) Importar o primeiro extrato**: aba Importar → colar texto do extrato → IA analisa e categoriza.
>
> Guia completo + dicas: [link para este documento, se for publicar]
>
> Qualquer dúvida, me chama.
