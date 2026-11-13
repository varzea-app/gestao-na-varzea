// Modo jogo — tela feita para o celular, para lançar o jogo ao vivo.
// Grava nos MESMOS campos da aba "Gols & assistências" (golsAssistencias,
// placarNos, placarAdversario), então tudo aparece igual na súmula, no ranking
// e nos relatórios.
import { TEAM } from "../tenant.js";
import { $, $$, escapeHtml, toast, formatDateLong, confirmAction, todayISO } from "../utils.js";
import { updateJogoField } from "../db.js";
import { ehJogador, GOL_CONTRA_ID, TIPOS_GOL, TEMPOS_JOGO, jogadoresDaPartida, normalizeEscalacao } from "../stats.js";

// ----------------------------------------------------------------------------
// Estado da tela (fica na memória enquanto a página está aberta)
// ----------------------------------------------------------------------------
let sheet = null;          // null | { passo: "autor" | "assist", autor, assist, minuto, tipo, tempo }
let elencoTodo = false;    // false = só escalados; true = elenco inteiro
let salvando = false;
let filaAberta = false;    // mostra todos os avisos pendentes (senão só os 3 mais recentes)
let relogioTimer = null;
let ultimoDesfazer = null; // { jogoId, antes: {campos} } para desfazer a última ação
let jogoAberto = null;     // id do jogo atualmente na tela (limpa a folha ao trocar)

// ----------------------------------------------------------------------------
// Cronômetro com tempos — guardado no aparelho, por jogo.
// fase: "pre" (não começou) | "t1" | "int" (intervalo) | "t2" | "fim"
// acum = tempo jogado (sem contar o intervalo); inicio = quando voltou a rodar
// (null = pausado). O minuto do gol segue contando do 1º para o 2º tempo.
// ----------------------------------------------------------------------------
const chaveRelogio = (jogoId) => `modojogo_relogio_${TEAM.id}_${jogoId}`;
const FASES = { pre: "Antes do jogo", t1: "1º tempo", int: "Intervalo", t2: "2º tempo", fim: "Fim de jogo" };

function lerRelogio(jogoId){
  try{
    const r = JSON.parse(localStorage.getItem(chaveRelogio(jogoId)) || "null");
    if (r && typeof r.acum === "number"){
      // Formato antigo (sem fase): se já rodou, é 1º tempo.
      const fase = r.fase || ((r.acum > 0 || r.inicio) ? "t1" : "pre");
      return { fase, acum: r.acum, inicio: r.inicio || null };
    }
  }catch(_){}
  return { fase: "pre", acum: 0, inicio: null };
}
function gravarRelogio(jogoId, r){
  try{ localStorage.setItem(chaveRelogio(jogoId), JSON.stringify(r)); }catch(_){}
}
const decorridoMs = (r) => r.acum + (r.inicio ? Date.now() - r.inicio : 0);
function textoRelogio(ms){
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
// Minuto "de futebol": 0:00–0:59 = 1º minuto. Sem cronômetro usado = null.
function minutoAtual(jogoId){
  const r = lerRelogio(jogoId);
  if (r.fase === "pre") return null;
  return Math.floor(decorridoMs(r) / 60000) + 1;
}
// Qual tempo marcar no gol: só quando o jogo está rolando (ou pausado) em um dos tempos.
function tempoAtual(jogoId){
  const f = lerRelogio(jogoId).fase;
  return f === "t1" ? "1º tempo" : f === "t2" ? "2º tempo" : "";
}
// Muda de fase congelando o tempo corrido.
function mudarFase(jogoId, fase, rodar){
  const r = lerRelogio(jogoId);
  gravarRelogio(jogoId, { fase, acum: decorridoMs(r), inicio: rodar ? Date.now() : null });
}

let telaLigada = null;
function manterTelaLigada(){
  try{
    if (!("wakeLock" in navigator) || telaLigada) return;
    navigator.wakeLock.request("screen").then(l => {
      telaLigada = l;
      l.addEventListener("release", () => { telaLigada = null; });
    }).catch(() => {});
  }catch(_){}
}
function soltarTela(){
  try{ telaLigada?.release(); }catch(_){}
  telaLigada = null;
}
// O celular solta a trava quando o app vai para segundo plano; pega de novo ao voltar.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && relogioTimer && jogoAberto && lerRelogio(jogoAberto).inicio) manterTelaLigada();
});

