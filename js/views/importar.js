// Importar / exportar cadastros por planilha (Excel): Jogadores e Partidas.
// Fluxo: baixar o modelo → preencher no Excel → enviar → conferir a PRÉVIA →
// só então gravar. Linhas com erro nunca são gravadas; as demais entram.
import { TEAM } from "../tenant.js";
import { $, $$, escapeHtml, toast, dataISOLocal } from "../utils.js";
import { importarEmLote, novoIdDoc } from "../db.js";
import { CATEGORIAS_ATLETA } from "./cadastros.js";
import { TIPOS_PARTIDA } from "./jogos.js";

const MAX_LINHAS = 500;
const URL_EXCELJS = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";

// ----------------------------------------------------------------------------
// Leitor/gerador de Excel (carrega só quando a tela é usada)
// ----------------------------------------------------------------------------
let carregando = null;
function carregarExcelJS(){
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!carregando){
    carregando = new Promise((ok, falha) => {
      const s = document.createElement("script");
      s.src = URL_EXCELJS;
      s.onload = () => window.ExcelJS ? ok(window.ExcelJS) : (carregando = null, falha(new Error("Leitor de planilhas indisponível.")));
      s.onerror = () => { carregando = null; falha(new Error("Não foi possível carregar o leitor de planilhas. Verifique a internet e tente de novo.")); };
      document.head.appendChild(s);
    });
  }
  return carregando;
}

// ----------------------------------------------------------------------------
// Texto/valores das células
// ----------------------------------------------------------------------------
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const pad = (n) => String(n).padStart(2, "0");

function bruto(cell){
  let v = cell?.value;
  if (v && typeof v === "object" && !(v instanceof Date)){
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join("");
    if ("result" in v) return v.result;           // fórmula
    if ("text" in v) return v.text;               // link
    return "";
  }
  return v;
}
function texto(cell){
  const v = bruto(cell);
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

// Data: aceita célula de data do Excel, "15/11/2026", "2026-11-15" ou número de série.
function lerData(cell){
  const v = bruto(cell);
  if (v === null || v === undefined || v === "") return { vazio: true };
  let y, m, d;
  if (v instanceof Date){ y = v.getUTCFullYear(); m = v.getUTCMonth() + 1; d = v.getUTCDate(); }
  else if (typeof v === "number"){
    const dt = new Date(Math.round((v - 25569) * 86400000));
    y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
  } else {
    const t = String(v).trim();
    let r = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
    if (r){ d = +r[1]; m = +r[2]; y = +r[3]; }
    else if ((r = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))){ y = +r[1]; m = +r[2]; d = +r[3]; }
    else return { erro: `data "${t}" inválida (use dd/mm/aaaa)` };
  }
  const teste = new Date(Date.UTC(y, m - 1, d));
  if (y < 1990 || y > 2100 || teste.getUTCMonth() !== m - 1 || teste.getUTCDate() !== d) return { erro: "data inválida" };
  return { valor: `${y}-${pad(m)}-${pad(d)}` };
}

function lerHorario(cell){
  const v = bruto(cell);
  if (v === null || v === undefined || v === "") return { vazio: true };
  if (v instanceof Date) return { valor: `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}` };
  if (typeof v === "number" && v >= 0 && v < 1){
    const min = Math.round(v * 1440);
    return { valor: `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}` };
  }
  const r = String(v).trim().match(/^(\d{1,2})[:h](\d{2})$/i);
  if (r && +r[1] < 24 && +r[2] < 60) return { valor: `${pad(+r[1])}:${r[2]}` };
  return { erro: `horário "${String(v).trim()}" inválido (use HH:MM)` };
}

function lerInteiro(cell, rotulo){
  const t = texto(cell);
  if (t === "") return { vazio: true };
  const n = Number(String(t).replace(",", "."));
  if (!Number.isInteger(n) || n < 0 || n > 999) return { erro: `${rotulo} "${t}" deve ser um número inteiro (0 ou mais)` };
  return { valor: n };
}

function lerSimNao(cell, rotulo){
  const t = norm(texto(cell));
  if (t === "") return { vazio: true };
  if (["sim", "s", "x", "yes", "y", "1", "true", "verdadeiro"].includes(t)) return { valor: true };
  if (["nao", "n", "no", "0", "false", "falso"].includes(t)) return { valor: false };
  return { erro: `${rotulo} "${texto(cell)}" deve ser Sim ou Não` };
}

