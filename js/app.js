import { watchAuth, loginWithGoogle, logout, ehSuperAdmin } from "./auth.js";
import { listenCollection, listenDoc } from "./db.js";
import { $, $$, toast, getTheme, toggleTheme, escapeHtml, formatDate, dataISOLocal } from "./utils.js";
import { TEAM, resolverTeamId, carregarTime, aplicarMarca, observarTime, usuarioEhDaEquipe } from "./tenant.js";
import { PLANOS, RECURSO_DA_ROTA, NOMES_RECURSOS, temRecurso, planoMinimo, planoVigente, diasRestantes } from "./planos.js";
import { CONTATO_WHATSAPP } from "./firebase-config.js";

import { renderDashboard } from "./views/dashboard.js";
import { renderRanking } from "./views/ranking.js";
import { renderEscalacaoIdeal } from "./views/escalacao-ideal.js";
import { renderHistorico } from "./views/historico.js";
import { renderJogosList, renderJogoDetail } from "./views/jogos.js";
import { renderAtletas, renderAdversarios, renderCampos, renderCadastrosHub } from "./views/cadastros.js";
import { renderAvaliacao } from "./views/avaliacao.js";
import { renderFinanceiro } from "./views/financeiro.js";
import { renderRelatoriosHub } from "./views/relatorios.js";
import { renderExtrato } from "./views/extrato.js";
import { renderPresenca } from "./views/presenca.js";
import { renderRetrospecto } from "./views/retrospecto.js";
import { renderPremiacoes } from "./views/premiacoes.js";
import { renderConfiguracoes } from "./views/configuracoes.js";
import { renderAdmin } from "./views/admin.js";
import { renderLanding } from "./views/landing.js";

// ============================================================================
// Estado
// ============================================================================

const state = {
  adversarios: [], campos: [], atletas: [], jogos: [], financeiro: [], configFinanceiro: null,
  loaded: { adversarios: false, campos: false, atletas: false, jogos: false, financeiro: false, configFinanceiro: false },
  isAuthorized: false,   // logado E da equipe do time aberto (ou dono da plataforma)
  usuario: null,
  ehSuper: false,
};

// "time"    = há um time aberto e ele existe
// "inicio"  = nenhum time (tela inicial / painel do dono)
let modo = "inicio";
let avisoInicio = "";
let authPronto = false;   // já sabemos quem é o usuário (evita piscar "acesso restrito")

const allLoaded = () => Object.values(state.loaded).every(Boolean);

// ============================================================================
// Rotas
// ============================================================================

const ROUTES = {
  dashboard: renderDashboard,
  ranking: renderRanking,
  "escalacao-ideal": renderEscalacaoIdeal,
  historico: renderHistorico,
  atletas: renderAtletas,
  adversarios: renderAdversarios,
  campos: renderCampos,
  avaliacao: renderAvaliacao,
  cadastros: renderCadastrosHub,
  financeiro: renderFinanceiro,
  relatorios: renderRelatoriosHub,
  retrospecto: renderRetrospecto,
  premiacoes: renderPremiacoes,
  configuracoes: renderConfiguracoes,
};

const PROTECTED_ROUTES = new Set(["jogos", "atletas", "adversarios", "campos", "avaliacao", "cadastros", "financeiro", "configuracoes"]);

// ----------------------------------------------------------------------------
// Cache local (localStorage), uma chave por time — mostra a última versão
// conhecida dos dados na hora e atualiza em segundo plano.
// ----------------------------------------------------------------------------
const cacheKey = () => `app_cache_v1_${TEAM.id}`;

function loadCache(){
  try{
    const raw = localStorage.getItem(cacheKey());
    if (!raw) return null;
    const cached = JSON.parse(raw);
    return cached && typeof cached === "object" ? cached : null;
  }catch(err){ return null; }
}

function saveCache(){
  try{
    localStorage.setItem(cacheKey(), JSON.stringify({
      adversarios: state.adversarios, campos: state.campos, atletas: state.atletas, jogos: state.jogos,
      financeiro: state.financeiro, configFinanceiro: state.configFinanceiro,
    }));
  }catch(err){ /* cheio/indisponível — só perde a otimização */ }
}

function onDataChange(){
  if (allLoaded()) saveCache();
  render();
}