function pararTicker(){
  if (relogioTimer){ clearInterval(relogioTimer); relogioTimer = null; }
  soltarTela();
}
function iniciarTicker(jogoId){
  if (relogioTimer){ clearInterval(relogioTimer); relogioTimer = null; }
  if (lerRelogio(jogoId).inicio) manterTelaLigada(); else soltarTela();
  relogioTimer = setInterval(() => {
    const el = document.getElementById("mj-relogio");
    if (!el){ pararTicker(); return; }
    el.textContent = textoRelogio(decorridoMs(lerRelogio(jogoId)));
  }, 1000);
}

// ----------------------------------------------------------------------------
// Utilidades de dados
// ----------------------------------------------------------------------------
function poolDeJogadores(jogo, atletas){
  const todos = atletas.filter(a => ehJogador(a) && a.ativo !== false);
  const escalados = jogadoresDaPartida(jogo, atletas);
  const lista = (elencoTodo || escalados.length === 0) ? todos : escalados;
  return [...lista].sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR"));
}

// Atualiza o jogo e guarda o estado anterior para o "Desfazer".
async function gravar(jogo, campos, mensagem){
  if (salvando) return false;
  salvando = true;
  const antes = {};
  Object.keys(campos).forEach(k => { antes[k] = jogo[k] === undefined ? null : jogo[k]; });
  try{
    // Sem sinal no campo, o Firestore guarda a gravação no aparelho e envia
    // depois — mas a confirmação demora. Não travamos a tela esperando: depois
    // de 2,5 s seguimos em frente (a tela já mostra o dado gravado localmente).
    const envio = updateJogoField(jogo.id, campos);
    const r = await Promise.race([envio.then(() => "ok"), new Promise(res => setTimeout(() => res("lento"), 2500))]);
    if (r === "lento"){
      toast("Sem sinal? Salvo no aparelho; envia quando a internet voltar.", "ok");
      envio.catch(err => toast("Não foi possível salvar: " + (err.message || err), "err"));
    }
    ultimoDesfazer = { jogoId: jogo.id, antes, filaId: null };
    if (mensagem && r === "ok") toast(mensagem, "ok");
    return true;
  }catch(err){
    console.error(err);
    toast("Não foi possível salvar: " + (err.message || err), "err");
    return false;
  }finally{
    salvando = false;
  }
}

// Ao lançar a primeira ação de um jogo agendado, ele passa a "realizado"
// (é assim que ele entra nas estatísticas).
const statusCampos = (jogo) => jogo.status === "realizado" ? {} : { status: "realizado", modoJogoEm: Date.now() };

// ----------------------------------------------------------------------------
// Avisos para o grupo do WhatsApp
// Cada ação gera uma mensagem pronta numa "fila". O botão Enviar abre o WhatsApp
// com o texto escrito; a pessoa escolhe o grupo e envia. Nada é enviado sozinho.
// ----------------------------------------------------------------------------
const chaveFila = (jogoId) => `modojogo_fila_${TEAM.id}_${jogoId}`;
function lerFila(jogoId){
  try{ const f = JSON.parse(localStorage.getItem(chaveFila(jogoId)) || "[]"); return Array.isArray(f) ? f : []; }catch(_){ return []; }
}
function gravarFila(jogoId, fila){
  try{ localStorage.setItem(chaveFila(jogoId), JSON.stringify(fila.slice(-8))); }catch(_){}
}
function enfileirar(jogoId, rotulo, texto){
  const fila = lerFila(jogoId);
  fila.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), rotulo, texto });
  const novo = fila[fila.length - 1].id;
  gravarFila(jogoId, fila);
  return novo;
}
// Aviso de gol/placar: se a ação for desfeita, o aviso pendente sai da fila junto.
function enfileirarGol(jogoId, rotulo, texto){
  const id = enfileirar(jogoId, rotulo, texto);
  if (ultimoDesfazer && ultimoDesfazer.jogoId === jogoId) ultimoDesfazer.filaId = id;
  return id;
}
function tirarDaFila(jogoId, id){
  gravarFila(jogoId, lerFila(jogoId).filter(m => m.id !== id));
}

// c = { jogo, adv, campo, atletas, eventos, nos, advP }
function nomeDe(c, id){ return id === GOL_CONTRA_ID ? "Gol contra do adversário" : (c.atletas.find(a => a.id === id)?.nome || "?"); }
function placarLinha(c){ return `📊 *${TEAM.nome} ${c.nos} x ${c.advP} ${c.adv?.nome || "Adversário"}*`; }

function linhaGol(c, e, detalhado){
  const meta = detalhado ? [e.tempo, e.tipoGol].filter(Boolean).join(", ") : "";
  return `⚽ ${nomeDe(c, e.atletaGolId)}${e.minuto != null ? ` ${e.minuto}'` : ""}${e.atletaAssistId ? ` — assist. ${nomeDe(c, e.atletaAssistId)}` : ""}${meta ? ` (${meta})` : ""}`;
}
function golsAdversarioLinha(c){ return c.advP > 0 ? `\n🔴 Gols do ${c.adv?.nome || "adversário"}: ${c.advP}` : ""; }

