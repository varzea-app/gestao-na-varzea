import { TEAM, hashtags } from "../tenant.js";
import { $, $$, escapeHtml, formatDate, formatDateLong, openModal, closeModal, fmt1, avg, reRenderKeepingFocus, toast } from "../utils.js";
import { resultadoJogo, desempateJogo, normalizeEscalacao, notasDoAtletaNoJogo, jogosRealizados, mediaNotaJogadoresNoJogo, GOL_CONTRA_ID, agruparConfrontos, rotuloQuadro, jogosPorConfronto } from "../stats.js";
import { getFiltroPeriodo, setFiltroPeriodo, filtrarPorPeriodo, anosDisponiveis, MESES, filtrarPorQuadro, quadroChipsHtml, wireQuadroChips, contarPorConfronto } from "../filters.js";
import { abrevPosicao } from "./escalacao-ideal.js";
import { openImagemModal } from "./flyer.js";
import { ordemPosicao } from "../modalidade.js";


let searchHistorico = "";
let ordemHistorico = "recentes"; // recentes | antigos | nota | saldo
let sumulaAberta = null; // evita reabrir a súmula a cada atualização dos dados

// Qualquer mudança de endereço libera a súmula para abrir de novo.
window.addEventListener("hashchange", () => { sumulaAberta = null; });

const RES_INFO = {
  vitoria: { letra: "V", cls: "res-v", nome: "Vitória" },
  empate: { letra: "E", cls: "res-e", nome: "Empate" },
  derrota: { letra: "D", cls: "res-d", nome: "Derrota" },
};

function plural(n, um, varios){ return `${n} ${n === 1 ? um : varios}`; }