function lerMes(cell){
  const v = bruto(cell);
  if (v === null || v === undefined || v === "") return { vazio: true };
  if (v instanceof Date) return { valor: `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}` };
  const t = String(v).trim();
  let r = t.match(/^(\d{4})-(\d{1,2})$/);
  if (r && +r[2] >= 1 && +r[2] <= 12) return { valor: `${r[1]}-${pad(+r[2])}` };
  r = t.match(/^(\d{1,2})\/(\d{4})$/);
  if (r && +r[1] >= 1 && +r[1] <= 12) return { valor: `${r[2]}-${pad(+r[1])}` };
  return { erro: `mês "${t}" inválido (use AAAA-MM, por exemplo 2026-03)` };
}

// ----------------------------------------------------------------------------
// Colunas das abas
// ----------------------------------------------------------------------------
const COLS_JOGADORES = ["Nome *", "Nome completo", "Posição", "Número da camisa", "Ativo", "Direito a voto", "Pagante", "Paga desde (AAAA-MM)", "Observações"];
const COLS_PARTIDAS = ["Data *", "Horário", "Adversário *", "Campo *", "Tipo de partida", "Status", "Placar nosso", "Placar adversário", "Observações"];

function indiceColunas(ws, esperadas){
  // Acha cada coluna pelo título (ignora * e espaços), então a ordem pode mudar.
  const mapa = {};
  const cab = ws.getRow(1);
  const limpar = (s) => norm(s).replace(/\*/g, "").trim();
  const porTitulo = {};
  for (let c = 1; c <= Math.max(cab.cellCount, esperadas.length); c++) porTitulo[limpar(texto(cab.getCell(c)))] = c;
  esperadas.forEach((nome, i) => { mapa[i] = porTitulo[limpar(nome)] || null; });
  return mapa;
}