// Escalação do aviso: por posição (GOL, ZAG, LAT, VOL, MEI, ATA), sem número da camisa.
const SIGLAS_POSICAO = { Goleiro: "GOL", Zagueiro: "ZAG", Lateral: "LAT", Volante: "VOL", Meia: "MEI", Atacante: "ATA" };
const ORDEM_POSICAO = Object.keys(SIGLAS_POSICAO);

function msgInicio(c){
  const esc = normalizeEscalacao(c.jogo.escalacaoInicial);
  const itens = esc.map((e, i) => {
    const a = c.atletas.find(x => x.id === e.atletaId);
    if (!a) return null;
    const pos = e.posicao || a.posicao || "";
    const ordem = ORDEM_POSICAO.indexOf(pos);
    return { i, ordem: ordem < 0 ? ORDEM_POSICAO.length : ordem, sigla: SIGLAS_POSICAO[pos] || "---", nome: a.nome };
  }).filter(Boolean).sort((x, y) => x.ordem - y.ordem || x.i - y.i);
  const linhas = itens.map(x => `• ${x.sigla} - ${x.nome}`);
  return `🟢 *COMEÇOU!* ${TEAM.nome} x ${c.adv?.nome || "Adversário"}` +
    (c.campo?.nome ? `\n📍 ${c.campo.nome}` : "") +
    (linhas.length ? `\n\n*Escalação inicial:*\n${linhas.join("\n")}` : "");
}
function msgGol(c, e){
  if (!e){ // gol sem autor
    return `⚽ *GOL do ${TEAM.nome}!*\n\n${placarLinha(c)}`;
  }
  if (e.atletaGolId === GOL_CONTRA_ID){
    return `⚽ *GOL CONTRA do adversário!* (a favor do ${TEAM.nome})` +
      `${e.minuto != null ? `\n⏱ ${e.minuto}'${e.tempo ? ` do ${e.tempo}` : ""}` : (e.tempo ? `\n⏱ ${e.tempo}` : "")}\n\n${placarLinha(c)}`;
  }
  const quando = e.minuto != null ? `${e.minuto}'${e.tempo ? ` do ${e.tempo}` : ""}` : (e.tempo || "");
  return `⚽ *GOL do ${TEAM.nome}!*\n*${nomeDe(c, e.atletaGolId)}*` +
    (e.tipoGol ? `\n🎯 ${e.tipoGol}` : "") +
    (quando ? `\n⏱ ${quando}` : "") +
    (e.atletaAssistId ? `\n🅰️ Assistência: ${nomeDe(c, e.atletaAssistId)}` : "") +
    `\n\n${placarLinha(c)}`;
}
function msgGolAdversario(c){
  return `😕 *Gol do ${c.adv?.nome || "adversário"}*\n\n${placarLinha(c)}`;
}
function msgFimT1(c){
  const gols = c.eventos.map(e => linhaGol(c, e, false));
  return `⏸ *Fim do 1º tempo*\n${placarLinha(c)}\n\n*Gols do ${TEAM.nome}:*\n${gols.length ? gols.join("\n") : "Nenhum gol com autor lançado."}${golsAdversarioLinha(c)}`;
}
function msgInicioT2(c){
  return `▶️ *Começou o 2º tempo!*\n${placarLinha(c)}`;
}
function msgFimJogo(c){
  const res = c.nos > c.advP ? "🏆 Vitória!" : c.nos < c.advP ? "❌ Derrota" : "➖ Empate";
  const gols = c.eventos.map(e => linhaGol(c, e, true));
  const cont = {};
  c.eventos.forEach(e => { if (e.atletaAssistId && e.atletaAssistId !== GOL_CONTRA_ID) cont[e.atletaAssistId] = (cont[e.atletaAssistId] || 0) + 1; });
  const assists = Object.entries(cont).map(([id, n]) => `${nomeDe(c, id)}${n > 1 ? ` (${n})` : ""}`);
  return `🏁 *FIM DE JOGO*\n${placarLinha(c)}\n${res}` +
    `\n\n*Gols do ${TEAM.nome}:*\n${gols.length ? gols.join("\n") : "Nenhum gol com autor lançado."}` +
    (assists.length ? `\n\n🅰️ *Assistências:* ${assists.join(", ")}` : "") +
    golsAdversarioLinha(c);
}
const urlWhats = (texto) => `https://wa.me/?text=${encodeURIComponent(texto)}`;