export function renderHistorico(root, state, subId){
  wireQuadroChips(root, () => renderHistorico(root, state, subId));
  const filtro = getFiltroPeriodo();
  const todosRealizados = [...jogosRealizados(filtrarPorQuadro(state.jogos))].sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  const anos = anosDisponiveis(todosRealizados);
  const doPeriodo = filtrarPorPeriodo(todosRealizados, filtro);

  const nomeAdv = id => state.adversarios.find(a => a.id === id)?.nome || "?";
  const nomeCampo = id => state.campos.find(c => c.id === id)?.nome || "?";
  const nomeAtleta = id => id === GOL_CONTRA_ID ? "gol contra" : (state.atletas.find(a => a.id === id)?.nome || "?");

  const termo = searchHistorico.toLowerCase();
  const realizados = termo
    ? doPeriodo.filter(j => nomeAdv(j.adversarioId).toLowerCase().includes(termo) || nomeCampo(j.campoId).toLowerCase().includes(termo))
    : doPeriodo;

  // No "Geral" com quadros, cada confronto vira UMA linha (placar somado dos quadros).
  const porConfronto = contarPorConfronto(realizados);
  const unidades = porConfronto ? jogosPorConfronto(realizados) : realizados;
  const nota = j => {
    if (j.jogosOriginais){
      const ns = j.jogosOriginais.map(o => mediaNotaJogadoresNoJogo(o).media).filter(n => n !== null);
      return ns.length ? avg(ns) : null;
    }
    return mediaNotaJogadoresNoJogo(j).media;
  };
  const saldo = j => (j.placarNos ?? 0) - (j.placarAdversario ?? 0);
  let lista = [...unidades];
  if (ordemHistorico === "antigos") lista.sort((a, b) => (a.data || "").localeCompare(b.data || ""));
  else if (ordemHistorico === "nota") lista.sort((a, b) => (nota(b) ?? -1) - (nota(a) ?? -1));
  else if (ordemHistorico === "saldo") lista.sort((a, b) => saldo(b) - saldo(a));
  const porData = ordemHistorico === "recentes" || ordemHistorico === "antigos";

  // ---- Manchete do período ----
  const cont = { vitoria: 0, empate: 0, derrota: 0 };
  let gp = 0, gc = 0;
  unidades.forEach(j => { const r = resultadoJogo(j); if (r) cont[r]++; });
  realizados.forEach(j => { gp += j.placarNos || 0; gc += j.placarAdversario || 0; });
  const goleada = [...unidades].filter(j => saldo(j) > 0).sort((a, b) => saldo(b) - saldo(a) || (b.data || "").localeCompare(a.data || ""))[0];
  const melhorNota = [...unidades].filter(j => nota(j) !== null).sort((a, b) => nota(b) - nota(a))[0];
  const periodoTxt = [filtro.mes ? MESES[Number(filtro.mes) - 1] : "", filtro.ano || ""].filter(Boolean).join(" de ") || "Toda a história";
  const manchete = realizados.length ? `
    <div class="manchete">
      <div class="manchete-eyebrow">${escapeHtml(periodoTxt)}</div>
      <div class="manchete-titulo">${porConfronto ? `${plural(unidades.length, "confronto", "confrontos")} (${plural(realizados.length, "partida", "partidas")})` : plural(realizados.length, "partida", "partidas")}: ${plural(cont.vitoria, "vitória", "vitórias")}, ${plural(cont.empate, "empate", "empates")} e ${plural(cont.derrota, "derrota", "derrotas")}</div>
      <div class="manchete-sub">${plural(gp, "gol marcado", "gols marcados")} e ${gc} sofrido${gc === 1 ? "" : "s"}${goleada ? ` · maior vitória: ${goleada.placarNos} x ${goleada.placarAdversario} contra ${escapeHtml(nomeAdv(goleada.adversarioId))}` : ""}${melhorNota ? ` · melhor atuação coletiva: nota ${fmt1(nota(melhorNota))} contra ${escapeHtml(nomeAdv(melhorNota.adversarioId))}` : ""}</div>
    </div>` : "";

  // ---- Cartões ----
  const cartao = (j) => {
    const r = resultadoJogo(j);
    const info = RES_INFO[r];
    const gols = {};
    (j.jogosOriginais || [j]).flatMap(o => o.golsAssistencias || []).forEach(e => { if (e.atletaGolId) gols[e.atletaGolId] = (gols[e.atletaGolId] || 0) + 1; });
    const golsTxt = Object.entries(gols).map(([id, n]) => `${nomeAtleta(id)}${n > 1 ? ` ${n}` : ""}`).join(", ");
    const n = nota(j);
    return `
      <div class="hist-card" data-id="${j.id}"${j.jogosOriginais ? ` data-grupo="${j.jogosOriginais.map(o => o.id).join(",")}"` : ""}>
        <div class="hist-res ${info ? info.cls : ""}" title="${info ? info.nome : ""}">${info ? info.letra : "—"}</div>
        <div class="hist-info">
          <div class="hist-adv">${escapeHtml(nomeAdv(j.adversarioId))}${j.jogosOriginais ? ` <span class="badge badge-pending">confronto · ${j.jogosOriginais.length} quadros</span>` : (rotuloQuadro(j) ? ` <span class="badge badge-pending">${rotuloQuadro(j)}</span>` : "")}</div>
          <div class="hist-meta">${formatDate(j.data)} · ${escapeHtml(nomeCampo(j.campoId))}${desempateJogo(j) ? ` · ${escapeHtml(desempateJogo(j).texto)}` : ""}</div>
          ${j.jogosOriginais ? `<div class="hist-meta hist-quadros">${j.jogosOriginais.map(o => `<span class="hist-quadro" data-jogo="${o.id}" data-grupo="${j.jogosOriginais.map(x => x.id).join(",")}">${rotuloQuadro(o) || "Jogo"} ${o.placarNos ?? "–"}x${o.placarAdversario ?? "–"}</span>`).join(" · ")}</div>` : ""}
          ${golsTxt ? `<div class="hist-gols">⚽ ${escapeHtml(golsTxt)}</div>` : ""}
        </div>
        <div class="hist-placar">
          <div class="hist-placar-val">${j.placarNos ?? "–"} x ${j.placarAdversario ?? "–"}</div>
          ${n !== null ? `<div class="hist-nota">nota ${fmt1(n)}</div>` : ""}
        </div>
      </div>`;
  };

  let corpo = "";
  if (!lista.length){
    corpo = `<div class="empty-state"><h3>Nenhuma partida</h3><p>${termo ? `Nada encontrado para "${escapeHtml(searchHistorico)}".` : "Nenhuma partida realizada para o período selecionado."}</p></div>`;
  } else if (porData){
    const grupos = [];
    lista.forEach(j => {
      const chave = (j.data || "").slice(0, 7);
      let g = grupos[grupos.length - 1];
      if (!g || g.chave !== chave){ g = { chave, jogos: [] }; grupos.push(g); }
      g.jogos.push(j);
    });
    corpo = grupos.map(g => {
      const c = { vitoria: 0, empate: 0, derrota: 0 };
      const unidadesMes = g.jogos;
      unidadesMes.forEach(j => { const r = resultadoJogo(j); if (r) c[r]++; });
      const [a, m] = g.chave.split("-").map(Number);
      return `
        <div class="hist-mes">${MESES[m - 1]} de ${a} <span>${porConfronto ? plural(unidadesMes.length, "confronto", "confrontos") : plural(g.jogos.length, "jogo", "jogos")} · ${c.vitoria}V ${c.empate}E ${c.derrota}D</span></div>
        ${g.jogos.map(cartao).join("")}`;
    }).join("");
  } else {
    corpo = lista.map(cartao).join("");
  }

  root.innerHTML = `
    <div class="topbar">
      <div><div class="eyebrow">Relatórios</div><h1>Histórico</h1></div>
      <a href="#relatorios" class="btn btn-ghost btn-sm">&larr; Relatórios</a>
    </div>

    ${quadroChipsHtml(state.jogos)}
    ${manchete}

    <div class="rank-filtros">
      <div class="field">
        <label>Ano</label>
        <select id="filtro-ano">
          <option value="">Todos</option>
          ${anos.map(a => `<option value="${a}" ${a === filtro.ano ? "selected" : ""}>${a}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Mês</label>
        <select id="filtro-mes">
          <option value="">Todos</option>
          ${MESES.map((m, idx) => {
            const val = String(idx + 1).padStart(2, "0");
            return `<option value="${val}" ${val === filtro.mes ? "selected" : ""}>${m}</option>`;
          }).join("")}
        </select>
      </div>
      <div class="field">
        <label>Ordenar por</label>
        <select id="ordem-hist">
          <option value="recentes" ${ordemHistorico === "recentes" ? "selected" : ""}>Mais recentes</option>
          <option value="antigos" ${ordemHistorico === "antigos" ? "selected" : ""}>Mais antigos</option>
          <option value="nota" ${ordemHistorico === "nota" ? "selected" : ""}>Melhor nota da partida</option>
          <option value="saldo" ${ordemHistorico === "saldo" ? "selected" : ""}>Maior saldo de gols</option>
        </select>
      </div>
      <div class="field">
        <label>Buscar por adversário/campo</label>
        <input type="text" id="input-busca" placeholder="Digite pra filtrar…" value="${escapeHtml(searchHistorico)}">
      </div>
    </div>

    ${corpo}
  `;

  $("#input-busca", root)?.addEventListener("input", (e) => {
    searchHistorico = e.target.value;
    reRenderKeepingFocus(root, () => renderHistorico(root, state));
  });
  $("#ordem-hist", root)?.addEventListener("change", (e) => { ordemHistorico = e.target.value; renderHistorico(root, state); });

  // Confronto (Geral): abre a súmula do 2º quadro (o 1º jogado) com abas para o outro quadro.
  const abrirGrupo = (ids, primeiroId) => {
    const grupo = ids.map(id => state.jogos.find(j => j.id === id)).filter(Boolean)
      .sort((a, b) => (b.quadro || "").localeCompare(a.quadro || ""));
    const alvo = grupo.find(j => j.id === primeiroId) || grupo[0];
    if (alvo) openSumulaModal(alvo, state, grupo.length > 1 ? grupo : null);
  };
  $$(".hist-quadro[data-jogo]", root).forEach(el => {
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      abrirGrupo(el.dataset.grupo.split(","), el.dataset.jogo);
    });
  });
  $$(".hist-card[data-id]", root).forEach(el => {
    el.addEventListener("click", () => {
      if (el.dataset.grupo) return abrirGrupo(el.dataset.grupo.split(","), null);
      const jogo = state.jogos.find(j => j.id === el.dataset.id);
      if (jogo) openSumulaModal(jogo, state);
    });
  });

  $("#filtro-ano", root)?.addEventListener("change", (e) => { setFiltroPeriodo({ ano: e.target.value }); reRenderKeepingFocus(root, () => renderHistorico(root, state)); });
  $("#filtro-mes", root)?.addEventListener("change", (e) => { setFiltroPeriodo({ mes: e.target.value }); reRenderKeepingFocus(root, () => renderHistorico(root, state)); });

  // Link direto para a súmula: #historico/<id do jogo>
  if (subId && sumulaAberta !== subId){
    const jogo = state.jogos.find(j => j.id === subId && j.status === "realizado");
    sumulaAberta = subId;
    if (jogo) openSumulaModal(jogo, state);
  }
}

// Ordena entradas de escalação por posição (GOL, ZAG, LAT, VOL, MEI, ATA) —
// quem não tem posição informada (jogos antigos) fica no final, na ordem original.
function ordenarEntriesPorPosicao(entries){
  return [...entries].sort((a, b) => {
    const oa = ordemPosicao(a.posicao);
    const ob = ordemPosicao(b.posicao);
    return oa - ob;
  });
}

// Imagem (PNG) da súmula para compartilhar: mesmo modal das outras imagens do app
// (fundo e formato à escolha). Mostra o placar, os gols e as duas escalações com
// a nota de cada jogador.
function compartilharImagemSumula(jogo, adv, campo, eventos, entriesInicial, entriesFinal, mediaPorAtleta, nome){
  const r = resultadoJogo(jogo);
  const resultadoLabel = { vitoria: "Vitória", empate: "Empate", derrota: "Derrota" }[r] || "";
  const advNome = adv?.nome || "Adversário";
  const rotQuadro = rotuloQuadro(jogo);
  const legenda = [`⚽ Súmula — ${TEAM.nome} ${jogo.placarNos ?? "–"} x ${jogo.placarAdversario ?? "–"} ${advNome}${rotQuadro ? ` (${rotQuadro})` : ""}`,
    `📅 ${formatDateLong(jogo.data)}${campo?.nome ? ` · 📍 ${campo.nome}` : ""}`, "", hashtags()].join("\n");

  openImagemModal({
    titulo: "Imagem da súmula",
    arquivo: `sumula-${jogo.data || "jogo"}`,
    legenda,
    render: (e) => {
      const { T, A, H, base, cantos, topo, rodape } = e;
      // Tamanho das linhas se ajusta à quantidade de gols e de jogadores para tudo caber.
      const gCols = eventos.length > 6 ? 2 : 1;
      const gRows = Math.max(1, Math.ceil(eventos.length / gCols));
      const nEsc = Math.max(1, entriesInicial.length, entriesFinal.length);
      const disponivel = H - 160 - 96 - 90 - 300 - 50 - 110 - 100 - 70;
      const rowH = Math.max(30, Math.min(54, Math.floor(disponivel / (gRows + nEsc))));
      const fs = Math.round(rowH * 0.52);
      const placarFs = gRows + nEsc > 15 ? 150 : 190; // jogos com muita gente: placar um pouco menor
      const linha = `border-bottom:2px solid ${A}33;`;
      const golsHtml = eventos.length === 0
        ? `<div style="font-size:${fs}px; color:${T.muted};">Nenhum gol registrado.</div>`
        : `<div style="display:grid; grid-template-columns:${gCols === 2 ? "1fr 1fr" : "1fr"}; column-gap:36px; width:100%;">${eventos.map(ev => `
            <div style="display:flex; align-items:center; gap:12px; height:${rowH}px; ${linha} font-size:${fs}px; min-width:0;">
              <span style="font-weight:800; color:${A}; width:${Math.round(fs * 2.4)}px; flex-shrink:0;">${ev.minuto ?? "–"}'</span>
              <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">⚽ ${nome(ev.atletaGolId)}${ev.atletaAssistId ? ` <span style="color:${T.muted};">(${nome(ev.atletaAssistId)})</span>` : ""}</span>
            </div>`).join("")}</div>`;
      const coluna = (titulo, entries) => `
        <div style="flex:1; min-width:0;">
          <div style="font-family:'Bebas Neue',sans-serif; font-size:${Math.round(fs * 1.5)}px; letter-spacing:.12em; color:${A}; margin-bottom:6px;">${titulo}</div>
          ${entries.length ? entries.map(en => {
            const m = mediaPorAtleta[en.atletaId];
            return `<div style="display:flex; align-items:center; gap:10px; height:${rowH}px; ${linha} font-size:${fs}px;">
              <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${nome(en.atletaId)}</span>
              ${en.posicao ? `<span style="color:${T.muted}; font-size:${Math.round(fs * 0.75)}px;">${escapeHtml(abrevPosicao(en.posicao))}</span>` : ""}
              <span style="font-weight:800; color:${A}; min-width:${Math.round(fs * 2)}px; text-align:right;">${m != null ? fmt1(m) : "—"}</span>
            </div>`;
          }).join("") : `<div style="font-size:${fs}px; color:${T.muted};">Não informada.</div>`}
        </div>`;
      const sec = (t) => `<div style="font-family:'Bebas Neue',sans-serif; font-size:${Math.round(fs * 1.5)}px; letter-spacing:.12em; color:${A}; margin-bottom:6px;">${t}</div>`;
      return `<div style="${base}">${cantos}${topo}
        <div style="text-align:center; width:100%;">
          <div style="font-family:'Bebas Neue',sans-serif; font-size:84px; letter-spacing:.16em; color:${A}; line-height:1;">SÚMULA${rotQuadro ? ` · ${escapeHtml(rotQuadro.toUpperCase())}` : ""}</div>
          <div style="font-size:30px; color:${T.muted2}; margin-top:6px;">${escapeHtml(formatDateLong(jogo.data))}</div>
          <div style="display:flex; align-items:center; justify-content:center; gap:36px; margin-top:18px;">
            <div style="flex:1; text-align:center; min-width:0;">
              <div style="font-family:'Bebas Neue',sans-serif; font-size:46px; letter-spacing:.06em; line-height:1.05;">${TEAM.nomeUpperHtml}</div>
              <div style="font-family:'Bebas Neue',sans-serif; font-size:${placarFs}px; line-height:1; color:${A};">${jogo.placarNos ?? "–"}</div>
            </div>
            <div style="font-family:'Bebas Neue',sans-serif; font-size:70px; color:${T.muted};">X</div>
            <div style="flex:1; text-align:center; min-width:0;">
              <div style="font-family:'Bebas Neue',sans-serif; font-size:46px; letter-spacing:.06em; line-height:1.05;">${escapeHtml(advNome.toUpperCase())}</div>
              <div style="font-family:'Bebas Neue',sans-serif; font-size:${placarFs}px; line-height:1; color:${A};">${jogo.placarAdversario ?? "–"}</div>
            </div>
          </div>
          <div style="font-size:28px; color:${T.muted2}; margin-top:4px;">📍 ${escapeHtml(campo?.nome || "—")}${resultadoLabel ? ` · ${resultadoLabel}` : ""}${desempateJogo(jogo) ? ` · ${escapeHtml(desempateJogo(jogo).texto)}` : ""}</div>
        </div>
        <div style="width:100%;">${sec("GOLS E ASSISTÊNCIAS")}${golsHtml}</div>
        <div style="width:100%; display:flex; gap:40px;">${coluna("ESCALAÇÃO INICIAL", entriesInicial)}${coluna("ESCALAÇÃO FINAL", entriesFinal)}</div>
        ${rodape}
      </div>`;
    },
  });
}

// Topo da súmula de um confronto: placar somado dos quadros + abas (2º quadro, 1º quadro).
function confrontoCabecalhoHtml(jogoAtual, grupo, state){
  const conf = jogosPorConfronto(grupo)[0];
  const r = resultadoJogo(conf);
  const info = RES_INFO[r];
  return `
    <div class="confronto-cab" style="margin-bottom:16px;">
      <div style="font-size:12px; color:var(--ink-soft); margin-bottom:8px;">
        Confronto · ${conf.placarNos ?? "–"} x ${conf.placarAdversario ?? "–"}${info ? ` · ${info.nome}` : ""}
      </div>
      <div class="rank-chips">
        ${grupo.map(g => `<button class="rank-chip ${g.id === jogoAtual.id ? "active" : ""}" data-aba-jogo="${g.id}" type="button">${rotuloQuadro(g) || "Jogo"} · ${g.placarNos ?? "–"} x ${g.placarAdversario ?? "–"}</button>`).join("")}
      </div>
    </div>`;
}

function openSumulaModal(jogo, state, grupo = null){
  const adv = state.adversarios.find(a => a.id === jogo.adversarioId);
  const campo = state.campos.find(c => c.id === jogo.campoId);
  const nome = id => id === GOL_CONTRA_ID ? "Gol contra (adversário)" : escapeHtml(state.atletas.find(a => a.id === id)?.nome || "?");
  const eventos = jogo.golsAssistencias || [];

  const eventosHtml = eventos.length === 0
    ? `<p style="color:var(--ink-faint); font-size:13px;">Nenhum gol registrado.</p>`
    : eventos.map(e => {
        const meta = [e.tipoGol, e.tempo].filter(Boolean).map(escapeHtml).join(" · ");
        return `
      <div class="event-row">
        <span class="event-min">${e.minuto ?? "–"}'</span>
        <span>⚽ ${nome(e.atletaGolId)}${e.atletaAssistId ? ` <span style="color:var(--ink-soft);">(assist. ${nome(e.atletaAssistId)})</span>` : ""}${meta ? ` <span style="color:var(--ink-faint); font-size:11px;">— ${meta}</span>` : ""}</span>
      </div>`;
      }).join("");

  const entriesInicial = ordenarEntriesPorPosicao(normalizeEscalacao(jogo.escalacaoInicial));
  const entriesFinal = ordenarEntriesPorPosicao(normalizeEscalacao(jogo.escalacaoFinal));

  // Nota média de cada atleta avaliado nessa partida — usada tanto na lista
  // "Nota média dos jogadores" quanto ao lado de cada nome nas duas escalações
  // (repete a nota em ambas quando o jogador aparece nas duas listas).
  const mediaPorAtleta = {};
  const qtdPorAtleta = {};
  Object.keys(jogo.avaliacoesJogadores || {}).forEach(id => {
    const notas = notasDoAtletaNoJogo(jogo, id);
    mediaPorAtleta[id] = avg(notas);
    qtdPorAtleta[id] = notas.length;
  });

  const listaEscalacaoHtml = (entries) => {
    if (!entries.length) return `<p style="color:var(--ink-faint); font-size:13px;">Não informada.</p>`;
    return entries.map(e => {
      const media = mediaPorAtleta[e.atletaId];
      return `
      <div class="event-row">
        <span class="ev-name">${nome(e.atletaId)}</span>
        ${e.posicao ? `<span class="ev-pos">${escapeHtml(abrevPosicao(e.posicao))}</span>` : ""}
        <span class="ev-nota">${media != null ? fmt1(media) : "—"}</span>
      </div>`;
    }).join("");
  };

  const notasAtletas = Object.keys(mediaPorAtleta)
    .map(id => ({ id, media: mediaPorAtleta[id], qtd: qtdPorAtleta[id] }))
    .filter(x => x.media !== null)
    .sort((a, b) => b.media - a.media);

  const notasHtml = notasAtletas.length === 0
    ? `<p style="color:var(--ink-faint); font-size:13px;">Sem avaliações registradas.</p>`
    : notasAtletas.map(x => `
        <div class="event-row"><span>${nome(x.id)}</span><span class="pill-num" style="margin-left:auto;">${fmt1(x.media)} <span style="color:var(--ink-faint); font-weight:400;">(${x.qtd})</span></span></div>`).join("");

  openModal(`
    <div class="modal-head">
      <h3>Súmula da partida</h3>
      <div style="display:flex; align-items:center; gap:6px;">
        ${state.isAuthorized ? `<button class="btn-icon-share" id="btn-share-sumula" type="button" title="Compartilhar imagem da súmula" aria-label="Compartilhar imagem da súmula">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </button>` : ""}
        <button class="modal-close" data-close>&times;</button>
      </div>
    </div>
    <div class="modal-body">
      ${grupo ? confrontoCabecalhoHtml(jogo, grupo, state) : ""}
      <div class="sumula" style="margin-bottom:20px;">
        <div class="sumula-side"><div class="team">${TEAM.nomeHtml}</div><div class="score">${jogo.placarNos ?? "–"}</div></div>
        <div class="sumula-mid"><div class="vs">VS</div><div class="date">${formatDateLong(jogo.data)}</div></div>
        <div class="sumula-side"><div class="team">${escapeHtml(adv?.nome || "?")}</div><div class="score">${jogo.placarAdversario ?? "–"}</div></div>
        <div class="sumula-meta"><span>📍 ${escapeHtml(campo?.nome || "—")}</span>${desempateJogo(jogo) ? `<span>⚖️ ${escapeHtml(desempateJogo(jogo).texto)}</span>` : ""}<span>Realizado</span></div>
      </div>

      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
        <h4 style="font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--ink-soft); margin:0;">Gols e assistências</h4>
        <div style="display:flex; gap:14px; font-size:12px; color:var(--ink-soft);">
          <span>🏟️ Campo: <strong style="color:var(--ink);">${fmt1(jogo.avaliacaoCampo?.nota)}</strong></span>
          <span>🆚 Adversário: <strong style="color:var(--ink);">${fmt1(jogo.avaliacaoAdversario?.nota)}</strong></span>
        </div>
      </div>
      ${eventosHtml}

      <div class="sumula-list" style="margin-top:20px;">
        <div>
          <h4>Escalação inicial</h4>
          ${listaEscalacaoHtml(entriesInicial)}
        </div>
        <div>
          <h4>Escalação final</h4>
          ${listaEscalacaoHtml(entriesFinal)}
        </div>
      </div>

      <h4 style="font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--ink-soft); margin:20px 0 8px;">Nota média dos jogadores</h4>
      ${notasHtml}
    </div>
  `, { wide: true });

  $$("[data-close]").forEach(b => b.addEventListener("click", closeModal));
  $$("[data-aba-jogo]").forEach(b => b.addEventListener("click", () => {
    const outro = grupo.find(g => g.id === b.dataset.abaJogo);
    if (outro) openSumulaModal(outro, state, grupo);
  }));

  $("#btn-share-sumula")?.addEventListener("click", () => {
    compartilharImagemSumula(jogo, adv, campo, eventos, entriesInicial, entriesFinal, mediaPorAtleta, nome);
  });
}