// ----------------------------------------------------------------------------
// Gerar o arquivo (modelo vazio ou com os dados atuais)
// ----------------------------------------------------------------------------
async function montarPlanilha(state, comDados){
  const ExcelJS = await carregarExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = TEAM.nome;

  // --- Como usar
  const ajuda = wb.addWorksheet("Como usar");
  ajuda.getColumn(1).width = 110;
  [
    `Planilha de cadastros — ${TEAM.nome}`,
    "",
    "1) Preencha as abas Jogadores e/ou Partidas (uma linha por jogador ou partida). Pode deixar uma delas vazia.",
    "2) Os campos com * são obrigatórios. As colunas com seta têm lista de opções.",
    "3) Salve o arquivo (.xlsx) e envie na tela Cadastros → Importar planilha. O app mostra uma PRÉVIA antes de gravar.",
    "",
    "JOGADORES — o nome identifica o jogador. Se já existir um com o mesmo nome, a linha é ignorada (ou atualizada, se você marcar essa opção).",
    "  • Posição: Goleiro, Zagueiro, Lateral, Volante, Meia, Atacante ou Técnico.",
    "  • Ativo / Direito a voto / Pagante: Sim ou Não. Em branco = Ativo Sim, os outros Não.",
    "  • Paga desde: mês no formato AAAA-MM (ex.: 2026-03). Em branco = desde o início.",
    "",
    "PARTIDAS — a data + o adversário identificam a partida. Se já existir, a linha é ignorada (ou atualizada).",
    "  • Data no formato dd/mm/aaaa. Horário no formato HH:MM (ex.: 09:00).",
    "  • Adversário e Campo: escolha da lista ou digite um nome novo — ele é cadastrado na importação.",
    "  • Status: Agendado ou Realizado. Em branco = Realizado se tiver placar, senão Agendado.",
    "  • Placar: só para partidas realizadas. Gols e assistências NÃO entram por aqui (use o Modo jogo ou a aba Gols da partida).",
    "",
    `Limite: ${MAX_LINHAS} linhas por aba em cada importação. Telefone, CPF e data de nascimento não vão na planilha (são dados privados).`,
  ].forEach((t, i) => { const c = ajuda.getCell(i + 1, 1); c.value = t; if (i === 0) c.font = { bold: true, size: 14 }; c.alignment = { wrapText: true }; });

  // --- Listas (alimentam os menus de opções)
  const listas = wb.addWorksheet("Listas");
  const adv = [...state.adversarios].map(a => a.nome).filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const campos = [...state.campos].map(c => c.nome).filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const colunasLista = [
    ["Posições", CATEGORIAS_ATLETA], ["Adversários", adv], ["Campos", campos],
    ["Tipos de partida", TIPOS_PARTIDA], ["Status", ["Agendado", "Realizado"]], ["Sim/Não", ["Sim", "Não"]],
  ];
  colunasLista.forEach(([titulo, itens], i) => {
    listas.getColumn(i + 1).width = 22;
    const h = listas.getCell(1, i + 1); h.value = titulo; h.font = { bold: true };
    itens.forEach((v, j) => { listas.getCell(j + 2, i + 1).value = v; });
  });
  const refLista = (col, n) => `Listas!$${"ABCDEF"[col]}$2:$${"ABCDEF"[col]}$${Math.max(n, 1) + 1 + (col === 1 || col === 2 ? 200 : 0)}`;

  const cabecalho = (ws, titulos, larguras) => {
    const r = ws.getRow(1);
    titulos.forEach((t, i) => {
      const c = r.getCell(i + 1);
      c.value = t;
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F6B3F" } };
      c.alignment = { vertical: "middle", wrapText: true };
      ws.getColumn(i + 1).width = larguras[i];
    });
    r.height = 30;
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  const lista = (ws, coluna, ref, estrito = true) => {
    for (let l = 2; l <= MAX_LINHAS + 1; l++){
      ws.getCell(l, coluna).dataValidation = {
        type: "list", allowBlank: true, formulae: [ref],
        showErrorMessage: true, errorStyle: estrito ? "stop" : "warning",
        errorTitle: "Valor fora da lista", error: estrito ? "Escolha um valor da lista." : "Esse valor não está na lista; ele será cadastrado como novo.",
      };
    }
  };

  // --- Jogadores
  const wj = wb.addWorksheet("Jogadores");
  cabecalho(wj, COLS_JOGADORES, [26, 28, 16, 12, 10, 14, 10, 18, 36]);
  wj.getColumn(8).numFmt = "@";
  lista(wj, 3, refLista(0, CATEGORIAS_ATLETA.length));
  [5, 6, 7].forEach(c => lista(wj, c, refLista(5, 2)));

  // --- Partidas
  const wp = wb.addWorksheet("Partidas");
  cabecalho(wp, COLS_PARTIDAS, [14, 10, 26, 26, 16, 12, 12, 14, 36]);
  wp.getColumn(1).numFmt = "dd/mm/yyyy";
  wp.getColumn(2).numFmt = "@";
  lista(wp, 3, refLista(1, adv.length), false);
  lista(wp, 4, refLista(2, campos.length), false);
  lista(wp, 5, refLista(3, TIPOS_PARTIDA.length));
  lista(wp, 6, refLista(4, 2));

  if (comDados){
    const sn = (b) => b ? "Sim" : "Não";
    [...state.atletas].sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR")).forEach((a, i) => {
      const r = wj.getRow(i + 2);
      [a.nome, a.nomeCompleto || "", a.posicao || "", a.numero ?? "", sn(a.ativo !== false), sn(!!a.podeVotar), sn(!!a.pagante), a.pagoDesde || "", a.observacoes || ""]
        .forEach((v, c) => { r.getCell(c + 1).value = v; });
    });
    const nomeAdv = (id) => state.adversarios.find(a => a.id === id)?.nome || "";
    const nomeCampo = (id) => state.campos.find(c => c.id === id)?.nome || "";
    [...state.jogos].sort((a, b) => (a.data || "").localeCompare(b.data || "")).forEach((j, i) => {
      const r = wp.getRow(i + 2);
      const [y, m, d] = (j.data || "").split("-").map(Number);
      r.getCell(1).value = y ? new Date(Date.UTC(y, m - 1, d)) : "";
      r.getCell(2).value = j.horario || "";
      r.getCell(3).value = nomeAdv(j.adversarioId);
      r.getCell(4).value = nomeCampo(j.campoId);
      r.getCell(5).value = j.tipoPartida || "";
      r.getCell(6).value = j.status === "realizado" ? "Realizado" : "Agendado";
      r.getCell(7).value = j.placarNos ?? "";
      r.getCell(8).value = j.placarAdversario ?? "";
      r.getCell(9).value = j.observacoes || "";
    });
  }

  // O Excel abre direto na aba de dados
  wb.views = [{ activeTab: 1 }];
  return wb;
}

