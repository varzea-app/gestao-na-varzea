import { $, $$, escapeHtml, formatDate, toast, fmt1, avg } from "../utils.js";
import { jogosRealizados, jogadoresDaPartida, idsDaPartida, ehJogador, rotuloQuadro, posicaoJogadaNoJogo, notaDoVotanteNoJogo, notasDoAtletaNoJogo, contaParaNota } from "../stats.js";
import { updateJogoField, listenPresencasConfirmadas } from "../db.js";

let votanteId = "";
let jogoId = "";

const RAPIDAS = [5, 6, 7, 8, 9];

// Quem confirmou presença ("vou") em cada jogo. Um jogador que entrou e saiu no meio
// da partida não consta na escalação inicial nem na final, então a lista de avaliação
// também traz os confirmados que não estão em nenhuma escalação.
let confirmadosPorJogo = {};
let confUnsub = null;
let confAssinatura = "";
function ouvirConfirmados(root, state){
  if (confUnsub) return;
  confUnsub = listenPresencasConfirmadas((items) => {
    const m = {};
    items.forEach(p => { (m[p.jogoId] ||= new Set()).add(p.atletaId); });
    const assin = items.map(p => p.id).sort().join("|");
    confirmadosPorJogo = m;
    if (assin === confAssinatura) return;
    confAssinatura = assin;
    // Não refaz a tela se a pessoa já mexeu em alguma nota (perderia o que ainda não salvou).
    const aberta = location.hash.startsWith("#avaliacao") && document.querySelector("[data-av-root]");
    const mexeu = (document.getElementById("av-mudancas")?.textContent || "").match(/para salvar/);
    if (aberta && !mexeu) renderAvaliacao(root, state);
  });
}
// Confirmados que não aparecem em nenhuma escalação (nem como relacionados).
function soConfirmados(jogo, atletas){
  const jogaram = idsDaPartida(jogo);
  const conf = confirmadosPorJogo[jogo.id];
  if (!conf) return [];
  return atletas.filter(a => conf.has(a.id) && !jogaram.has(a.id) && ehJogador(a) && a.ativo !== false);
}

function fmtNota(n){ return n === null || n === undefined || n === "" ? "—" : fmt1(Number(n)); }

// Quantos jogadores o votante ainda não avaliou numa partida.
function faltam(jogo, atletas, vId){
  return jogadoresDaPartida(jogo, atletas).filter(a => a.id !== vId && notaDoVotanteNoJogo(jogo, a.id, vId) === null).length;
}

