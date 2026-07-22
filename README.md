# ViaConnectors

Gerenciador universal de integrações para Claude — descubra, instale, verifique
e desinstale MCPs, plugins e skills a partir de um único painel, tanto pelo
navegador quanto por um app desktop nativo pra Windows.

Sem catálogo fixo: tudo é buscado ao vivo no GitHub, com cache local pra manter
a navegação instantânea sem martelar a API.

## O que ele faz

### Descoberta ao vivo

- Busca contínua no GitHub por tópico, sem parar — enquanto a aba fica aberta,
  a lista de conectores só cresce.
- Pesquisa de texto instantânea: digitar acha qualquer coisa na hora, mesmo o
  que ainda não estava no cache.
- Rolagem infinita com paginação real, sem travar em limite de requisições —
  respeita o rate limit do GitHub com uma janela deslizante e espera pelo
  horário de reset informado pela própria API quando necessário.
- Classificação automática entre **MCP**, **Plugin** e **Skill** — não confia
  cegamente nos *topics* do GitHub (que autores preenchem de qualquer jeito):
  lê a descrição do repositório procurando frases como *"MCP server"*,
  *"a /nome skill"* ou *"Claude Code plugin"* antes de cair pro nome do repo
  como último critério.

### Instalação de verdade, não só um botão bonito

- **MCP**: antes de rodar qualquer coisa, o app lê o README do repositório
  procurando o comando real documentado pelo autor — uma linha `claude mcp add`
  pronta, um bloco JSON de configuração de cliente MCP, ou o link do pacote
  npm de verdade (importante em monorepos, onde o pacote raiz não é o
  executável). Só cai no chute de `npx -y <repo>` como último recurso — e se
  não achar nenhum sinal confiável, **recusa a instalar** em vez de gravar uma
  entrada quebrada na sua configuração.
- **Plugin/Skill**: lê o `marketplace.json` real do repositório pra montar o
  identificador `plugin@marketplace` corretamente — em vez de chutar que o
  nome do plugin e do marketplace são sempre iguais ao nome do repo (não são,
  na prática).
- **Escopo global de verdade**: instala com `--scope user`, disponível em
  qualquer projeto — não preso à pasta onde o processo aconteceu de rodar.
- **Claude Desktop também**: ao instalar um MCP, o app espelha a mesma
  configuração no `claude_desktop_config.json` do Claude Desktop (se estiver
  instalado na máquina), preservando qualquer servidor que já esteja lá.
- **Verificação pós-instalação**: depois de instalar, checa de verdade se o
  servidor MCP conecta ou se o plugin ficou registrado — o botão mostra
  "Installed ⚠" com o motivo, em vez de fingir sucesso quando o comando só
  rodou sem erro mas não funciona.
- **Repositórios que não são instaláveis** (ex: listas "awesome", coleções de
  múltiplos itens sem um único ponto de instalação) são detectados e
  recusados na hora, com uma mensagem clara, sem tentar nada.
- **Instaladores de terceiros** (`pip`, `uv tool install`, `brew`,
  `curl | bash`, `irm | iex`) são detectados no README e mostrados como um
  comando pra copiar — o app **nunca** executa scripts remotos por conta
  própria, nem com confirmação. Isso é intencional: baixar e rodar código não
  revisado de qualquer repositório é o padrão clássico de ataque de
  supply-chain, e nenhuma caixa de "tem certeza?" resolve esse problema de
  verdade.
- **Local de instalação**: automático (procura o Claude Code na máquina) ou
  manual, apontando pro executável certo via seletor de arquivo nativo do
  sistema.
- **Desinstalar**: botão dedicado que remove o plugin/skill ou o servidor MCP
  — dos dois lados, Claude Code e Claude Desktop.
- **Autodetecção ao abrir**: o app lê a configuração real do Claude Code
  (`.claude.json`, `known_marketplaces.json`, `installed_plugins.json`) assim
  que carrega, pra marcar como "Installed" tudo que você já tem — mesmo o que
  nunca foi instalado por aqui.