// ----------------------------------------------------------------------------
// Proteção: o Modo jogo só abre o jogo de HOJE ou jogo AGENDADO para o futuro. O de hoje já vira
// "realizado" no primeiro lançamento mas continua em andamento. Assim um jogo
// antigo já fechado não é alterado por engano.
// ----------------------------------------------------------------------------
// "modoJogoEm" marca quando o Modo jogo começou a lançar o jogo: ele segue
// liberado por 12 h mesmo que a data cadastrada seja outra (jogo adiado, virada
// da meia-noite), e depois fecha sozinho.
const DOZE_HORAS = 12 * 3600 * 1000;
export function modoJogoLiberado(jogo){
  if (!jogo) return false;
  const hoje = todayISO();
  if (jogo.data === hoje) return true;                                  // dia do jogo
  if (jogo.status !== "realizado" && (jogo.data || "") > hoje) return true; // agendado para o futuro (antes do dia)
  return typeof jogo.modoJogoEm === "number" && Date.now() - jogo.modoJogoEm < DOZE_HORAS;
}

// Jogo que o atalho do menu abre: o de hoje; senão o próximo agendado.
// Nenhum = null (a tela avisa que não há jogo agendado).
export function jogoParaModoJogo(jogos){
  const hoje = todayISO();
  const ok = jogos.filter(j => j.data && modoJogoLiberado(j));
  return ok.find(j => j.data === hoje)
    || ok.filter(j => j.data > hoje).sort((a, b) => a.data.localeCompare(b.data))[0]
    || null;
}

export function renderSemJogoAgendado(root){
  pararTicker();
  root.innerHTML = `
    <div class="card card-pad" style="max-width:480px; margin:24px auto; text-align:center;">
      <div style="font-size:34px;">⚽</div>
      <div class="card-title" style="margin-top:6px;">Sem jogo agendado no momento</div>
      <p style="font-size:13.5px; color:var(--ink-soft);">O Modo jogo só funciona com um jogo agendado (para não alterar o resultado de um jogo já realizado). Agende um jogo para entrar nesse modo.</p>
      <a href="#jogos" class="btn btn-gold">Ir para as partidas</a>
    </div>`;
}