async function baixarPlanilha(state, comDados){
  const wb = await montarPlanilha(state, comDados);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const nome = comDados ? `cadastros-${TEAM.id}-${dataISOLocal()}.xlsx` : `modelo-cadastros-${TEAM.id}.xlsx`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ----------------------------------------------------------------------------
// Ler e validar o arquivo enviado
// ----------------------------------------------------------------------------
function lerJogadores(ws, state){
  const linhas = [];
  if (!ws) return linhas;
  const col = indiceColunas(ws, COLS_JOGADORES);
  if (!col[0]) return [{ linha: 1, erros: ["A aba Jogadores precisa ter a coluna \"Nome\"."], resumo: "Cabeçalho" }];
  const existentes = {};
  state.atletas.forEach(a => { existentes[norm(a.nome)] = a; });
  const vistos = {};
  const cel = (row, i) => col[i] ? row.getCell(col[i]) : null;

  for (let n = 2; n <= Math.min(ws.rowCount, MAX_LINHAS + 1); n++){
    const row = ws.getRow(n);
    const vazia = COLS_JOGADORES.every((_, i) => texto(cel(row, i)) === "");
    if (vazia) continue;
    const L = { linha: n, erros: [], avisos: [], dados: {} };
    const nome = texto(cel(row, 0));
    if (!nome) L.erros.push("nome em branco");
    L.resumo = nome || "(sem nome)";

    const posTxt = texto(cel(row, 2));
    let posicao = "";
    if (posTxt){
      posicao = CATEGORIAS_ATLETA.find(p => norm(p) === norm(posTxt)) || "";
      if (!posicao) L.erros.push(`posição "${posTxt}" não existe (use ${CATEGORIAS_ATLETA.join(", ")})`);
    }
    const num = lerInteiro(cel(row, 3), "número");
    if (num.erro) L.erros.push(num.erro);
    const ativo = lerSimNao(cel(row, 4), "Ativo"); if (ativo.erro) L.erros.push(ativo.erro);
    const voto = lerSimNao(cel(row, 5), "Direito a voto"); if (voto.erro) L.erros.push(voto.erro);
    const pag = lerSimNao(cel(row, 6), "Pagante"); if (pag.erro) L.erros.push(pag.erro);
    const desde = lerMes(cel(row, 7)); if (desde.erro) L.erros.push(desde.erro);

    const chave = norm(nome);
    if (nome && vistos[chave]) L.erros.push(`nome repetido na planilha (linha ${vistos[chave]})`);
    else if (nome) vistos[chave] = n;

    L.dados = {
      nome,
      nomeCompleto: texto(cel(row, 1)),
      posicao,
      numero: num.vazio || num.erro ? null : num.valor,
      ativo: ativo.vazio || ativo.erro ? true : ativo.valor,
      podeVotar: voto.vazio || voto.erro ? false : voto.valor,
      pagante: pag.vazio || pag.erro ? false : pag.valor,
      pagoDesde: desde.vazio || desde.erro ? "" : desde.valor,
      observacoes: texto(cel(row, 8)),
    };
    // Para quem já existe: só campos preenchidos sobrescrevem
    L.parcial = {};
    if (L.dados.nomeCompleto) L.parcial.nomeCompleto = L.dados.nomeCompleto;
    if (posicao) L.parcial.posicao = posicao;
    if (!num.vazio && !num.erro) L.parcial.numero = num.valor;
    if (!ativo.vazio && !ativo.erro) L.parcial.ativo = ativo.valor;
    if (!voto.vazio && !voto.erro) L.parcial.podeVotar = voto.valor;
    if (!pag.vazio && !pag.erro) L.parcial.pagante = pag.valor;
    if (!desde.vazio && !desde.erro) L.parcial.pagoDesde = desde.valor;
    if (L.dados.observacoes) L.parcial.observacoes = L.dados.observacoes;

    const ex = existentes[chave];
    if (ex && !L.erros.length){ L.existenteId = ex.id; L.detalhe = "já cadastrado"; }
    linhas.push(L);
  }
  if (ws.rowCount > MAX_LINHAS + 1) linhas.push({ linha: MAX_LINHAS + 2, erros: [`a aba tem mais de ${MAX_LINHAS} linhas; importe o resto em outro arquivo`], resumo: "Limite de linhas" });
  return linhas;
}

function lerPartidas(ws, state){
  const linhas = [];
  if (!ws) return linhas;
  const col = indiceColunas(ws, COLS_PARTIDAS);
  if (!col[0] || !col[2] || !col[3]) return [{ linha: 1, erros: ["A aba Partidas precisa ter as colunas Data, Adversário e Campo."], resumo: "Cabeçalho" }];
  const cel = (row, i) => col[i] ? row.getCell(col[i]) : null;

  const advPorNome = {}; state.adversarios.forEach(a => { advPorNome[norm(a.nome)] = a.id; });
  const campoPorNome = {}; state.campos.forEach(c => { campoPorNome[norm(c.nome)] = c.id; });
  const jogoExistente = {}; state.jogos.forEach(j => { jogoExistente[`${j.data}|${j.adversarioId}`] = j; });
  const vistos = {};

  for (let n = 2; n <= Math.min(ws.rowCount, MAX_LINHAS + 1); n++){
    const row = ws.getRow(n);
    if (COLS_PARTIDAS.every((_, i) => texto(cel(row, i)) === "")) continue;
    const L = { linha: n, erros: [], avisos: [], dados: {} };

    const data = lerData(cel(row, 0));
    if (data.vazio) L.erros.push("data em branco"); else if (data.erro) L.erros.push(data.erro);
    const hor = lerHorario(cel(row, 1)); if (hor.erro) L.erros.push(hor.erro);
    const advNome = texto(cel(row, 2)); if (!advNome) L.erros.push("adversário em branco");
    const campoNome = texto(cel(row, 3)); if (!campoNome) L.erros.push("campo em branco");

    const tipoTxt = texto(cel(row, 4));
    let tipo = "";
    if (tipoTxt){
      tipo = TIPOS_PARTIDA.find(t => norm(t) === norm(tipoTxt)) || "";
      if (!tipo) L.erros.push(`tipo "${tipoTxt}" não existe (use ${TIPOS_PARTIDA.join(", ")})`);
    }
    const stTxt = norm(texto(cel(row, 5)));
    let status = "";
    if (stTxt){
      if (["agendado", "agendada"].includes(stTxt)) status = "agendado";
      else if (["realizado", "realizada"].includes(stTxt)) status = "realizado";
      else L.erros.push(`status "${texto(cel(row, 5))}" inválido (use Agendado ou Realizado)`);
    }
    const pn = lerInteiro(cel(row, 6), "placar nosso"); if (pn.erro) L.erros.push(pn.erro);
    const pa = lerInteiro(cel(row, 7), "placar adversário"); if (pa.erro) L.erros.push(pa.erro);
    const temPlacar = !pn.vazio && !pn.erro || !pa.vazio && !pa.erro;
    if (!status) status = temPlacar ? "realizado" : "agendado";
    if (status === "agendado" && temPlacar) L.erros.push("partida agendada não pode ter placar (marque como Realizado ou apague o placar)");
    if (status === "realizado" && (pn.vazio || pa.vazio) && !pn.erro && !pa.erro) L.avisos.push("realizada sem placar completo");

    const advId = advNome ? (advPorNome[norm(advNome)] || null) : null;
    const campoId = campoNome ? (campoPorNome[norm(campoNome)] || null) : null;
    L.novoAdversario = advNome && !advId ? advNome : null;
    L.novoCampo = campoNome && !campoId ? campoNome : null;

    L.resumo = `${data.valor ? data.valor.split("-").reverse().join("/") : "?"} · ${advNome || "?"}`;
    const chave = `${data.valor}|${norm(advNome)}`;
    if (data.valor && advNome){
      if (vistos[chave]) L.erros.push(`partida repetida na planilha (linha ${vistos[chave]})`);
      else vistos[chave] = n;
    }

    L.dados = {
      data: data.valor || "", horario: hor.valor || "", status,
      adversarioId: advId, campoId, tipoPartida: tipo,
      placarNos: pn.vazio || pn.erro ? null : pn.valor,
      placarAdversario: pa.vazio || pa.erro ? null : pa.valor,
      observacoes: texto(cel(row, 8)),
    };
    L.parcial = {};
    if (hor.valor) L.parcial.horario = hor.valor;
    if (campoId) L.parcial.campoId = campoId;
    if (tipo) L.parcial.tipoPartida = tipo;
    if (texto(cel(row, 5))) L.parcial.status = status;
    if (!pn.vazio && !pn.erro) L.parcial.placarNos = pn.valor;
    if (!pa.vazio && !pa.erro) L.parcial.placarAdversario = pa.valor;
    if (L.dados.observacoes) L.parcial.observacoes = L.dados.observacoes;
    L.advNome = advNome; L.campoNome = campoNome;

    const ex = advId && data.valor ? jogoExistente[`${data.valor}|${advId}`] : null;
    if (ex && !L.erros.length){ L.existenteId = ex.id; L.detalhe = "já cadastrada"; }
    linhas.push(L);
  }
  if (ws.rowCount > MAX_LINHAS + 1) linhas.push({ linha: MAX_LINHAS + 2, erros: [`a aba tem mais de ${MAX_LINHAS} linhas; importe o resto em outro arquivo`], resumo: "Limite de linhas" });
  return linhas;
}

async function lerArquivo(arquivo, state){
  const ExcelJS = await carregarExcelJS();
  const wb = new ExcelJS.Workbook();
  try{ await wb.xlsx.load(await arquivo.arrayBuffer()); }
  catch(err){ throw new Error("Não consegui abrir esse arquivo. Envie uma planilha Excel (.xlsx) salva a partir do modelo."); }
  const wj = wb.getWorksheet("Jogadores");
  const wp = wb.getWorksheet("Partidas");
  if (!wj && !wp) throw new Error("O arquivo não tem as abas \"Jogadores\" ou \"Partidas\". Use o modelo baixado nesta tela.");
  return { jogadores: lerJogadores(wj, state), partidas: lerPartidas(wp, state) };
}

// ----------------------------------------------------------------------------
// Tela
// ----------------------------------------------------------------------------
let previa = null;           // resultado da leitura (fica na memória enquanto a tela está aberta)
let nomeArquivo = "";
let atualizarExistentes = false;
let gravando = false;

export function renderImportar(root, state){
  root.innerHTML = `
    <div class="topbar">
      <div>
        <div class="eyebrow">Cadastros</div>
        <h1>Importar planilha</h1>
      </div>
      <a href="#cadastros" class="btn btn-ghost btn-sm">&larr; Voltar</a>
    </div>

    <div class="card card-pad" style="margin-bottom:14px;">
      <div class="card-title">1. Baixe a planilha</div>
      <div class="card-sub">O modelo tem as abas <strong>Jogadores</strong> e <strong>Partidas</strong>, com listas de opções (posição, adversário, campo, status). Se preferir, exporte o que já está cadastrado, edite no Excel e envie de volta.</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn btn-primary" id="imp-modelo">Baixar modelo em branco</button>
        <button class="btn btn-ghost" id="imp-exportar">Exportar os dados atuais</button>
      </div>
    </div>

    <div class="card card-pad" style="margin-bottom:14px;">
      <div class="card-title">2. Preencha no Excel</div>
      <div class="card-sub" style="margin-bottom:0;">Uma linha por jogador ou partida; a aba <em>Como usar</em> explica cada coluna. Gols e assistências não entram por aqui. Não é preciso preencher as duas abas.</div>
    </div>

    <div class="card card-pad" style="margin-bottom:14px;">
      <div class="card-title">3. Envie a planilha preenchida</div>
      <div class="card-sub">Nada é gravado agora: primeiro você vê uma prévia com o que vai entrar e o que está com erro.</div>
      <input type="file" id="imp-arquivo" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
      <div id="imp-previa" style="margin-top:14px;"></div>
    </div>`;

  $("#imp-modelo", root).addEventListener("click", (e) => executar(e.target, () => baixarPlanilha(state, false)));
  $("#imp-exportar", root).addEventListener("click", (e) => executar(e.target, () => baixarPlanilha(state, true)));
  $("#imp-arquivo", root).addEventListener("change", async (e) => {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    const alvo = $("#imp-previa", root);
    alvo.innerHTML = `<p class="card-sub">Lendo a planilha…</p>`;
    try{
      previa = await lerArquivo(arquivo, state);
      nomeArquivo = arquivo.name;
      desenharPrevia(root, state);
    }catch(err){
      previa = null;
      alvo.innerHTML = `<div class="landing-aviso">${escapeHtml(err.message || err)}</div>`;
    }
  });

  if (previa) desenharPrevia(root, state);
}

async function executar(btn, fn){
  const antes = btn.textContent;
  btn.disabled = true; btn.textContent = "Preparando…";
  try{ await fn(); }
  catch(err){ console.error(err); toast(err.message || "Não foi possível gerar a planilha.", "err"); }
  finally{ btn.disabled = false; btn.textContent = antes; }
}

function contar(linhas, atualiza){
  const ok = linhas.filter(l => !l.erros.length);
  return {
    novos: ok.filter(l => !l.existenteId).length,
    existentes: ok.filter(l => l.existenteId).length,
    aGravar: ok.filter(l => !l.existenteId || atualiza).length,
    erros: linhas.filter(l => l.erros.length).length,
  };
}

function desenharPrevia(root, state){
  const alvo = $("#imp-previa", root);
  if (!alvo || !previa) return;
  const { jogadores, partidas } = previa;
  const cj = contar(jogadores, atualizarExistentes), cp = contar(partidas, atualizarExistentes);
  const totalGravar = cj.aGravar + cp.aGravar;
  const novosAdv = [...new Set(partidas.filter(l => !l.erros.length && l.novoAdversario && (!l.existenteId || atualizarExistentes)).map(l => norm(l.novoAdversario)))];
  const novosCampos = [...new Set(partidas.filter(l => !l.erros.length && l.novoCampo && (!l.existenteId || atualizarExistentes)).map(l => norm(l.novoCampo)))];
  const nomeBonito = (lista, chave, campo) => lista.find(l => norm(l[campo]) === chave)?.[campo] || chave;

  const linhaHtml = (l, aba) => {
    let etiqueta, cls;
    if (l.erros.length){ etiqueta = "Erro"; cls = "badge-off"; }
    else if (l.existenteId){ etiqueta = atualizarExistentes ? "Atualiza" : "Já existe — ignorada"; cls = atualizarExistentes ? "badge-pending" : "badge-off"; }
    else { etiqueta = "Novo"; cls = "badge-ok"; }
    const msgs = [...l.erros, ...(l.avisos || []), ...(l.novoAdversario && !l.erros.length ? [`adversário novo: ${l.novoAdversario}`] : []), ...(l.novoCampo && !l.erros.length ? [`campo novo: ${l.novoCampo}`] : [])];
    return `<tr>
      <td>${aba}</td><td>${l.linha}</td><td><strong>${escapeHtml(l.resumo || "")}</strong></td>
      <td><span class="badge ${cls}">${etiqueta}</span></td>
      <td style="font-size:12.5px; color:${l.erros.length ? "var(--danger)" : "var(--ink-soft)"};">${escapeHtml(msgs.join("; "))}</td></tr>`;
  };
  // erros primeiro (para não ficarem escondidos)
  const ordenadas = [...jogadores.map(l => [l, "Jogadores"]), ...partidas.map(l => [l, "Partidas"])]
    .sort((a, b) => (b[0].erros.length ? 1 : 0) - (a[0].erros.length ? 1 : 0))
    .map(([l, aba]) => linhaHtml(l, aba));

  alvo.innerHTML = `
    <div class="manchete" style="margin-bottom:12px;">
      <div class="manchete-eyebrow">${escapeHtml(nomeArquivo)}</div>
      <div class="manchete-titulo">${totalGravar} registro${totalGravar === 1 ? "" : "s"} pronto${totalGravar === 1 ? "" : "s"} para importar</div>
      <div class="manchete-sub">
        Jogadores: ${cj.novos} novo${cj.novos === 1 ? "" : "s"}, ${cj.existentes} já existe${cj.existentes === 1 ? "" : "m"}, ${cj.erros} com erro ·
        Partidas: ${cp.novos} nova${cp.novos === 1 ? "" : "s"}, ${cp.existentes} já existe${cp.existentes === 1 ? "" : "m"}, ${cp.erros} com erro
        ${novosAdv.length || novosCampos.length ? `<br>Serão cadastrados também: ${novosAdv.length} adversário${novosAdv.length === 1 ? "" : "s"} (${escapeHtml(novosAdv.map(c => nomeBonito(partidas, c, "novoAdversario")).join(", ") || "—")}) e ${novosCampos.length} campo${novosCampos.length === 1 ? "" : "s"} (${escapeHtml(novosCampos.map(c => nomeBonito(partidas, c, "novoCampo")).join(", ") || "—")}).` : ""}
      </div>
    </div>
    ${cj.erros + cp.erros ? `<div class="landing-aviso" style="margin-bottom:12px;">As linhas com erro <strong>não serão importadas</strong>. Corrija no Excel e envie de novo, ou importe só as que estão certas.</div>` : ""}
    ${cj.existentes + cp.existentes ? `<label style="display:flex; align-items:center; gap:8px; font-size:13.5px; margin-bottom:12px;"><input type="checkbox" id="imp-atualizar" ${atualizarExistentes ? "checked" : ""} style="width:16px;height:16px;"> Atualizar também os que já existem (só os campos preenchidos na planilha)</label>` : ""}
    <div class="table-wrap" style="max-height:340px; overflow:auto;">
      <table><thead><tr><th>Aba</th><th>Linha</th><th>Registro</th><th>Resultado</th><th>Detalhe</th></tr></thead>
      <tbody>${ordenadas.join("") || `<tr><td colspan="5">Nenhuma linha preenchida foi encontrada.</td></tr>`}</tbody></table>
    </div>
    <div class="form-actions" style="justify-content:flex-start; margin-top:14px;">
      <button class="btn btn-primary" id="imp-gravar" ${totalGravar === 0 || gravando ? "disabled" : ""}>Importar ${totalGravar} registro${totalGravar === 1 ? "" : "s"}</button>
      <button class="btn btn-ghost" id="imp-cancelar">Descartar</button>
    </div>`;

  $("#imp-atualizar", alvo)?.addEventListener("change", (e) => { atualizarExistentes = e.target.checked; desenharPrevia(root, state); });
  $("#imp-cancelar", alvo).addEventListener("click", () => { previa = null; nomeArquivo = ""; const f = $("#imp-arquivo", root); if (f) f.value = ""; alvo.innerHTML = ""; });
  $("#imp-gravar", alvo).addEventListener("click", () => gravar(root, state));
}

async function gravar(root, state){
  if (gravando || !previa) return;
  const atualiza = atualizarExistentes;
  const jog = previa.jogadores.filter(l => !l.erros.length && (!l.existenteId || atualiza));
  const par = previa.partidas.filter(l => !l.erros.length && (!l.existenteId || atualiza));
  if (!jog.length && !par.length) return;
  gravando = true;
  const btn = $("#imp-gravar", root); if (btn){ btn.disabled = true; btn.textContent = "Importando…"; }

  try{
    const itens = [];
    // adversários e campos novos (um por nome), com id definido para ligar às partidas
    const novosAdv = {}, novosCampos = {};
    par.forEach(l => {
      if (l.novoAdversario && !novosAdv[norm(l.novoAdversario)]){
        const id = novoIdDoc("adversarios"); novosAdv[norm(l.novoAdversario)] = id;
        itens.push({ colecao: "adversarios", id, existente: false, dados: { nome: l.novoAdversario, cidade: "", observacoes: "" } });
      }
      if (l.novoCampo && !novosCampos[norm(l.novoCampo)]){
        const id = novoIdDoc("campos"); novosCampos[norm(l.novoCampo)] = id;
        itens.push({ colecao: "campos", id, existente: false, dados: { nome: l.novoCampo, endereco: "", tipo: "", observacoes: "" } });
      }
    });
    jog.forEach(l => {
      if (l.existenteId) itens.push({ colecao: "atletas", id: l.existenteId, existente: true, dados: l.parcial });
      else itens.push({ colecao: "atletas", id: null, existente: false, dados: l.dados });
    });
    par.forEach(l => {
      if (l.existenteId){ itens.push({ colecao: "jogos", id: l.existenteId, existente: true, dados: l.parcial }); return; }
      const dados = { ...l.dados };
      if (!dados.adversarioId) dados.adversarioId = novosAdv[norm(l.novoAdversario)];
      if (!dados.campoId) dados.campoId = novosCampos[norm(l.novoCampo)];
      Object.assign(dados, { decisao: "", penaltisNos: null, penaltisAdversario: null, criterioVencedor: "", criterioMotivo: "" });
      itens.push({ colecao: "jogos", id: null, existente: false, dados });
    });

    await importarEmLote(itens);
    const nJ = jog.length, nP = par.length;
    toast(`Importação concluída: ${nJ} jogador${nJ === 1 ? "" : "es"} e ${nP} partida${nP === 1 ? "" : "s"}.`, "ok");
    previa = null; nomeArquivo = ""; atualizarExistentes = false;
    const alvo = $("#imp-previa", root);
    if (alvo) alvo.innerHTML = `
      <div class="manchete"><div class="manchete-eyebrow">Pronto</div>
      <div class="manchete-titulo">${nJ} jogador${nJ === 1 ? "" : "es"} e ${nP} partida${nP === 1 ? "" : "s"} importad${nJ + nP === 1 ? "o" : "os"}</div>
      <div class="manchete-sub"><a href="#atletas">Ver atletas</a> · <a href="#jogos">Ver partidas</a></div></div>`;
    const f = $("#imp-arquivo", root); if (f) f.value = "";
  }catch(err){
    console.error(err);
    toast("Não foi possível importar: " + (err.message || err), "err");
    const b = $("#imp-gravar", root); if (b){ b.disabled = false; b.textContent = "Tentar de novo"; }
  }finally{
    gravando = false;
  }
}
