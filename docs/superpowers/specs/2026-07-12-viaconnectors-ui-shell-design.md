# ViaConnectors — UI Shell (primeira entrega)

Escopo: interface completa (landing, login, dashboard, página de detalhe),
dados mockados via API route, com OAuth GitHub real. Backend de
discovery/install/connectors fica para entregas futuras.

## Stack

- Next.js (App Router, TypeScript), CSS puro (sem Tailwind/UI kit)
- Auth.js (`next-auth`) com provider GitHub
- Fontes importadas: Inter (UI), Instrument Serif itálico (destaque
  editorial em títulos), via Google Fonts
- Ícones: SVG inline próprios, estilo outline consistente (peso de traço
  uniforme, grid 24x24) — candidato a virar `lucide-react` na próxima
  entrega se o catálogo crescer
- Idioma: inglês, sem toggle de i18n

## Páginas

1. **Landing** — hero + CTA de login
2. **Login** — botão "Continue with GitHub" (OAuth real via next-auth)
3. **Dashboard** — lista de conectores:
   - Abas: Plugins / MCPs / Skills
   - Busca por nome + painel de filtros avançados (nome, autor)
   - Card do conector: ícone temático por categoria (chip colorido),
     nome, link GitHub (abre repo em nova aba, separado do botão
     Instalar), autor/owner, descrição, estrelas (contagem, sem selo de
     "trusted" visível — o score de confiabilidade existe nos dados mas
     não é badge de UI), botão Instalar/Instalado
   - Toggle de tema claro/escuro
   - Rodapé com botão de Configurações
4. **Detalhe do conector** — descrição completa, informações do
   projeto, nível de confiabilidade, botão Instalar

## Dados mock

Rota `/api/connectors` (Next.js Route Handler) retornando array fixo no
formato final: `{ id, name, category: 'plugin'|'mcp'|'skill', owner,
description, githubUrl, stars, trustScore, installed }`. Fácil de trocar
por dados reais do GitHub depois.

## Animações

Scroll-reveal: elementos entram com fade + slide sutil ao entrarem no
viewport (IntersectionObserver), sem lib externa.

## Fora de escopo nesta entrega

- Discovery real via API do GitHub
- Instalação automática (orquestração de download/config)
- Interface de configurações (só o botão existe, sem painel funcional)
- Página/fluxo de segurança detalhado