// ----------------------------------------------------------------------------
// Tela
// ----------------------------------------------------------------------------
export function renderModoJogo(root, state, jogoId){
  if (jogoAberto !== jogoId){ sheet = null; elencoTodo = false; jogoAberto = jogoId; }
  const jogo = state.jogos.find(j => j.id === jogoId);
  if (!jogo){
    pararTicker();
    root.innerHTML = `
      <div class="card card-pad" style="text-align:center;">
        <p>${state.falhaLeitura ? "Não foi possível carregar o jogo agora." : "Jogo não encontrado."}</p>
        <a href="#jogos" class="btn btn-primary">Ir para as partidas</a>
      </div>`;
    return;
  }

  if (!modoJogoLiberado(jogo)){
    pararTicker();
    root.innerHTML = `
      <div class="card card-pad" style="max-width:480px; margin:24px auto; text-align:center;">
        <div style="font-size:34px;">🔒</div>
        <div class="card-title" style="margin-top:6px;">Este jogo já foi realizado</div>
        <p style="font-size:13.5px; color:var(--ink-soft);">O Modo jogo só abre o jogo do dia ou jogos agendados para os próximos dias, para não alterar por engano o resultado de um jogo antigo. Para corrigir este jogo, use a página dele.</p>
        <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
          <a href="#jogos/${jogo.id}" class="btn btn-primary">Abrir o jogo</a>
          <a href="#jogos" class="btn btn-ghost">Partidas</a>
        </div>
      </div>`;
    return;
  }

  const adv = state.adversarios.find(a => a.id === jogo.adversarioId);
  const campo = state.campos.find(c => c.id === jogo.campoId);
  const atletas = state.atletas;
  const eventos = jogo.golsAssistencias || [];
  const nosPlacar = jogo.placarNos ?? eventos.length;
  const advPlacar = jogo.placarAdversario ?? 0;
  const nomeAtleta = (id) => id === GOL_CONTRA_ID ? "Gol contra (adversário)" : (atletas.find(a => a.id === id)?.nome || "?");
  const fila = lerFila(jogoId);
  const relogio = lerRelogio(jogoId);
  const rodando = !!relogio.inicio;
  const semAutor = Math.max(0, nosPlacar - eventos.length);

  const listaEventos = eventos.map((e, idx) => ({ e, idx })).reverse().map(({ e, idx }) => `
    <div class="mj-evt">
      <span class="mj-evt-min">${e.minuto != null ? e.minuto + "'" : "–"}</span>
      <span class="mj-evt-txt">⚽ <strong>${escapeHtml(nomeAtleta(e.atletaGolId))}</strong>${e.atletaAssistId ? ` <span class="mj-evt-sub">assist. ${escapeHtml(nomeAtleta(e.atletaAssistId))}</span>` : ""}${[e.tipoGol, e.tempo].filter(Boolean).length ? ` <span class="mj-evt-sub">· ${[e.tipoGol, e.tempo].filter(Boolean).map(escapeHtml).join(" · ")}</span>` : ""}</span>
      <button class="mj-evt-del" data-del="${idx}" aria-label="Remover este gol">✕</button>
    </div>`).join("");

  root.innerHTML = `
    <div class="mj">
      <div class="mj-top">
        <a href="#jogos/${jogo.id}" class="mj-voltar">&larr; Voltar ao jogo</a>
        <span class="mj-status ${jogo.status === "realizado" ? "ok" : ""}">${jogo.status === "realizado" ? "Realizado" : "Agendado"}</span>
      </div>
      <div class="mj-info">${formatDateLong(jogo.data)}${jogo.horario ? ` · ${escapeHtml(jogo.horario)}` : ""} · ${escapeHtml(campo?.nome || "Campo não definido")}</div>

      <div class="mj-placar">
        <div class="mj-lado">
          <div class="mj-time">${TEAM.nomeHtml}</div>
          <div class="mj-num" id="mj-nos">${nosPlacar}</div>
        </div>
        <div class="mj-x">×</div>
        <div class="mj-lado">
          <div class="mj-time">${escapeHtml(adv?.nome || "Adversário")}</div>
          <div class="mj-num" id="mj-adv">${advPlacar}</div>
        </div>
      </div>

      ${relogio.fase === "pre" && normalizeEscalacao(jogo.escalacaoInicial).length === 0 ? `<div class="mj-alerta">⚠️ A escalação inicial ainda não foi lançada, então o aviso de início sairá sem ela. <a href="#jogos/${jogo.id}">Lançar escalação</a></div>` : ""}
      <div class="mj-fase">${FASES[relogio.fase]}${relogio.fase === "t1" || relogio.fase === "t2" ? (rodando ? " · rolando" : " · pausado") : ""}</div>
      <div class="mj-relogio-box">
        <span class="mj-relogio" id="mj-relogio">${textoRelogio(decorridoMs(relogio))}</span>
      </div>
      <div class="mj-relogio-box">
        ${relogio.fase === "pre" ? `<button class="btn btn-gold btn-sm" id="mj-ini-t1">▶ Iniciar 1º tempo</button>` : ""}
        ${relogio.fase === "t1" || relogio.fase === "t2" ? `
          <button class="btn btn-ghost btn-sm" id="mj-rel-toggle">${rodando ? "⏸ Pausar" : "▶ Continuar"}</button>
          <button class="btn btn-ghost btn-sm" id="${relogio.fase === "t1" ? "mj-fim-t1" : "mj-fim-jogo"}">${relogio.fase === "t1" ? "Encerrar 1º tempo" : "Encerrar jogo"}</button>` : ""}
        ${relogio.fase === "int" ? `<button class="btn btn-gold btn-sm" id="mj-ini-t2">▶ Iniciar 2º tempo</button>` : ""}
        ${relogio.fase !== "pre" ? `<button class="btn btn-ghost btn-sm" id="mj-rel-zerar">Zerar</button>` : ""}
      </div>

      <button class="mj-btn-gol" id="mj-gol">⚽ GOL DO NOSSO TIME</button>
      <div class="mj-linha">
        <button class="mj-btn-sec" id="mj-adv-mais">+1 gol do adversário</button>
        <button class="mj-btn-sec peq" id="mj-adv-menos" ${advPlacar <= 0 ? "disabled" : ""}>−1</button>
      </div>
      <div class="mj-linha">
        <button class="mj-btn-link" id="mj-sem-autor">+1 gol nosso sem autor</button>
        ${semAutor > 0 ? `<span class="mj-aviso">${semAutor} gol(s) no placar sem autor</span>` : ""}
      </div>
      ${ultimoDesfazer && ultimoDesfazer.jogoId === jogo.id ? `<button class="mj-desfazer" id="mj-desfazer">↩ Desfazer a última ação</button>` : ""}

      ${fila.length ? `
      <div class="mj-fila">
        <div class="mj-fila-titulo">📲 Para enviar no grupo (${fila.length})</div>
        ${(filaAberta ? fila : fila.slice(-3)).map(m => `
        <div class="mj-fila-item">
          <span class="mj-fila-rot">${escapeHtml(m.rotulo)}</span>
          <a class="btn btn-gold btn-sm" href="${urlWhats(m.texto)}" target="_blank" rel="noopener" data-env="${m.id}">Enviar</a>
          <button class="btn btn-ghost btn-sm" data-copiar="${m.id}">Copiar</button>
          <button class="mj-fila-x" data-fila-x="${m.id}" aria-label="Descartar">✕</button>
        </div>`).join("")}
        ${fila.length > 3 ? `<button class="mj-btn-link" id="mj-fila-ver">${filaAberta ? "Mostrar só as mais recentes" : `Ver todas (${fila.length})`}</button>` : ""}
      </div>` : ""}

      <div class="mj-sec-titulo">Gols do jogo (${eventos.length})</div>
      ${listaEventos || `<p class="mj-vazio">Nenhum gol lançado ainda.</p>`}

      <div class="mj-rodape">
        ${jogo.status === "realizado"
          ? `<span class="mj-nota">Jogo marcado como realizado — já conta nas estatísticas.</span>`
          : `<button class="btn btn-primary" id="mj-encerrar">Marcar jogo como realizado</button>`}
        <a href="#jogos/${jogo.id}" class="btn btn-ghost">Abrir súmula completa</a>
      </div>
    </div>
    ${sheet ? renderSheet(jogo, atletas) : ""}
  `;

  ligar(root, state, jogo, atletas);
  iniciarTicker(jogoId);
}