function startListeners(){
  listenCollection("adversarios", "nome", (items) => { state.adversarios = items; state.loaded.adversarios = true; onDataChange(); });
  listenCollection("campos", "nome", (items) => { state.campos = items; state.loaded.campos = true; onDataChange(); });
  listenCollection("atletas", "nome", (items) => { state.atletas = items; state.loaded.atletas = true; onDataChange(); });
  listenCollection("jogos", "data", (items) => { state.jogos = items; state.loaded.jogos = true; onDataChange(); });
  listenCollection("financeiro", "data", (items) => { state.financeiro = items; state.loaded.financeiro = true; onDataChange(); });
  listenDoc("configuracoes", "geral", (item) => { state.configFinanceiro = item; state.loaded.configFinanceiro = true; onDataChange(); });
}

function aplicarCache(){
  const cached = loadCache();
  if (!cached) return;
  state.adversarios = cached.adversarios || [];
  state.campos = cached.campos || [];
  state.atletas = cached.atletas || [];
  state.jogos = cached.jogos || [];
  state.financeiro = cached.financeiro || [];
  state.configFinanceiro = cached.configFinanceiro || null;
  state.loaded = { adversarios: true, campos: true, atletas: true, jogos: true, financeiro: true, configFinanceiro: true };
}

// ============================================================================
// Telas auxiliares
// ============================================================================

const GOOGLE_SVG = `<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.87-3.04.87-2.34 0-4.32-1.58-5.03-3.7H.95v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.73A5.4 5.4 0 0 1 3.69 9c0-.6.1-1.19.28-1.73V4.94H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.06l3.02-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.94l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>`;

function renderRestricted(root){
  root.innerHTML = `
    <div class="card restricted-card">
      <img src="${TEAM.escudo}" alt="${TEAM.nomeHtml}">
      <h2>Acesso restrito</h2>
      <p>Essa área é só para quem cuida do time. Entre com uma conta Google autorizada para continuar.</p>
      <button id="btn-login-restricted" class="btn-google">${GOOGLE_SVG} Entrar com Google</button>
    </div>`;
  $("#btn-login-restricted", root)?.addEventListener("click", doLogin);
}

function renderRecursoNaoIncluso(root, recurso){
  const nome = NOMES_RECURSOS[recurso] || "Este recurso";
  const contato = CONTATO_WHATSAPP
    ? `<a class="btn btn-gold" href="https://wa.me/${CONTATO_WHATSAPP}?text=${encodeURIComponent(`Olá! Quero liberar "${nome}" no time ${TEAM.nome}.`)}" target="_blank" rel="noopener">Falar no WhatsApp</a>`
    : "";
  root.innerHTML = `
    <div class="card restricted-card">
      <img src="${TEAM.escudo}" alt="${TEAM.nomeHtml}">
      <h2>${escapeHtml(nome)}</h2>
      <p>Este recurso não está incluso no plano atual do time (<strong>${escapeHtml((PLANOS[TEAM.plano] || PLANOS.start).nome)}</strong>). Ele faz parte do plano <strong>${escapeHtml(planoMinimo(recurso))}</strong>.</p>
      ${contato}
      <div style="margin-top:12px;"><a class="btn btn-ghost btn-sm" href="#dashboard">Voltar ao início</a></div>
    </div>`;
}

const WHATS_RENOVAR = (assunto) => CONTATO_WHATSAPP
  ? ` <a href="https://wa.me/${CONTATO_WHATSAPP}?text=${encodeURIComponent(assunto)}" target="_blank" rel="noopener">Falar no WhatsApp</a>`
  : "";

// Time com plano vencido (e quem está vendo não é o dono): só consulta.
const somenteLeitura = () => modo === "time" && state.isAuthorized && !state.ehSuper && !planoVigente();

