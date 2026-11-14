// Filtro de período (ano/mês) compartilhado entre Dashboard e Histórico.
// É um estado simples em memória (não React, sem pub/sub): como só uma tela
// fica montada por vez nessa SPA, mudar o filtro numa tela e navegar para a
// outra já mostra o mesmo período selecionado — e cada tela pode alterá-lo
// independentemente a partir daí.
let filtro = { ano: "", mes: "" };

export function getFiltroPeriodo(){
  return { ...filtro };
}

export function setFiltroPeriodo(parcial){
  filtro = { ...filtro, ...parcial };
}

export const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export function anosDisponiveis(jogos){
  return [...new Set(jogos.map(j => (j.data || "").slice(0, 4)).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a));
}

export function filtrarPorPeriodo(jogos, filtroObj = filtro){
  return jogos.filter(j => {
    const ano = (j.data || "").slice(0, 4);
    const mes = (j.data || "").slice(5, 7);
    if (filtroObj.ano && ano !== filtroObj.ano) return false;
    if (filtroObj.mes && mes !== filtroObj.mes) return false;
    return true;
  });
}

// ----------------------------------------------------------------------------
// Filtro de quadro (futsal, dois quadros): Geral | 1º quadro | 2º quadro.
// Compartilhado entre as telas de estatística, como o filtro de período.
// "Geral" = todos os jogos; "1"/"2" = só os jogos daquele quadro.
// ----------------------------------------------------------------------------
let filtroQuadro = "";

export function getFiltroQuadro(){ return filtroQuadro; }
export function setFiltroQuadro(v){ filtroQuadro = v === "1" || v === "2" ? v : ""; }

export function filtrarPorQuadro(jogos){
  return filtroQuadro ? jogos.filter(j => j.quadro === filtroQuadro) : jogos;
}

// Chips do filtro; só aparecem quando existe algum jogo com quadro.
export function quadroChipsHtml(jogos){
  if (!(jogos || []).some(j => j.quadro)) return "";
  const itens = [["", "Geral"], ["1", "1º quadro"], ["2", "2º quadro"]];
  return `<div class="rank-chips quadro-chips">${itens.map(([v, l]) =>
    `<button class="rank-chip ${filtroQuadro === v ? "active" : ""}" data-quadro="${v}" type="button">${l}</button>`).join("")}</div>`;
}

// Liga os chips (delegação de evento; o listener é criado uma vez por container
// e a função de re-render é trocada a cada tela).
export function wireQuadroChips(root, rerender){
  root._quadroRerender = rerender;
  if (root._quadroWired) return;
  root._quadroWired = true;
  root.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-quadro]");
    if (!b || !root.contains(b)) return;
    setFiltroQuadro(b.dataset.quadro);
    if (root._quadroRerender) root._quadroRerender();
  });
}
