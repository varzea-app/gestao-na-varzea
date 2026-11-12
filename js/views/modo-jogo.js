// Modo jogo — tela feita para o celular, para lançar o jogo ao vivo.
// Grava nos MESMOS campos da aba "Gols & assistências" (golsAssistencias,
// placarNos, placarAdversario), então tudo aparece igual na súmula, no ranking
// e nos relatórios.
import { TEAM } from "../tenant.js";
import { $, $$, escapeHtml, toast, formatDateLong, confirmAction } from "../utils.js";
import { updateJogoField } from "../db.js";
import { ehJogador, GOL_CONTRA_ID, TIPOS_GOL, TEMPOS_JOGO, jogadoresDaPartida } from "../stats.js";

// ----------------------------------------------------------------------------
// Estado da tela (fica na memória enquanto a página está aberta)
// ----------------------------------------------------------------------------
let sheet = null;          // null | { passo: "autor" | "assist", autor, assist, minuto, tipo, tempo }
let elencoTodo = false;    // false = só escalados; true = elenco inteiro
let salvando = false;
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

function pararTicker(){
  if (relogioTimer){ clearInterval(relogioTimer); relogioTimer = null; }
}
function iniciarTicker(jogoId){
  pararTicker();
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
    await updateJogoField(jogo.id, campos);
    ultimoDesfazer = { jogoId: jogo.id, antes };
    if (mensagem) toast(mensagem, "ok");
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
const statusCampos = (jogo) => jogo.status === "realizado" ? {} : { status: "realizado" };

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

  const adv = state.adversarios.find(a => a.id === jogo.adversarioId);
  const campo = state.campos.find(c => c.id === jogo.campoId);
  const atletas = state.atletas;
  const eventos = jogo.golsAssistencias || [];
  const nosPlacar = jogo.placarNos ?? eventos.length;
  const advPlacar = jogo.placarAdversario ?? 0;
  const nomeAtleta = (id) => id === GOL_CONTRA_ID ? "Gol contra (adversário)" : (atletas.find(a => a.id === id)?.nome || "?");
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

  // Cronômetro e tempos
  $("#mj-ini-t1", root)?.addEventListener("click", () => { mudarFase(jogo.id, "t1", true); re(); });
  $("#mj-rel-toggle", root)?.addEventListener("click", () => {
    const r = lerRelogio(jogo.id);
    mudarFase(jogo.id, r.fase, !r.inicio);
    re();
  });
  $("#mj-fim-t1", root)?.addEventListener("click", () => { mudarFase(jogo.id, "int", false); toast("1º tempo encerrado. Intervalo.", "ok"); re(); });
  $("#mj-ini-t2", root)?.addEventListener("click", () => { mudarFase(jogo.id, "t2", true); re(); });
  $("#mj-fim-jogo", root)?.addEventListener("click", async () => {
    mudarFase(jogo.id, "fim", false);
    if (jogo.status !== "realizado") await gravar(jogo, { status: "realizado" }, "Jogo encerrado e marcado como realizado.");
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
    await gravar(jogo, { ...statusCampos(jogo), placarAdversario: advPlacar + 1 }, "Gol do adversário lançado.");
  });
  $("#mj-adv-menos", root)?.addEventListener("click", async () => {
    if (advPlacar <= 0) return;
    await gravar(jogo, { placarAdversario: advPlacar - 1 }, "Gol do adversário removido.");
  });

  // Gol nosso sem autor (só mexe no placar)
  $("#mj-sem-autor", root)?.addEventListener("click", async () => {
    await gravar(jogo, { ...statusCampos(jogo), placarNos: nosPlacar + 1 }, "Gol lançado sem autor.");
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
    const antes = ultimoDesfazer.antes;
    const ok = await gravar(jogo, antes, "Ação desfeita.");
    if (ok) ultimoDesfazer = null;
    re();
  });

  // Encerrar
  $("#mj-encerrar", root)?.addEventListener("click", async () => {
    await gravar(jogo, { status: "realizado" }, "Jogo marcado como realizado.");
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
      if (ok){ sheet = null; re(); }
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
    if (ok){ sheet = null; re(); }
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