// Faixa no topo para a equipe: teste acabando, plano perto de vencer ou vencido.
function faixaDoPlano(){
  if (!state.isAuthorized) return "";
  const dataFim = TEAM.validoAte ? formatDate(dataISOLocal(TEAM.validoAte)) : "";
  if (!planoVigente()){
    if (state.ehSuper){
      return `<div class="plano-faixa plano-faixa-erro">Plano vencido${dataFim ? " em " + dataFim : ""}. Para a equipe do time, o cadastro está bloqueado. Você, como dono da plataforma, continua podendo editar.</div>`;
    }
    return `<div class="plano-faixa plano-faixa-erro">Plano vencido${dataFim ? " em " + dataFim : ""}. O time está só em consulta: renove para voltar a cadastrar.${WHATS_RENOVAR(`Olá! Quero renovar o plano do time ${TEAM.nome}.`)}</div>`;
  }
  const d = diasRestantes();
  if (d === null || d > 3000) return "";
  if (TEAM.plano === "teste"){
    return `<div class="plano-faixa">Teste grátis: ${d <= 0 ? "termina hoje" : `faltam ${d} dia${d === 1 ? "" : "s"}`}. Todas as funções estão liberadas.</div>`;
  }
  if (d <= 7){
    return `<div class="plano-faixa">Seu plano vence ${d <= 0 ? "hoje" : d === 1 ? "amanhã" : `em ${d} dias`} (${dataFim}). Renove para não perder o acesso para cadastrar.${WHATS_RENOVAR(`Olá! Quero renovar o plano do time ${TEAM.nome}.`)}</div>`;
  }
  return "";
}

// ============================================================================
// Render
// ============================================================================

function parseHash(){
  const raw = (location.hash || "#dashboard").slice(1);
  const [route, subId] = raw.split("/");
  return { route: route || "dashboard", subId };
}

function atualizarMenu(route){
  // Hubs: o botão do menu fica ativo em qualquer subtela do hub.
  const CADASTROS_SUBROTAS = new Set(["atletas", "adversarios", "campos", "jogos"]);
  const RELATORIOS_SUBROTAS = new Set(["ranking", "escalacao-ideal", "historico", "extrato", "retrospecto", "premiacoes"]);
  const ativa = CADASTROS_SUBROTAS.has(route) ? "cadastros" : RELATORIOS_SUBROTAS.has(route) ? "relatorios" : route;
  $$(".nav-link[data-route]").forEach(a => a.classList.toggle("active", a.dataset.route === ativa));

  // Itens do plano que o time não tem somem do menu.
  $$(".nav-link[data-recurso]").forEach(a => { a.dataset.semPlano = temRecurso(a.dataset.recurso) ? "" : "1"; });
  $$(".nav-super-only").forEach(el => { el.style.display = state.ehSuper ? "" : "none"; });
  atualizarVisibilidadeMenu();
}

function atualizarVisibilidadeMenu(){
  const autorizado = state.isAuthorized;
  $$(".nav-protected-only").forEach(el => {
    const semPlano = el.dataset.semPlano === "1";
    el.style.display = autorizado && !semPlano ? "" : "none";
  });
}

function render(){
  document.body.classList.toggle("sem-time", modo !== "time");
  const root = $("#view-root");
  const { route, subId } = parseHash();

  // ----- Sem time aberto: tela inicial ou painel do dono
  if (modo !== "time"){
    if (!authPronto){ root.innerHTML = `<div class="loader">Carregando…</div>`; return; }
    if (route === "admin" && state.ehSuper){ renderAdmin(root, state); return; }
    renderLanding(root, { user: state.usuario, ehSuper: state.ehSuper, aviso: avisoInicio });
    return;
  }

  // ----- Time aberto
  state.isAuthorized = state.isAuthorized && !!state.usuario;
  atualizarMenu(route);

  if (!allLoaded()){
    root.innerHTML = `<div class="loader">Carregando dados…</div>`;
    return;
  }

  if (route === "admin"){
    if (!authPronto) { root.innerHTML = `<div class="loader">Carregando…</div>`; return; }
    if (state.ehSuper) renderAdmin(root, state); else renderRestricted(root);
    return;
  }

  if (PROTECTED_ROUTES.has(route) && !state.isAuthorized){
    if (!authPronto){ root.innerHTML = `<div class="loader">Carregando…</div>`; return; }
    renderRestricted(root);
    return;
  }

  const recurso = RECURSO_DA_ROTA[route];
  if (recurso && !temRecurso(recurso)){ renderRecursoNaoIncluso(root, recurso); return; }

  if (route === "jogos"){
    if (subId) renderJogoDetail(root, state, subId);
    else renderJogosList(root, state);
  } else if (route === "extrato"){ renderExtrato(root, state, subId); }
  else if (route === "presenca"){ renderPresenca(root, state, subId); }
  else {
    const fn = ROUTES[route];
    if (fn) fn(root, state, subId);
    else renderDashboard(root, state);
  }

  const faixa = faixaDoPlano();
  if (faixa) root.insertAdjacentHTML("afterbegin", faixa);
  root.classList.toggle("somente-leitura", somenteLeitura());
}