export function renderAvaliacao(root, state){
  ouvirConfirmados(root, state);
  const votantes = state.atletas.filter(a => a.podeVotar);
  const partidas = [...jogosRealizados(state.jogos)].sort((a, b) => (b.data || "").localeCompare(a.data || ""));

  // Se a seleção anterior sumiu da lista (estado obsoleto), volta ao início.
  if (votanteId && !votantes.some(v => v.id === votanteId)) votanteId = "";
  if (jogoId && !partidas.some(j => j.id === jogoId)) jogoId = "";
  // Ao escolher quem vota, já abre a partida mais recente com notas pendentes.
  if (votanteId && !jogoId){
    const pend = partidas.find(j => faltam(j, state.atletas, votanteId) > 0 && jogadoresDaPartida(j, state.atletas).length > 0);
    if (pend) jogoId = pend.id;
  }

  const jogo = partidas.find(j => j.id === jogoId) || null;
  const jogadores = jogo ? jogadoresDaPartida(jogo, state.atletas) : [];
  // Ninguém avalia a si próprio — some da lista quem está votando.
  const jogadoresParaAvaliar = jogadores.filter(a => a.id !== votanteId);
  const opcionais = jogo ? soConfirmados(jogo, state.atletas).filter(a => a.id !== votanteId) : [];
  const todosParaAvaliar = [...jogadoresParaAvaliar, ...opcionais];
  const nomeAdv = id => escapeHtml(state.adversarios.find(a => a.id === id)?.nome || "?");
  const votanteAtual = votantes.find(v => v.id === votanteId);

  const pendentesTotal = votanteId ? partidas.filter(j => jogadoresDaPartida(j, state.atletas).length > 0 && faltam(j, state.atletas, votanteId) > 0).length : 0;

  const opcaoPartida = (j) => {
    let extra = "";
    if (votanteId){
      const f = faltam(j, state.atletas, votanteId);
      extra = f > 0 ? ` · faltam ${f}` : " · completa";
    }
    return `<option value="${j.id}" ${j.id === jogoId ? "selected" : ""}>${formatDate(j.data)} — vs ${nomeAdv(j.adversarioId)}${rotuloQuadro(j) ? ` (${rotuloQuadro(j)})` : ""}${extra}</option>`;
  };

  // Gols/assistências de cada jogador na partida (contexto pra quem vota).
  const contribuicao = (atletaId) => {
    let g = 0, a = 0;
    (jogo?.golsAssistencias || []).forEach(e => { if (e.atletaGolId === atletaId) g++; if (e.atletaAssistId === atletaId) a++; });
    return [g ? `⚽ ${g}` : "", a ? `🅰️ ${a}` : ""].filter(Boolean).join("  ");
  };

  const itemHtml = (a, opcional) => {
              const posicaoJogada = posicaoJogadaNoJogo(jogo, a.id) || a.posicao || "—";
              const notaAtual = notaDoVotanteNoJogo(jogo, a.id, votanteId);
              const notasGerais = notasDoAtletaNoJogo(jogo, a.id);
              const mediaGeral = avg(notasGerais);
              const contrib = contribuicao(a.id);
              return `
              <div class="av-item" data-atleta="${a.id}" data-inicial="${notaAtual ?? ""}" ${opcional ? "data-op" : ""}>
                <input type="hidden" data-rating="av-${a.id}" value="${notaAtual ?? ""}">
                <div class="av-quem">
                  <div class="av-nome">${escapeHtml(a.nome)} ${contrib ? `<span class="av-contrib">${contrib}</span>` : ""}</div>
                  <div class="av-pos">${escapeHtml(posicaoJogada)} · ${mediaGeral !== null ? `média atual ${fmt1(mediaGeral)} (${notasGerais.length} voto${notasGerais.length === 1 ? "" : "s"})` : "sem votos ainda"}</div>
                </div>
                <div class="av-controle">
                  <button type="button" class="av-step" data-step="-0.5" aria-label="Diminuir 0,5">−</button>
                  <div class="av-valor ${notaAtual === null ? "vazio" : ""}">${fmtNota(notaAtual)}</div>
                  <button type="button" class="av-step" data-step="0.5" aria-label="Aumentar 0,5">+</button>
                </div>
                <div class="av-rapidas">
                  ${RAPIDAS.map(n => `<button type="button" class="av-rapida" data-nota="${n}">${n}</button>`).join("")}
                </div>
              </div>`;
  };
  const avaliados = jogadoresParaAvaliar.filter(a => notaDoVotanteNoJogo(jogo, a.id, votanteId) !== null).length;

  const manchete = votanteAtual && jogo && jogadoresParaAvaliar.length ? `
    <div class="manchete">
      <div class="manchete-eyebrow">Avaliação de ${escapeHtml(votanteAtual.nome)}</div>
      <div class="manchete-titulo">vs ${nomeAdv(jogo.adversarioId)}${rotuloQuadro(jogo) ? ` (${rotuloQuadro(jogo)})` : ""} · ${jogo.placarNos ?? "–"} x ${jogo.placarAdversario ?? "–"}</div>
      <div class="manchete-sub"><span id="av-progresso">${avaliados} de ${jogadoresParaAvaliar.length} jogadores avaliados</span> · ${formatDate(jogo.data)}${pendentesTotal > 1 ? ` · você ainda tem ${pendentesTotal} partidas com notas pendentes` : ""}</div>
      <div class="av-barra"><span id="av-barra-fill" style="width:${Math.round(avaliados / jogadoresParaAvaliar.length * 100)}%"></span></div>
    </div>` : "";

  root.innerHTML = `
    <div class="topbar" data-av-root>
      <div>
        <div class="eyebrow">Partidas</div>
        <h1>Avaliação de jogadores</h1>
      </div>
    </div>

    ${votantes.length === 0 ? `
      <div class="empty-state">
        <h3>Nenhum votante cadastrado</h3>
        <p>Marque a opção "Direito a voto (diretor/capitão)" no cadastro dos atletas responsáveis em Atletas para liberar a votação aqui.</p>
      </div>
    ` : `
      <div class="dash-section-title">Quem está votando?</div>
      <div class="rank-chips">
        ${votantes.map(v => `<button class="rank-chip ${v.id === votanteId ? "active" : ""}" data-votante="${v.id}" type="button">${escapeHtml(v.nome)}</button>`).join("")}
      </div>

      ${!votanteId ? `
        <div class="empty-state"><p>Escolha quem está votando para ver as partidas com notas pendentes.</p></div>
      ` : `
        <div class="rank-filtros" style="max-width:520px;">
          <div class="field span-2">
            <label>Partida</label>
            <select id="sel-jogo" ${partidas.length === 0 ? "disabled" : ""}>
              <option value="">Selecione</option>
              ${partidas.map(opcaoPartida).join("")}
            </select>
          </div>
        </div>
        ${manchete}
        ${partidas.length === 0 ? `
          <div class="empty-state"><h3>Nenhuma partida realizada</h3><p>Registre uma partida como "Realizado" em Jogos para poder avaliar os jogadores dela.</p></div>
        ` : !jogoId ? `
          <div class="empty-state"><p>${pendentesTotal === 0 ? "Você está em dia: todas as partidas já têm suas notas." : "Selecione a partida para ver os jogadores escalados."}</p></div>
        ` : jogadores.length === 0 && opcionais.length === 0 ? `
          <div class="empty-state"><h3>Sem escalação</h3><p>Essa partida ainda não tem jogadores relacionados, confirmados nem na escalação inicial ou final.</p></div>
        ` : todosParaAvaliar.length === 0 ? `
          <div class="empty-state"><h3>Nada pra avaliar aqui</h3><p>Você é o único jogador escalado nessa partida, e não é possível avaliar a si próprio.</p></div>
        ` : `
          ${!contaParaNota(jogo) ? `<div class="card-sub" style="margin:0 0 10px;">🏆 Partida de campeonato: as notas ficam registradas, mas <strong>não entram nas médias</strong> (ranking, dashboard e relatórios).</div>` : ""}
          <div class="av-lista">
            ${jogadoresParaAvaliar.map(a => itemHtml(a, false)).join("")}
          </div>
          ${opcionais.length ? `
          <div class="dash-section-title" style="margin-top:18px;">Confirmaram presença e não estão em nenhuma escalação</div>
          <div class="card-sub" style="margin:0 0 10px;">Se algum deles entrou no jogo (e saiu antes do fim), avalie; quem não jogou é só deixar em branco. Quem for avaliado passa a contar como tendo participado da partida.</div>
          <div class="av-lista">
            ${opcionais.map(a => itemHtml(a, true)).join("")}
          </div>` : ""}
          <div class="av-salvar">
            <span id="av-mudancas" class="card-sub" style="margin:0;">Nenhuma alteração</span>
            <button class="btn btn-primary" id="btn-save-avaliacao" type="button">Salvar minhas avaliações</button>
          </div>
        `}
      `}
    `}
  `;

  if (votantes.length === 0) return;

  $$("[data-votante]", root).forEach(b => b.addEventListener("click", () => {
    votanteId = b.dataset.votante === votanteId ? "" : b.dataset.votante;
    jogoId = "";
    renderAvaliacao(root, state);
  }));
  $("#sel-jogo", root)?.addEventListener("change", (e) => { jogoId = e.target.value; renderAvaliacao(root, state); });

  if (!votanteId || !jogoId || !jogo || todosParaAvaliar.length === 0) return;

  // ---- Interação: − / + e notas rápidas ----
  const itens = $$(".av-item", root);
  const atualizarResumo = () => {
    // O progresso conta só quem jogou; os "só confirmou presença" são opcionais.
    let preenchidos = 0, mudancas = 0, principais = 0;
    itens.forEach(it => {
      const val = $("input[type=hidden]", it).value;
      if (!it.hasAttribute("data-op")){ principais++; if (val !== "") preenchidos++; }
      if (val !== it.dataset.inicial) mudancas++;
    });
    const prog = $("#av-progresso", root);
    if (prog) prog.textContent = `${preenchidos} de ${principais} jogadores avaliados`;
    const fill = $("#av-barra-fill", root);
    if (fill) fill.style.width = `${principais ? Math.round(preenchidos / principais * 100) : 0}%`;
    $("#av-mudancas", root).textContent = mudancas ? `${mudancas} nota${mudancas === 1 ? "" : "s"} para salvar` : "Nenhuma alteração";
  };
  const definir = (it, valor) => {
    const hidden = $("input[type=hidden]", it);
    const v = Math.max(0, Math.min(10, valor));
    hidden.value = String(v);
    const el = $(".av-valor", it);
    el.textContent = fmt1(v);
    el.classList.remove("vazio");
    $$(".av-rapida", it).forEach(b => b.classList.toggle("ativa", Number(b.dataset.nota) === v));
    atualizarResumo();
  };
  itens.forEach(it => {
    const hidden = $("input[type=hidden]", it);
    if (hidden.value !== "") $$(".av-rapida", it).forEach(b => b.classList.toggle("ativa", Number(b.dataset.nota) === Number(hidden.value)));
    $$(".av-step", it).forEach(b => b.addEventListener("click", () => {
      const atual = hidden.value === "" ? 6 - Number(b.dataset.step) : Number(hidden.value); // vazio começa em 6
      definir(it, atual + Number(b.dataset.step));
    }));
    $$(".av-rapida", it).forEach(b => b.addEventListener("click", () => definir(it, Number(b.dataset.nota))));
  });
  atualizarResumo();

  $("#btn-save-avaliacao", root)?.addEventListener("click", async (e) => {
    const map = { ...(jogo.avaliacoesJogadores || {}) };
    const jaNaPartida = idsDaPartida(jogo);
    const entraram = [];   // avaliados que só tinham confirmado presença
    todosParaAvaliar.forEach(a => {
      const hidden = $(`input[data-rating="av-${a.id}"]`, root);
      const val = hidden?.value !== "" && hidden?.value != null ? Number(hidden.value) : null;
      if (val === null) return;
      if (!jaNaPartida.has(a.id)) entraram.push(a.id);
      const atual = map[a.id];
      if (atual && typeof atual.nota === "number"){
        // Formato antigo (nota única, sem votante identificado) — preserva a
        // nota antiga como um voto "legado" e adiciona o novo voto por cima,
        // em vez de perder o dado.
        map[a.id] = { _legado: { nota: atual.nota }, [votanteId]: { nota: val } };
      } else {
        map[a.id] = { ...(atual || {}), [votanteId]: { nota: val } };
      }
    });
    e.target.disabled = true;
    try{
      const campos = { avaliacoesJogadores: map };
      // Quem recebeu nota jogou: entra nos relacionados para contar a partida disputada.
      if (entraram.length) campos.relacionados = [...new Set([...(jogo.relacionados || []), ...entraram])];
      await updateJogoField(jogo.id, campos);
      toast("Avaliações salvas.", "ok");
    }catch(err){
      console.error(err);
      toast("Erro ao salvar: " + err.message, "err");
    }
    e.target.disabled = false;
  });
}
