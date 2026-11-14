import { TEAM, hashtags } from "../tenant.js";
import { escapeHtml, formatDateLong, toast } from "../utils.js";
import { openImagemModal } from "./flyer.js";
import { ordemPosicao, siglaPosicao } from "../modalidade.js";
import { rotuloQuadro } from "../stats.js";

// ============================================================================
// Imagem dos confirmados (ou relacionados) para a próxima partida. Só para a
// equipe: o botão aparece apenas em telas de quem tem e-mail cadastrado.
// Escolhas na tela: fundo, formato, moldura, lista, frase na imagem e legenda.
// ============================================================================

function listaDe(modo, jogo, atletas, presencas){
  const porId = new Map(atletas.map(a => [a.id, a]));
  const resp = new Map((presencas || []).map(p => [p.atletaId, p.resposta]));
  let ids;
  if (modo === "relacionados") ids = jogo.relacionados || [];
  else if (modo === "vou_talvez") ids = [...resp].filter(([, r]) => r === "vou" || r === "talvez").map(([id]) => id);
  else ids = [...resp].filter(([, r]) => r === "vou").map(([id]) => id);
  return ids.map(id => porId.get(id)).filter(Boolean)
    .map(a => ({ id: a.id, nome: a.nome, pos: a.posicao || "", talvez: modo === "vou_talvez" && resp.get(a.id) === "talvez" }))
    .sort((x, y) => ordemPosicao(x.pos) - ordemPosicao(y.pos) || x.nome.localeCompare(y.nome, "pt-BR"));
}