window.addEventListener("hashchange", render);

// ============================================================================
// Tema claro/escuro e navegação
// ============================================================================

const ICONE_SOL = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
const ICONE_LUA = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
function atualizarBotoesTema(){
  const escuro = getTheme() === "dark";
  const titulo = escuro ? "Ativar tema claro" : "Ativar tema escuro";
  const side = $("#btn-theme-side");
  if (side){ side.innerHTML = `${escuro ? ICONE_SOL : ICONE_LUA}<span>${escuro ? "Tema claro" : "Tema escuro"}</span>`; side.title = titulo; }
  const mob = $("#btn-theme-mobile");
  if (mob){ mob.innerHTML = escuro ? ICONE_SOL : ICONE_LUA; mob.title = titulo; }
}
["#btn-theme-side", "#btn-theme-mobile"].forEach(sel => $(sel)?.addEventListener("click", () => { toggleTheme(); atualizarBotoesTema(); }));
atualizarBotoesTema();

$$(".brand, .mobile-topbar-brand").forEach(el => {
  el.style.cursor = "pointer";
  el.title = "Ir para o início";
  el.addEventListener("click", () => { location.hash = "#dashboard"; });
});

$$(".nav-link[data-route]").forEach(btn => {
  btn.addEventListener("click", () => { location.hash = `#${btn.dataset.route}`; });
});

// ============================================================================
// Autenticação
// ============================================================================

async function doLogin(){
  try{
    await loginWithGoogle();
  }catch(err){
    console.error(err);
    toast("Não foi possível entrar. Tente novamente.", "err");
  }
}

$("#btn-login-desktop")?.addEventListener("click", doLogin);
$("#btn-login-mobile")?.addEventListener("click", doLogin);
$("#btn-signout")?.addEventListener("click", () => logout());
$("#btn-signout-mobile")?.addEventListener("click", () => logout());

function updateAuthUI(user){
  const autorizado = state.isAuthorized;
  atualizarVisibilidadeMenu();

  const mostrar = (sel, on, disp = "") => { const el = $(sel); if (el) el.style.display = on ? disp : "none"; };
  mostrar("#btn-login-desktop", !autorizado);
  mostrar("#user-chip-desktop", autorizado, "flex");
  mostrar("#btn-signout", autorizado);
  mostrar("#btn-login-mobile", !autorizado);
  mostrar("#user-chip-mobile", autorizado, "flex");

  if (autorizado && user){
    $("#user-name").textContent = user.displayName || "";
    $("#user-email").textContent = user.email || "";
    $("#user-avatar").src = user.photoURL || "";
    $("#user-avatar-mobile").src = user.photoURL || "";
  }
}

// ============================================================================
// Inicialização
// ============================================================================

async function iniciar(){
  document.body.classList.add("sem-time");
  render(); // "Carregando…"

  const resolvido = resolverTeamId();
  if (resolvido){
    if (resolvido.startsWith("invalido:")){
      avisoInicio = `O código "${resolvido.slice(9)}" não é válido. Confira o link do time.`;
    } else {
      const ok = await carregarTime(resolvido);
      if (ok){
        modo = "time";
        aplicarMarca();
        aplicarCache();
        observarTime(render);
        startListeners();
      } else {
        try{ localStorage.removeItem("app_ultimo_time"); }catch(err){ /* ok */ }
        avisoInicio = `Não encontramos o time "${resolvido}". Confira o link ou entre com o código correto.`;
      }
    }
  }
  if (modo !== "time") aplicarMarca();

  render();

  watchAuth(async (user) => {
    let membro = false;
    if (user && modo === "time"){
      membro = await usuarioEhDaEquipe(user);
      if (!membro){
        toast(`A conta ${user.email} não faz parte da equipe deste time.`, "err");
        user = null;
        logout();
      }
    }
    state.usuario = user || null;
    state.ehSuper = !!user && ehSuperAdmin(user.email);
    state.isAuthorized = modo === "time" ? membro : false;
    authPronto = true;
    updateAuthUI(user);
    render();
  });
}

iniciar();