function renderSheet(jogo, atletas){
  const pool = poolDeJogadores(jogo, atletas);
  const escalados = jogadoresDaPartida(jogo, atletas);
  const botoes = (selecionado, tipo, ocultarId) => pool
    .filter(a => a.id !== ocultarId)
    .map(a => `<button class="mj-jog ${selecionado === a.id ? "sel" : ""}" data-${tipo}="${a.id}">${a.numero != null ? `<span class="mj-jog-n">${a.numero}</span>` : ""}<span>${escapeHtml(a.nome)}</span></button>`)
    .join("");
  const toggle = escalados.length > 0
    ? `<button class="mj-btn-link" id="mj-toggle-elenco">${elencoTodo ? "Mostrar só os escalados" : "Mostrar o elenco todo"}</button>`
    : `<span class="mj-aviso">Sem escalação neste jogo: mostrando o elenco todo.</span>`;

  if (sheet.passo === "autor"){
    return `
      <div class="mj-fundo" id="mj-fundo">
        <div class="mj-sheet">
          <div class="mj-sheet-head"><strong>Quem fez o gol?</strong><button class="mj-fechar" id="mj-fechar" aria-label="Fechar">✕</button></div>
          <div class="mj-grade">${botoes(null, "autor")}</div>
          <button class="mj-jog contra" data-autor="${GOL_CONTRA_ID}">⚽ Gol contra do adversário</button>
          <div class="mj-sheet-pe">${toggle}</div>
        </div>
      </div>`;
  }

  const nomeAutor = atletas.find(a => a.id === sheet.autor)?.nome || "?";
  const minuto = sheet.minuto ?? "";
  return `
    <div class="mj-fundo" id="mj-fundo">
      <div class="mj-sheet">
        <div class="mj-sheet-head"><strong>Gol de ${escapeHtml(nomeAutor)}</strong><button class="mj-fechar" id="mj-fechar" aria-label="Fechar">✕</button></div>
        <div class="mj-sub">Quem deu a assistência? (opcional)</div>
        <div class="mj-grade">${botoes(sheet.assist, "assist", sheet.autor)}</div>
        <div class="mj-campos">
          <label>Minuto<input type="number" inputmode="numeric" id="mj-min" min="0" max="150" placeholder="ex: 34" value="${minuto}"></label>
          <label>Como foi<select id="mj-tipo"><option value="">—</option>${TIPOS_GOL.map(t => `<option value="${escapeHtml(t)}" ${sheet.tipo === t ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select></label>
          <label>Tempo<select id="mj-tempo"><option value="">—</option>${TEMPOS_JOGO.map(t => `<option value="${escapeHtml(t)}" ${sheet.tempo === t ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select></label>
        </div>
        <div class="mj-sheet-acoes">
          <button class="btn btn-ghost" id="mj-voltar-autor">&larr; Trocar autor</button>
          <button class="mj-btn-salvar" id="mj-salvar">${sheet.assist ? "✓ Salvar com assistência" : "✓ Salvar gol"}</button>
        </div>
      </div>
    </div>`;
}

// ----------------------------------------------------------------------------
// Eventos
// ----------------------------------------------------------------------------
function ligar(root, state, jogo, atletas){
  const re = () => renderModoJogo(root, state, jogo.id);
  const eventos = jogo.golsAssistencias || [];
  const nosPlacar = jogo.placarNos ?? eventos.length;
  const advPlacar = jogo.placarAdversario ?? 0;
  const ctx = (extra = {}) => ({
    jogo, atletas,
    adv: state.adversarios.find(a => a.id === jogo.adversarioId),
    campo: state.campos.find(c => c.id === jogo.campoId),
    eventos, nos: nosPlacar, advP: advPlacar, ...extra,
  });

  // Fila de avisos para o grupo
  $("#mj-fila-ver", root)?.addEventListener("click", () => { filaAberta = !filaAberta; re(); });
  $$("[data-env]", root).forEach(a => a.addEventListener("click", () => {
    const id = a.dataset.env;
    setTimeout(() => { tirarDaFila(jogo.id, id); re(); }, 500);
  }));
  $$("[data-fila-x]", root).forEach(b => b.addEventListener("click", () => { tirarDaFila(jogo.id, b.dataset.filaX); re(); }));
  $$("[data-copiar]", root).forEach(b => b.addEventListener("click", async () => {
    const m = lerFila(jogo.id).find(x => x.id === b.dataset.copiar);
    if (!m) return;
    try{ await navigator.clipboard.writeText(m.texto); toast("Texto copiado. Cole no WhatsApp.", "ok"); }
    catch(_){ toast("Não consegui copiar neste aparelho.", "err"); }
  }));

  // Cronômetro e tempos
  $("#mj-ini-t1", root)?.addEventListener("click", () => { mudarFase(jogo.id, "t1", true); enfileirar(jogo.id, "Início da partida", msgInicio(ctx())); re(); });
  $("#mj-rel-toggle", root)?.addEventListener("click", () => {
    const r = lerRelogio(jogo.id);
    mudarFase(jogo.id, r.fase, !r.inicio);
    re();
  });
  $("#mj-fim-t1", root)?.addEventListener("click", () => { mudarFase(jogo.id, "int", false); enfileirar(jogo.id, "Fim do 1º tempo", msgFimT1(ctx())); toast("1º tempo encerrado. Intervalo.", "ok"); re(); });
  $("#mj-ini-t2", root)?.addEventListener("click", () => { mudarFase(jogo.id, "t2", true); enfileirar(jogo.id, "Início do 2º tempo", msgInicioT2(ctx())); re(); });
  $("#mj-fim-jogo", root)?.addEventListener("click", async () => {
    mudarFase(jogo.id, "fim", false);
    enfileirar(jogo.id, "Fim de jogo", msgFimJogo(ctx()));
    if (jogo.status !== "realizado") await gravar(jogo, statusCampos(jogo), "Jogo encerrado e marcado como realizado.");
    else toast("Jogo encerrado.", "ok");
    re();
  });
  $("#mj-rel-zerar", root)?.addEventListener("click", async () => {
    if (!(await confirmAction("Zerar o cronômetro e voltar para antes do jogo?", { confirmLabel: "Zerar", title: "Zerar cronômetro" }))) return;
    gravarRelogio(jogo.id, { fase: "pre", acum: 0, inicio: null });
    re();
  });

  // Abrir o lançamento de gol
  $("#mj-gol", root)?.addEventListener("click", () => {
    sheet = { passo: "autor", autor: null, assist: null, minuto: minutoAtual(jogo.id), tipo: "", tempo: tempoAtual(jogo.id) };
    re();
  });

  // Gol do adversário (+1 / −1)
  $("#mj-adv-mais", root)?.addEventListener("click", async () => {
    const ok = await gravar(jogo, { ...statusCampos(jogo), placarAdversario: advPlacar + 1 }, "Gol do adversário lançado.");
    if (ok){ enfileirarGol(jogo.id, `Gol do adversário (${nosPlacar} x ${advPlacar + 1})`, msgGolAdversario(ctx({ advP: advPlacar + 1 }))); re(); }
  });
  $("#mj-adv-menos", root)?.addEventListener("click", async () => {
    if (advPlacar <= 0) return;
    await gravar(jogo, { placarAdversario: advPlacar - 1 }, "Gol do adversário removido.");
  });

  // Gol nosso sem autor (só mexe no placar)
  $("#mj-sem-autor", root)?.addEventListener("click", async () => {
    const ok = await gravar(jogo, { ...statusCampos(jogo), placarNos: nosPlacar + 1 }, "Gol lançado sem autor.");
    if (ok){ enfileirarGol(jogo.id, `Gol do nosso time (${nosPlacar + 1} x ${advPlacar})`, msgGol(ctx({ nos: nosPlacar + 1 }), null)); re(); }
  });

  // Remover um gol da lista
  $$("[data-del]", root).forEach(btn => btn.addEventListener("click", async () => {
    const idx = Number(btn.dataset.del);
    if (!(await confirmAction("Remover este gol? O placar do nosso time também diminui 1.", { confirmLabel: "Remover", title: "Remover gol" }))) return;
    const novos = [...eventos];
    novos.splice(idx, 1);
    await gravar(jogo, { golsAssistencias: novos, placarNos: Math.max(0, nosPlacar - 1) }, "Gol removido.");
  }));

  // Desfazer a última ação
  $("#mj-desfazer", root)?.addEventListener("click", async () => {
    if (!ultimoDesfazer || ultimoDesfazer.jogoId !== jogo.id) return;
    const { antes, filaId } = ultimoDesfazer;
    const ok = await gravar(jogo, antes, "Ação desfeita.");
    if (ok){ if (filaId) tirarDaFila(jogo.id, filaId); ultimoDesfazer = null; }
    re();
  });

  // Encerrar
  $("#mj-encerrar", root)?.addEventListener("click", async () => {
    await gravar(jogo, statusCampos(jogo), "Jogo marcado como realizado.");
  });

  // ---- Folha de lançamento ----
  if (!sheet) return;
  const fechar = () => { sheet = null; re(); };
  $("#mj-fechar", root)?.addEventListener("click", fechar);
  $("#mj-fundo", root)?.addEventListener("click", (e) => { if (e.target.id === "mj-fundo") fechar(); });
  $("#mj-toggle-elenco", root)?.addEventListener("click", () => { elencoTodo = !elencoTodo; re(); });

  $$("[data-autor]", root).forEach(btn => btn.addEventListener("click", async () => {
    const id = btn.dataset.autor;
    if (id === GOL_CONTRA_ID){
      // Gol contra: sem assistência, grava direto.
      const min = sheet.minuto;
      const novo = { atletaGolId: GOL_CONTRA_ID, atletaAssistId: null, minuto: min ?? null, tipoGol: null, tempo: sheet.tempo || null };
      const ok = await gravar(jogo, {
        ...statusCampos(jogo),
        golsAssistencias: [...eventos, novo],
        placarNos: nosPlacar + 1,
      }, "Gol contra lançado.");
      if (ok){ enfileirarGol(jogo.id, `Gol contra do adversário (${nosPlacar + 1} x ${advPlacar})`, msgGol(ctx({ nos: nosPlacar + 1, eventos: [...eventos, novo] }), novo)); sheet = null; re(); }
      return;
    }
    sheet.autor = id; sheet.assist = null; sheet.passo = "assist";
    re();
  }));

  $$("[data-assist]", root).forEach(btn => btn.addEventListener("click", () => {
    sheet.assist = sheet.assist === btn.dataset.assist ? null : btn.dataset.assist;
    guardarCampos(root);
    re();
  }));
  $("#mj-min", root)?.addEventListener("input", () => guardarCampos(root));
  $("#mj-tipo", root)?.addEventListener("change", () => guardarCampos(root));
  $("#mj-tempo", root)?.addEventListener("change", () => guardarCampos(root));
  $("#mj-voltar-autor", root)?.addEventListener("click", () => { guardarCampos(root); sheet.passo = "autor"; re(); });

  $("#mj-salvar", root)?.addEventListener("click", async () => {
    guardarCampos(root);
    const { autor, assist, minuto, tipo, tempo } = sheet;
    if (!autor){ toast("Escolha quem fez o gol.", "err"); return; }
    if (assist && assist === autor){ toast("Autor e assistência não podem ser o mesmo atleta.", "err"); return; }
    const novo = {
      atletaGolId: autor, atletaAssistId: assist || null,
      minuto: minuto !== "" && minuto != null ? Number(minuto) : null,
      tipoGol: tipo || null, tempo: tempo || null,
    };
    const ok = await gravar(jogo, {
      ...statusCampos(jogo),
      golsAssistencias: [...eventos, novo],
      placarNos: nosPlacar + 1,
    }, "Gol lançado!");
    if (ok){ enfileirarGol(jogo.id, `Gol: ${nomeDe(ctx(), autor)} (${nosPlacar + 1} x ${advPlacar})`, msgGol(ctx({ nos: nosPlacar + 1, eventos: [...eventos, novo] }), novo)); sheet = null; re(); }
  });
}

function guardarCampos(root){
  if (!sheet) return;
  const m = $("#mj-min", root); if (m) sheet.minuto = m.value;
  const t = $("#mj-tipo", root); if (t) sheet.tipo = t.value;
  const p = $("#mj-tempo", root); if (p) sheet.tempo = p.value;
}

// Ao sair da rota, limpa o estado da folha e o cronômetro visual.
export function sairModoJogo(){
  sheet = null; pararTicker();
}