### Login e conta

- OAuth real do GitHub (Auth.js) pra elevar o rate limit de busca.
- Token pessoal do GitHub opcional em Configurações, pra descoberta em
  segundo plano mais rápida.

### App desktop

Empacotado com Electron num `.exe` portátil pra Windows — não precisa de
Node.js instalado separadamente (usa o próprio binário do Electron rodando
como processo Node puro pra servir o Next.js). Ícone próprio, detecção de
porta ocupada, log de diagnóstico em arquivo (útil porque um app com atalho
não tem console pra imprimir nada).

## Rodando localmente

```bash
npm install
cp .env.example .env.local   # preencha GITHUB_ID/SECRET e NEXTAUTH_SECRET
npm run dev
```

Abra http://localhost:3000.

Para o login com GitHub funcionar, crie um OAuth App em
https://github.com/settings/developers com callback
`http://localhost:3000/api/auth/callback/github` e preencha `.env.local`.
`GITHUB_TOKEN` (opcional) eleva o rate limit da busca de conectores.

A instalação real de MCPs/plugins/skills exige o CLI `claude` (Claude Code)
instalado e no PATH da máquina que roda o servidor Next.js.

## Gerando o app desktop (Windows)

```bash
npm run dist:win
```

Empacota um `.exe` portátil em `dist-electron/`. **Atenção**: esse build
carrega o seu `.env.local` (credenciais reais) pra dentro do executável, pra
o login funcionar sem configurar de novo — não distribua esse `.exe`
específico pra outras pessoas. `dist-electron/` está no `.gitignore` por
esse exato motivo.

## Testes

```bash
npm test
```

## Arquitetura

- `app/` — páginas (App Router): landing, `login`, `dashboard`,
  `connector/[id]`, `settings`
- `app/api/connectors` — lista conectores (GitHub real, cai para mock se a
  API do GitHub falhar/estourar rate limit)
- `app/api/install` — instala um conector de verdade (MCP, plugin ou skill)
- `app/api/uninstall` — desinstala, dos dois lados (Claude Code + Desktop)
- `app/api/installed` — o que já está instalado na máquina, pra marcar os
  cards certos ao carregar
- `app/api/pick-claude-file` — abre o seletor de arquivo nativo do Windows
- `app/api/auth/[...nextauth]` — OAuth do GitHub via Auth.js
- `lib/github.ts` — busca e mapeia repositórios do GitHub para `Connector`
  (loop de descoberta em segundo plano, servidor)
- `lib/githubClient.ts` — a mesma busca, mas rodando no navegador (mais
  rápida, cache local, pesquisa instantânea)
- `lib/claudeCode.ts` — toda a lógica de instalação/desinstalação/verificação
  real via CLI do Claude Code, extração de comandos do README, espelhamento
  pro Claude Desktop
- `lib/registry.ts` — fonte única de conectores (GitHub + fallback mock)
- `lib/connectors.ts` — tipos e dados mock (fallback)
- `lib/platforms.ts` — plataformas-alvo suportadas (hoje: só Claude Code)
- `components/` — UI reutilizável (header, cards, abas/busca, tema, ícones,
  scroll-reveal, seletor de plataforma, botão de instalação/desinstalação)
- `electron/` — empacotamento do app desktop (processo principal, ícone,
  cópia de assets estáticos, hook de pós-empacotamento)

Ver `docs/superpowers/specs/2026-07-12-viaconnectors-ui-shell-design.md`
para o design da interface.

## Segurança

- Nenhuma credencial fica hardcoded no código — tudo vem de variáveis de
  ambiente (`.env.local`, nunca commitado).
- O app nunca executa scripts remotos de terceiros automaticamente, mesmo
  quando encontra o comando no README de um repositório — sempre mostra pra
  você copiar e rodar por conta própria.