export function abrirImagemConfirmados(state, jogo, presencas){
  if (!state.isAuthorized){ toast("Só a equipe pode gerar imagens.", "err"); return; }
  const adv = state.adversarios.find(a => a.id === jogo.adversarioId);
  const campo = state.campos.find(c => c.id === jogo.campoId);
  const advNome = adv?.nome || "Adversário";
  const rot = rotuloQuadro(jogo);
  const nVou = listaDe("vou", jogo, state.atletas, presencas).length;
  const nTalvez = listaDe("vou_talvez", jogo, state.atletas, presencas).length - nVou;
  const nRel = listaDe("relacionados", jogo, state.atletas, presencas).length;

  const opcoes = [{ value: "vou", label: `Confirmados (${nVou})` }];
  if (nTalvez > 0) opcoes.push({ value: "vou_talvez", label: `Confirmados + talvez (${nVou + nTalvez})` });
  if (nRel > 0) opcoes.push({ value: "relacionados", label: `Relacionados do jogo (${nRel})` });

  const quando = [formatDateLong(jogo.data), jogo.horario].filter(Boolean).join(" · ");
  const legenda = (modo, { frase } = {}) => {
    const lista = listaDe(modo, jogo, state.atletas, presencas);
    const titulo = modo === "relacionados" ? "Relacionados" : "Confirmados";
    return [
      `✅ ${titulo} para ${TEAM.nome}${rot ? ` (${rot})` : ""} x ${advNome}`,
      frase ? `💬 ${frase}` : null,
      `📅 ${quando}`,
      campo?.nome ? `📍 ${campo.nome}` : null,
      "",
      ...(lista.length ? lista.map(j => `• ${siglaPosicao(j.pos) || "---"} - ${j.nome}${j.talvez ? " (talvez)" : ""}`) : ["(ninguém na lista ainda)"]),
      "",
      hashtags(),
    ].filter(l => l !== null).join("\n");
  };

  openImagemModal({
    titulo: "Imagem dos confirmados",
    arquivo: `confirmados-${jogo.data || "jogo"}`,
    selecao: { label: "Lista", opcoes, padrao: "vou" },
    extras: {
      moldura: true, frase: "Ex.: Bora pra cima!", legendaEditavel: true,
      modelo: { label: "Modelo", padrao: "colunas", opcoes: [{ value: "colunas", label: "Duas colunas" }, { value: "escudo", label: "Uma coluna com escudo" }] },
    },
    legenda,
    render: (e) => {
      const { T, A, H, base, cantos, topo, rodape, selecaoId, modeloId, frase } = e;
      const lista = listaDe(selecaoId || "vou", jogo, state.atletas, presencas);
      const n = lista.length;
      const story = H > 1500;
      const titulo = selecaoId === "relacionados" ? "RELACIONADOS" : "CONFIRMADOS";
      const cabecalho = `
        <div style="text-align:center; width:100%;">
          <div style="font-family:'Bebas Neue',sans-serif; font-size:110px; letter-spacing:.14em; color:${A}; line-height:1;">${titulo}</div>
          <div style="font-family:'Bebas Neue',sans-serif; font-size:56px; letter-spacing:.05em; margin-top:8px;">${TEAM.nomeUpperHtml}${rot ? ` (${escapeHtml(rot.toUpperCase())})` : ""} <span style="color:${A};">X</span> ${escapeHtml(advNome.toUpperCase())}</div>
          <div style="font-size:30px; color:${T.muted2}; margin-top:8px;">${escapeHtml(quando)}${campo?.nome ? ` · ${escapeHtml(campo.nome)}` : ""}</div>
          ${frase ? `<div style="font-size:38px; font-weight:800; font-style:italic; color:${A}; margin-top:18px;">${escapeHtml(frase)}</div>` : ""}
        </div>`;
      const total = `
        <div style="text-align:center;">
          <div style="font-family:'Bebas Neue',sans-serif; font-size:44px; letter-spacing:.1em; color:${T.muted2}; margin-bottom:8px;">${n} ${selecaoId === "relacionados" ? (n === 1 ? "RELACIONADO" : "RELACIONADOS") : (n === 1 ? "CONFIRMADO" : "CONFIRMADOS")}</div>
          ${rodape}
        </div>`;
      const reservado = 160 + 96 + 260 + (frase ? 80 : 0) + 100;
      const vazio = `<div style="font-size:34px; color:${T.muted}; padding:40px 0;">Ninguém na lista ainda.</div>`;

      if (modeloId === "escudo"){
        // Nomes grandes à esquerda (sigla + nome) e o escudo do time à direita.
        const rowH = Math.max(34, Math.min(story ? 120 : 84, Math.floor((H - reservado) / Math.max(1, n))));
        const fs = Math.round(rowH * 0.8);
        const itens = lista.map(j => `
          <div style="display:flex; align-items:baseline; gap:20px; height:${rowH}px; overflow:hidden;">
            <span style="font-family:'Bebas Neue',sans-serif; font-size:${Math.round(fs * 0.8)}px; color:${A}; width:${Math.round(fs * 1.9)}px; flex-shrink:0; letter-spacing:.06em;">${escapeHtml(siglaPosicao(j.pos) || "---")}</span>
            <span style="font-family:'Bebas Neue',sans-serif; font-size:${fs}px; line-height:1.05; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(j.nome.toUpperCase())}${j.talvez ? ` <span style="font-size:${Math.round(fs * 0.55)}px; color:${T.muted};">(TALVEZ)</span>` : ""}</span>
          </div>`).join("");
        const esc = story ? 360 : 320;
        return `<div style="${base}">${cantos}${topo}${cabecalho}
          <div style="width:100%; display:flex; align-items:center; justify-content:space-between; gap:20px;">
            <div style="flex:1; min-width:0;">${n ? itens : vazio}</div>
            <div style="flex:0 0 ${esc + 20}px; display:flex; align-items:center; justify-content:center;">
              <img src="${TEAM.escudo}" style="width:${esc}px; height:${esc}px; border-radius:50%; object-fit:cover; box-shadow:0 0 0 6px ${A};">
            </div>
          </div>
          ${total}</div>`;
      }

      // Colunas: duas (ou três, com mais de 16 nomes), por posição.
      const cols = n > 16 ? 3 : 2;
      const rows = Math.max(1, Math.ceil(n / cols));
      const rowH = Math.max(34, Math.min(84, Math.floor((H - reservado) / rows)));
      const fs = Math.round(rowH * (cols === 3 ? 0.4 : 0.46));
      const item = (j) => `
        <div style="display:flex; align-items:center; gap:12px; height:${rowH}px; border-bottom:2px solid ${A}33; min-width:0;">
          <span style="font-family:'Bebas Neue',sans-serif; font-size:${Math.round(fs * 1.05)}px; letter-spacing:.08em; color:${A}; width:${Math.round(fs * 2.6)}px; flex-shrink:0;">${escapeHtml(siglaPosicao(j.pos) || "---")}</span>
          <span style="font-size:${fs}px; font-weight:700; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(j.nome)}${j.talvez ? ` <span style="font-weight:400; color:${T.muted};">(talvez)</span>` : ""}</span>
        </div>`;
      const corpo = n
        ? `<div style="display:grid; grid-auto-flow:column; grid-template-rows:repeat(${rows}, ${rowH}px); grid-template-columns:repeat(${cols}, 1fr); column-gap:34px; width:100%;">${lista.map(item).join("")}</div>`
        : vazio;
      return `<div style="${base}">${cantos}${topo}${cabecalho}${corpo}${total}</div>`;
    },
  });
}
