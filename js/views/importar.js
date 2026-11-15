// Importar / exportar cadastros por planilha (Excel): Jogadores, Partidas, Gols e Participantes.
// O modelo muda conforme a modalidade do time (o futsal tem a coluna Quadro).
// Fluxo: baixar o modelo → preencher no Excel → enviar → conferir a PRÉVIA →
// só então gravar. Linhas com erro nunca são gravadas; as demais entram.
import { TEAM } from "../tenant.js";
import { $, $$, escapeHtml, toast, dataISOLocal } from "../utils.js";
import { importarEmLote, novoIdDoc, getPrivateDoc } from "../db.js";
import { categoriasAtleta, idModalidade, modalidadeAtual } from "../modalidade.js";
import { GOL_CONTRA_ID, TIPOS_GOL, TEMPOS_JOGO, idsDaPartida } from "../stats.js";
import { TIPOS_PARTIDA } from "./jogos.js";

const MAX_LINHAS = 500;                                   // Jogadores e Partidas
const LIM = { gols: 1500, participantes: 3000 };            // Gols e Participantes (uma linha por gol / por jogador em cada partida)
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


// Telefone: aceita (11) 98765-4321, 11987654321, +55 11 98765-4321... e guarda formatado.
function lerTelefone(cell){
  const t = texto(cell);
  if (t === "") return { vazio: true };
  let d = t.replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11) return { valor: `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` };
  if (d.length === 10) return { valor: `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` };
  if (d.length === 8 || d.length === 9) return { valor: d.length === 9 ? `${d.slice(0, 5)}-${d.slice(5)}` : `${d.slice(0, 4)}-${d.slice(4)}` };
  return { erro: `telefone "${t}" inválido (use DDD + número, ex.: 11 98765-4321)` };
}

// ----------------------------------------------------------------------------
// Colunas das abas (o modelo muda conforme a modalidade: só o futsal tem "Quadro")
// ----------------------------------------------------------------------------
const ehFutsal = () => idModalidade() === "futsal";
const QUADROS = ["1º quadro", "2º quadro"];
const COLS_JOGADORES = ["Nome *", "Nome completo", "Posição", "Número da camisa", "Ativo", "Direito a voto", "Pagante", "Paga desde (AAAA-MM)", "Observações", "Telefone"];
const colsPartidas = () => ["Data *", "Horário", "Adversário *", "Campo *", ...(ehFutsal() ? ["Quadro"] : []), "Tipo de partida", "Status", "Placar nosso", "Placar adversário", "Observações"];
const colsGols = () => ["Data *", "Adversário *", ...(ehFutsal() ? ["Quadro"] : []), "Autor do gol *", "Assistência", "Minuto", "Tempo", "Como foi o gol"];
const colsParticipantes = () => ["Data *", "Adversário *", ...(ehFutsal() ? ["Quadro"] : []), "Jogador *"];

const limpar = (s) => norm(s).replace(/\*/g, "").trim();

function indiceColunas(ws, esperadas){
  // Acha cada coluna pelo título (ignora * e espaços), então a ordem pode mudar.
  const mapa = {};
  const cab = ws.getRow(1);
  const porTitulo = {};
  for (let c = 1; c <= Math.max(cab.cellCount, esperadas.length); c++) porTitulo[limpar(texto(cab.getCell(c)))] = c;
  esperadas.forEach((nome, i) => { mapa[i] = porTitulo[limpar(nome)] || null; });
  return mapa;
}

// Mesma ideia, mas devolvendo { título limpo: número da coluna } (as abas de partidas, gols e participantes).
function mapaColunas(ws){
  const mapa = {};
  const cab = ws.getRow(1);
  for (let c = 1; c <= Math.max(cab.cellCount, 20); c++){
    const t = limpar(texto(cab.getCell(c)));
    if (t && !mapa[t]) mapa[t] = c;
  }
  return mapa;
}
const celula = (mapa, row, nome) => mapa[limpar(nome)] ? row.getCell(mapa[limpar(nome)]) : null;
const temColuna = (mapa, nome) => !!mapa[limpar(nome)];

// "1", "1º", "1º quadro", "primeiro quadro" → "1"; vazio ou "sem quadro" → "".
function lerQuadro(cell){
  const t = norm(texto(cell));
  if (!t || t === "sem quadro") return { valor: "" };
  if (/^(1|1o|1º|primeiro)( quadro)?$/.test(t)) return { valor: "1" };
  if (/^(2|2o|2º|segundo)( quadro)?$/.test(t)) return { valor: "2" };
  return { erro: `quadro "${texto(cell)}" inválido (use 1º quadro, 2º quadro ou deixe em branco)` };
}

// Identifica a partida: data + adversário + quadro.
const chaveJogo = (data, advNome, quadro) => `${data}|${norm(advNome)}|${quadro || ""}`;
const rotuloQuadroImp = (q) => q === "1" ? "1º quadro" : q === "2" ? "2º quadro" : "";
const dataBR = (iso) => iso ? iso.split("-").reverse().join("/") : "?";

// ----------------------------------------------------------------------------
// Gerar o arquivo (modelo vazio ou com os dados atuais)
// ----------------------------------------------------------------------------
async function montarPlanilha(state, comDados){
  const ExcelJS = await carregarExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = TEAM.nome;
  // Marca a modalidade no próprio arquivo: o app recusa planilha de futsal em time de campo e vice-versa.
  wb.subject = `modalidade:${ehFutsal() ? "futsal" : "campo"}`;
  const futsal = ehFutsal();
  const mod = modalidadeAtual();

  // --- Como usar
  const ajuda = wb.addWorksheet("Como usar");
  ajuda.getColumn(1).width = 115;
  [
    `Planilha de cadastros — ${TEAM.nome} (modelo de ${mod.nome})`,
    "",
    "1) Preencha as abas Jogadores, Partidas, Gols e Participantes. Pode deixar alguma delas vazia. Faça nessa ordem: as abas Gols e Participantes usam os nomes das duas primeiras.",
    "2) Os campos com * são obrigatórios. Colunas com seta têm lista de opções.",
    "3) Salve o arquivo (.xlsx) e envie na tela Cadastros → Importar planilha. O app mostra uma PRÉVIA antes de gravar. Nada é apagado.",
    "",
    "JOGADORES — o nome identifica o jogador (escreva sempre igual nas outras abas). Se já existir um com o mesmo nome, a linha é ignorada (ou atualizada, se você marcar essa opção).",
    `  • Posição: ${categoriasAtleta().join(", ")}.`,
    "  • Ativo / Direito a voto / Pagante: Sim ou Não. Em branco = Ativo Sim, os outros Não.",
    "  • Paga desde: mês no formato AAAA-MM (ex.: 2026-03). Em branco = desde o início.",
    "  • Telefone: com DDD (ex.: 11 98765-4321). É um dado privado: a exportação NUNCA traz o telefone atual (a coluna vem vazia). Só quem tem telefone preenchido é gravado; em branco NÃO apaga o telefone que já está no app. Para jogador já cadastrado, marque \"Atualizar\" na hora de importar.",
    "",
    futsal
      ? "PARTIDAS — a data + o adversário + o quadro identificam a partida. Cada quadro é uma linha (o confronto do dia tem 2 linhas: 1º quadro e 2º quadro)."
      : "PARTIDAS — a data + o adversário identificam a partida. Se já existir, a linha é ignorada (ou atualizada).",
    "  • Data no formato dd/mm/aaaa. Horário no formato HH:MM (ex.: 09:00).",
    "  • Adversário e Campo: escolha da lista ou digite um nome novo — ele é cadastrado na importação. Escreva o adversário sempre igual.",
    ...(futsal ? ["  • Quadro: 1º quadro ou 2º quadro. Em branco = partida sem quadro."] : []),
    "  • Status: Agendado ou Realizado. Em branco = Realizado se tiver placar, senão Agendado.",
    "  • Placar: só para partidas realizadas.",
    "",
    "GOLS — uma linha por gol. Identifique a partida pela mesma data + adversário" + (futsal ? " + quadro" : "") + " da aba Partidas.",
    "  • Autor do gol: o nome do jogador, ou \"Gol contra\" quando o adversário marcou contra. Assistência: opcional.",
    "  • Minuto (número), Tempo (1º tempo / 2º tempo) e Como foi o gol (Finalização, Cabeceio, Falta, Pênalti): opcionais.",
    "  • O número de gols lançados deve bater com o placar nosso; se não bater, a prévia avisa.",
    "  • Se a partida já tem gols no app, a aba Gols é ignorada para ela (ou substitui a lista, se você marcar \"atualizar\").",
    "",
    "PARTICIPANTES — uma linha por jogador que atuou na partida (conta como 1 jogo no ranking). Quem fez gol ou assistência já entra automaticamente.",
    "",
    `Limites por importação: ${MAX_LINHAS} linhas em Jogadores e Partidas, ${LIM.gols} em Gols e ${LIM.participantes} em Participantes. Notas de avaliação, CPF e data de nascimento não vão na planilha.`,
  ].forEach((t, i) => { const c = ajuda.getCell(i + 1, 1); c.value = t; if (i === 0) c.font = { bold: true, size: 14 }; c.alignment = { wrapText: true }; });

  // --- Listas (alimentam os menus de opções)
  const listas = wb.addWorksheet("Listas");
  const nomes = (arr) => arr.map(x => x.nome).filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const adv = nomes(state.adversarios), campos = nomes(state.campos), atl = nomes(state.atletas);
  const colunasLista = [
    ["Posições", categoriasAtleta()], ["Adversários", adv], ["Campos", campos],
    ["Tipos de partida", TIPOS_PARTIDA], ["Status", ["Agendado", "Realizado"]], ["Sim/Não", ["Sim", "Não"]],
    ["Quadros", QUADROS], ["Jogadores", atl], ["Autores do gol", ["Gol contra", ...atl]],
    ["Tempos", TEMPOS_JOGO], ["Como foi o gol", TIPOS_GOL],
  ];
  const LETRAS = "ABCDEFGHIJK";
  colunasLista.forEach(([titulo, itens], i) => {
    listas.getColumn(i + 1).width = 22;
    const h = listas.getCell(1, i + 1); h.value = titulo; h.font = { bold: true };
    itens.forEach((v, j) => { listas.getCell(j + 2, i + 1).value = v; });
  });
  // folga: deixa a lista "crescer" além do que já está cadastrado
  const ref = (col, n, folga = 0) => `Listas!$${LETRAS[col]}$2:$${LETRAS[col]}$${Math.max(n, 1) + 1 + folga}`;

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
  const lista = (ws, coluna, r, estrito = true, max = MAX_LINHAS) => {
    for (let l = 2; l <= max + 1; l++){
      ws.getCell(l, coluna).dataValidation = {
        type: "list", allowBlank: true, formulae: [r],
        showErrorMessage: true, errorStyle: estrito ? "stop" : "warning",
        errorTitle: "Valor fora da lista", error: estrito ? "Escolha um valor da lista." : "Esse valor não está na lista; confira a grafia (ele será cadastrado como novo, se for adversário ou campo).",
      };
    }
  };

  // --- Jogadores
  const wj = wb.addWorksheet("Jogadores");
  cabecalho(wj, COLS_JOGADORES, [26, 28, 16, 12, 10, 14, 10, 18, 36, 20]);
  wj.getColumn(8).numFmt = "@";
  wj.getColumn(10).numFmt = "@";
  lista(wj, 3, ref(0, categoriasAtleta().length));
  [5, 6, 7].forEach(c => lista(wj, c, ref(5, 2)));

  // --- Partidas
  const CP = colsPartidas();
  const cp = (nome) => CP.indexOf(nome) + 1;
  const wp = wb.addWorksheet("Partidas");
  cabecalho(wp, CP, CP.map(n => ({ "Data *": 14, "Horário": 10, "Adversário *": 26, "Campo *": 26, "Quadro": 12, "Tipo de partida": 16, "Status": 12, "Placar nosso": 12, "Placar adversário": 14, "Observações": 36 }[n])));
  wp.getColumn(1).numFmt = "dd/mm/yyyy";
  wp.getColumn(2).numFmt = "@";
  lista(wp, cp("Adversário *"), ref(1, adv.length, 200), false);
  lista(wp, cp("Campo *"), ref(2, campos.length, 200), false);
  if (futsal) lista(wp, cp("Quadro"), ref(6, 2));
  lista(wp, cp("Tipo de partida"), ref(3, TIPOS_PARTIDA.length));
  lista(wp, cp("Status"), ref(4, 2));

  // --- Gols
  const CG = colsGols();
  const cg = (nome) => CG.indexOf(nome) + 1;
  const wg = wb.addWorksheet("Gols");
  cabecalho(wg, CG, CG.map(n => ({ "Data *": 14, "Adversário *": 26, "Quadro": 12, "Autor do gol *": 26, "Assistência": 26, "Minuto": 9, "Tempo": 12, "Como foi o gol": 16 }[n])));
  wg.getColumn(1).numFmt = "dd/mm/yyyy";
  lista(wg, cg("Adversário *"), ref(1, adv.length, 200), false, LIM.gols);
  if (futsal) lista(wg, cg("Quadro"), ref(6, 2), true, LIM.gols);
  lista(wg, cg("Autor do gol *"), ref(8, atl.length + 1, 300), false, LIM.gols);
  lista(wg, cg("Assistência"), ref(7, atl.length, 300), false, LIM.gols);
  lista(wg, cg("Tempo"), ref(9, TEMPOS_JOGO.length), true, LIM.gols);
  lista(wg, cg("Como foi o gol"), ref(10, TIPOS_GOL.length), true, LIM.gols);

  // --- Participantes
  const CQ = colsParticipantes();
  const cq = (nome) => CQ.indexOf(nome) + 1;
  const wq = wb.addWorksheet("Participantes");
  cabecalho(wq, CQ, CQ.map(n => ({ "Data *": 14, "Adversário *": 26, "Quadro": 12, "Jogador *": 28 }[n])));
  wq.getColumn(1).numFmt = "dd/mm/yyyy";
  lista(wq, cq("Adversário *"), ref(1, adv.length, 200), false, LIM.participantes);
  if (futsal) lista(wq, cq("Quadro"), ref(6, 2), true, LIM.participantes);
  lista(wq, cq("Jogador *"), ref(7, atl.length, 300), false, LIM.participantes);

  if (comDados){
    const sn = (b) => b ? "Sim" : "Não";
    [...state.atletas].sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR")).forEach((a, i) => {
      const r = wj.getRow(i + 2);
      [a.nome, a.nomeCompleto || "", a.posicao || "", a.numero ?? "", sn(a.ativo !== false), sn(!!a.podeVotar), sn(!!a.pagante), a.pagoDesde || "", a.observacoes || ""]
        .forEach((v, c) => { r.getCell(c + 1).value = v; });
    });
    const nomeAdv = (id) => state.adversarios.find(a => a.id === id)?.nome || "";
    const nomeCampo = (id) => state.campos.find(c => c.id === id)?.nome || "";
    const nomeAtl = {}; state.atletas.forEach(a => { nomeAtl[a.id] = a.nome; });
    const dataXls = (iso) => { const [y, m, d] = (iso || "").split("-").map(Number); return y ? new Date(Date.UTC(y, m - 1, d)) : ""; };
    const jogos = [...state.jogos].sort((a, b) => (a.data || "").localeCompare(b.data || "") || (a.horario || "").localeCompare(b.horario || "") || (b.quadro || "").localeCompare(a.quadro || ""));
    jogos.forEach((j, i) => {
      const r = wp.getRow(i + 2);
      r.getCell(cp("Data *")).value = dataXls(j.data);
      r.getCell(cp("Horário")).value = j.horario || "";
      r.getCell(cp("Adversário *")).value = nomeAdv(j.adversarioId);
      r.getCell(cp("Campo *")).value = nomeCampo(j.campoId);
      if (futsal) r.getCell(cp("Quadro")).value = rotuloQuadroImp(j.quadro);
      r.getCell(cp("Tipo de partida")).value = j.tipoPartida || "";
      r.getCell(cp("Status")).value = j.status === "realizado" ? "Realizado" : "Agendado";
      r.getCell(cp("Placar nosso")).value = j.placarNos ?? "";
      r.getCell(cp("Placar adversário")).value = j.placarAdversario ?? "";
      r.getCell(cp("Observações")).value = j.observacoes || "";
    });
    let lg = 2, lq = 2;
    jogos.forEach(j => {
      const base = (ws, linha, col) => {
        ws.getCell(linha, col("Data *")).value = dataXls(j.data);
        ws.getCell(linha, col("Adversário *")).value = nomeAdv(j.adversarioId);
        if (futsal) ws.getCell(linha, col("Quadro")).value = rotuloQuadroImp(j.quadro);
      };
      (j.golsAssistencias || []).forEach(e => {
        if (lg > LIM.gols + 1) return;
        base(wg, lg, cg);
        wg.getCell(lg, cg("Autor do gol *")).value = e.atletaGolId === GOL_CONTRA_ID ? "Gol contra" : (nomeAtl[e.atletaGolId] || "");
        wg.getCell(lg, cg("Assistência")).value = e.atletaAssistId ? (nomeAtl[e.atletaAssistId] || "") : "";
        wg.getCell(lg, cg("Minuto")).value = e.minuto ?? "";
        wg.getCell(lg, cg("Tempo")).value = e.tempo || "";
        wg.getCell(lg, cg("Como foi o gol")).value = e.tipoGol || "";
        lg++;
      });
      [...idsDaPartida(j)].map(id => nomeAtl[id]).filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR")).forEach(nome => {
        if (lq > LIM.participantes + 1) return;
        base(wq, lq, cq);
        wq.getCell(lq, cq("Jogador *")).value = nome;
        lq++;
      });
    });
  }

  // O Excel abre direto na aba Jogadores
  wb.views = [{ activeTab: 2 }];
  return wb;
}

async function baixarPlanilha(state, comDados){
  const wb = await montarPlanilha(state, comDados);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const tipo = ehFutsal() ? "futsal" : "campo";
  const nome = comDados ? `cadastros-${tipo}-${TEAM.id}-${dataISOLocal()}.xlsx` : `modelo-${tipo}-${TEAM.id}.xlsx`;
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
      posicao = categoriasAtleta().find(p => norm(p) === norm(posTxt)) || "";
      if (!posicao) L.erros.push(`posição "${posTxt}" não existe (use ${categoriasAtleta().join(", ")})`);
    }
    const num = lerInteiro(cel(row, 3), "número");
    if (num.erro) L.erros.push(num.erro);
    const ativo = lerSimNao(cel(row, 4), "Ativo"); if (ativo.erro) L.erros.push(ativo.erro);
    const voto = lerSimNao(cel(row, 5), "Direito a voto"); if (voto.erro) L.erros.push(voto.erro);
    const pag = lerSimNao(cel(row, 6), "Pagante"); if (pag.erro) L.erros.push(pag.erro);
    const desde = lerMes(cel(row, 7)); if (desde.erro) L.erros.push(desde.erro);
    const tel = lerTelefone(cel(row, 9)); if (tel.erro) L.erros.push(tel.erro);
    L.telefone = tel.valor || "";

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
    else if (!L.erros.length) L.novoId = novoIdDoc("atletas");   // id definido já aqui, para as abas Gols e Participantes apontarem para ele
    linhas.push(L);
  }
  if (ws.rowCount > MAX_LINHAS + 1) linhas.push({ linha: MAX_LINHAS + 2, erros: [`a aba tem mais de ${MAX_LINHAS} linhas; importe o resto em outro arquivo`], resumo: "Limite de linhas" });
  return linhas;
}


function lerPartidas(ws, state){
  const linhas = [];
  if (!ws) return linhas;
  const m = mapaColunas(ws);
  if (!temColuna(m, "Data") || !temColuna(m, "Adversário") || !temColuna(m, "Campo")) return [{ linha: 1, erros: ["A aba Partidas precisa ter as colunas Data, Adversário e Campo."], resumo: "Cabeçalho" }];
  const cel = (row, nome) => celula(m, row, nome);
  const comQuadro = ehFutsal() && temColuna(m, "Quadro");

  const advPorNome = {}; state.adversarios.forEach(a => { advPorNome[norm(a.nome)] = a.id; });
  const campoPorNome = {}; state.campos.forEach(c => { campoPorNome[norm(c.nome)] = c.id; });
  const jogoExistente = {};
  state.jogos.forEach(j => {
    const an = state.adversarios.find(a => a.id === j.adversarioId)?.nome;
    if (an) jogoExistente[chaveJogo(j.data, an, j.quadro)] = j;
  });
  const vistos = {};
  const nomesColunas = colsPartidas();

  for (let n = 2; n <= Math.min(ws.rowCount, MAX_LINHAS + 1); n++){
    const row = ws.getRow(n);
    if (nomesColunas.every(nome => texto(cel(row, nome)) === "")) continue;
    const L = { linha: n, erros: [], avisos: [], dados: {} };

    const data = lerData(cel(row, "Data"));
    if (data.vazio) L.erros.push("data em branco"); else if (data.erro) L.erros.push(data.erro);
    const hor = lerHorario(cel(row, "Horário")); if (hor.erro) L.erros.push(hor.erro);
    const advNome = texto(cel(row, "Adversário")); if (!advNome) L.erros.push("adversário em branco");
    const campoNome = texto(cel(row, "Campo")); if (!campoNome) L.erros.push("campo em branco");
    const q = comQuadro ? lerQuadro(cel(row, "Quadro")) : { valor: "" };
    if (q.erro) L.erros.push(q.erro);

    const tipoTxt = texto(cel(row, "Tipo de partida"));
    let tipo = "";
    if (tipoTxt){
      tipo = TIPOS_PARTIDA.find(t => norm(t) === norm(tipoTxt)) || "";
      if (!tipo) L.erros.push(`tipo "${tipoTxt}" não existe (use ${TIPOS_PARTIDA.join(", ")})`);
    }
    const stTxt = norm(texto(cel(row, "Status")));
    let status = "";
    if (stTxt){
      if (["agendado", "agendada"].includes(stTxt)) status = "agendado";
      else if (["realizado", "realizada"].includes(stTxt)) status = "realizado";
      else L.erros.push(`status "${texto(cel(row, "Status"))}" inválido (use Agendado ou Realizado)`);
    }
    const pn = lerInteiro(cel(row, "Placar nosso"), "placar nosso"); if (pn.erro) L.erros.push(pn.erro);
    const pa = lerInteiro(cel(row, "Placar adversário"), "placar adversário"); if (pa.erro) L.erros.push(pa.erro);
    const temPlacar = !pn.vazio && !pn.erro || !pa.vazio && !pa.erro;
    if (!status) status = temPlacar ? "realizado" : "agendado";
    if (status === "agendado" && temPlacar) L.erros.push("partida agendada não pode ter placar (marque como Realizado ou apague o placar)");
    if (status === "realizado" && (pn.vazio || pa.vazio) && !pn.erro && !pa.erro) L.avisos.push("realizada sem placar completo");

    const advId = advNome ? (advPorNome[norm(advNome)] || null) : null;
    const campoId = campoNome ? (campoPorNome[norm(campoNome)] || null) : null;
    L.novoAdversario = advNome && !advId ? advNome : null;
    L.novoCampo = campoNome && !campoId ? campoNome : null;

    L.resumo = `${dataBR(data.valor)} · ${advNome || "?"}${q.valor ? ` · ${rotuloQuadroImp(q.valor)}` : ""}`;
    if (data.valor && advNome){
      L.chave = chaveJogo(data.valor, advNome, q.valor);
      if (vistos[L.chave]) L.erros.push(`partida repetida na planilha (linha ${vistos[L.chave]})`);
      else vistos[L.chave] = n;
    }

    L.dados = {
      data: data.valor || "", horario: hor.valor || "", status,
      adversarioId: advId, campoId, tipoPartida: tipo,
      placarNos: pn.vazio || pn.erro ? null : pn.valor,
      placarAdversario: pa.vazio || pa.erro ? null : pa.valor,
      observacoes: texto(cel(row, "Observações")),
    };
    if (ehFutsal()) L.dados.quadro = q.valor || "";
    L.parcial = {};
    if (hor.valor) L.parcial.horario = hor.valor;
    if (campoId) L.parcial.campoId = campoId;
    if (tipo) L.parcial.tipoPartida = tipo;
    if (texto(cel(row, "Status"))) L.parcial.status = status;
    if (!pn.vazio && !pn.erro) L.parcial.placarNos = pn.valor;
    if (!pa.vazio && !pa.erro) L.parcial.placarAdversario = pa.valor;
    if (L.dados.observacoes) L.parcial.observacoes = L.dados.observacoes;
    L.advNome = advNome; L.campoNome = campoNome;

    const ex = advId && data.valor ? jogoExistente[chaveJogo(data.valor, advNome, q.valor)] : null;
    if (ex && !L.erros.length){ L.existenteId = ex.id; L.detalhe = "já cadastrada"; }
    else if (!L.erros.length) L.novoId = novoIdDoc("jogos");   // id definido já aqui, para Gols e Participantes apontarem para ele
    linhas.push(L);
  }
  if (ws.rowCount > MAX_LINHAS + 1) linhas.push({ linha: MAX_LINHAS + 2, erros: [`a aba tem mais de ${MAX_LINHAS} linhas; importe o resto em outro arquivo`], resumo: "Limite de linhas" });
  return linhas;
}

// ----------------------------------------------------------------------------
// Gols e Participantes: cada linha aponta para uma partida (data + adversário + quadro)
// da aba Partidas ou já cadastrada, e para jogadores da aba Jogadores ou já cadastrados.
// ----------------------------------------------------------------------------
function mapaJogadores(state, jogadoresLinhas){
  const m = {};
  state.atletas.forEach(a => { m[norm(a.nome)] = a.id; });
  (jogadoresLinhas || []).forEach(l => { if (!l.erros.length && l.novoId && l.dados?.nome) m[norm(l.dados.nome)] = l.novoId; });
  return m;
}

function mapaPartidas(state, partidasLinhas){
  const m = {};
  state.jogos.forEach(j => {
    const an = state.adversarios.find(a => a.id === j.adversarioId)?.nome;
    if (an) m[chaveJogo(j.data, an, j.quadro)] = { id: j.id, jogo: j, status: j.status, placarNos: j.placarNos };
  });
  (partidasLinhas || []).forEach(l => {
    if (!l.chave) return;
    if (l.erros.length){ m[l.chave] = { erro: true, linha: l.linha }; return; }
    if (l.existenteId){
      const ex = state.jogos.find(j => j.id === l.existenteId);
      m[l.chave] = { id: ex.id, jogo: ex, status: l.parcial.status || ex.status, placarNos: l.parcial.placarNos ?? ex.placarNos };
    } else {
      m[l.chave] = { id: l.novoId, jogo: null, status: l.dados.status, placarNos: l.dados.placarNos };
    }
  });
  return m;
}

// Lê a identificação da partida (as 3 primeiras colunas) e devolve o alvo ou preenche o erro.
function alvoDaPartida(L, row, cel, comQuadro, partidas){
  const data = lerData(cel(row, "Data"));
  if (data.vazio) L.erros.push("data em branco"); else if (data.erro) L.erros.push(data.erro);
  const advNome = texto(cel(row, "Adversário")); if (!advNome) L.erros.push("adversário em branco");
  const q = comQuadro ? lerQuadro(cel(row, "Quadro")) : { valor: "" };
  if (q.erro) L.erros.push(q.erro);
  L.base = `${dataBR(data.valor)} · ${advNome || "?"}${q.valor ? ` · ${rotuloQuadroImp(q.valor)}` : ""}`;
  if (!data.valor || !advNome || q.erro) return null;
  const alvo = partidas[chaveJogo(data.valor, advNome, q.valor)];
  if (!alvo){ L.erros.push(`partida não encontrada: cadastre na aba Partidas ou confira data, adversário${ehFutsal() ? " e quadro" : ""}`); return null; }
  if (alvo.erro){ L.erros.push(`a partida desta linha está com erro na aba Partidas (linha ${alvo.linha})`); return null; }
  if (alvo.status !== "realizado"){ L.erros.push("a partida ainda não está como Realizada (gols e participantes só entram em partidas realizadas)"); return null; }
  return alvo;
}

const TEMPO_ALIAS = { "1": "1º tempo", "1o": "1º tempo", "1º": "1º tempo", primeiro: "1º tempo", "2": "2º tempo", "2o": "2º tempo", "2º": "2º tempo", segundo: "2º tempo" };

function lerGols(ws, state, partidasLinhas, jogadoresLinhas){
  const linhas = [];
  if (!ws) return linhas;
  const m = mapaColunas(ws);
  if (!temColuna(m, "Data") || !temColuna(m, "Adversário") || !temColuna(m, "Autor do gol")) return [{ linha: 1, erros: ["A aba Gols precisa ter as colunas Data, Adversário e Autor do gol."], resumo: "Cabeçalho" }];
  const cel = (row, nome) => celula(m, row, nome);
  const comQuadro = ehFutsal() && temColuna(m, "Quadro");
  const jog = mapaJogadores(state, jogadoresLinhas), partidas = mapaPartidas(state, partidasLinhas);
  const porJogo = {};
  const nomesColunas = colsGols();

  for (let n = 2; n <= Math.min(ws.rowCount, LIM.gols + 1); n++){
    const row = ws.getRow(n);
    if (nomesColunas.every(nome => texto(cel(row, nome)) === "")) continue;
    const L = { linha: n, erros: [], avisos: [], tipo: "gol" };
    const alvo = alvoDaPartida(L, row, cel, comQuadro, partidas);

    const autorTxt = texto(cel(row, "Autor do gol"));
    let autorId = null;
    if (!autorTxt) L.erros.push("autor do gol em branco (escreva o jogador ou \"Gol contra\")");
    else if (norm(autorTxt) === "gol contra") autorId = GOL_CONTRA_ID;
    else { autorId = jog[norm(autorTxt)] || null; if (!autorId) L.erros.push(`jogador "${autorTxt}" não encontrado (escreva igual ao nome na aba Jogadores)`); }

    const assistTxt = texto(cel(row, "Assistência"));
    let assistId = null;
    if (assistTxt){
      if (norm(assistTxt) === "gol contra") L.erros.push("assistência não pode ser \"Gol contra\"");
      else { assistId = jog[norm(assistTxt)] || null; if (!assistId) L.erros.push(`assistência: jogador "${assistTxt}" não encontrado`); }
      if (autorId === GOL_CONTRA_ID) L.erros.push("gol contra não tem assistência");
      if (assistId && assistId === autorId) L.erros.push("autor e assistência são o mesmo jogador");
    }

    const minTxt = texto(cel(row, "Minuto"));
    let minuto = null;
    if (minTxt !== ""){
      const v = Number(minTxt.replace(",", "."));
      if (!Number.isInteger(v) || v < 0 || v > 150) L.erros.push(`minuto "${minTxt}" deve ser um número inteiro de 0 a 150`);
      else minuto = v;
    }
    const tempoTxt = texto(cel(row, "Tempo"));
    let tempo = null;
    if (tempoTxt){
      tempo = TEMPOS_JOGO.find(t => norm(t) === norm(tempoTxt)) || TEMPO_ALIAS[norm(tempoTxt)] || null;
      if (!tempo) L.erros.push(`tempo "${tempoTxt}" inválido (use ${TEMPOS_JOGO.join(" ou ")})`);
    }
    const tipoTxt = texto(cel(row, "Como foi o gol"));
    let tipoGol = null;
    if (tipoTxt){
      tipoGol = TIPOS_GOL.find(t => norm(t) === norm(tipoTxt)) || null;
      if (!tipoGol) L.erros.push(`"${tipoTxt}" não é um tipo de gol (use ${TIPOS_GOL.join(", ")})`);
    }

    L.resumo = `${L.base} · ${autorTxt || "?"}${assistTxt ? ` (assist. ${assistTxt})` : ""}`;
    L.evento = { atletaGolId: autorId, atletaAssistId: assistId, minuto, tipoGol, tempo };
    if (alvo && !L.erros.length){
      L.alvoId = alvo.id;
      if (alvo.jogo && (alvo.jogo.golsAssistencias || []).length){ L.existenteId = alvo.jogo.id; L.detalhe = "a partida já tem gols lançados"; }
      (porJogo[alvo.id] = porJogo[alvo.id] || { linhas: [], placar: alvo.placarNos }).linhas.push(L);
    }
    linhas.push(L);
  }
  // O número de gols deve bater com o placar nosso (gol contra conta para o time)
  Object.values(porJogo).forEach(g => {
    if (typeof g.placar === "number" && g.placar !== g.linhas.length) g.linhas[0].avisos.push(`placar nosso ${g.placar}, mas ${g.linhas.length} gol${g.linhas.length === 1 ? "" : "s"} lançado${g.linhas.length === 1 ? "" : "s"}`);
  });
  if (ws.rowCount > LIM.gols + 1) linhas.push({ linha: LIM.gols + 2, erros: [`a aba tem mais de ${LIM.gols} linhas; importe o resto em outro arquivo`], resumo: "Limite de linhas" });
  return linhas;
}

function lerParticipantes(ws, state, partidasLinhas, jogadoresLinhas){
  const linhas = [];
  if (!ws) return linhas;
  const m = mapaColunas(ws);
  if (!temColuna(m, "Data") || !temColuna(m, "Adversário") || !temColuna(m, "Jogador")) return [{ linha: 1, erros: ["A aba Participantes precisa ter as colunas Data, Adversário e Jogador."], resumo: "Cabeçalho" }];
  const cel = (row, nome) => celula(m, row, nome);
  const comQuadro = ehFutsal() && temColuna(m, "Quadro");
  const jog = mapaJogadores(state, jogadoresLinhas), partidas = mapaPartidas(state, partidasLinhas);
  const nomesColunas = colsParticipantes();
  const vistos = {};

  for (let n = 2; n <= Math.min(ws.rowCount, LIM.participantes + 1); n++){
    const row = ws.getRow(n);
    if (nomesColunas.every(nome => texto(cel(row, nome)) === "")) continue;
    const L = { linha: n, erros: [], avisos: [], tipo: "participante" };
    const alvo = alvoDaPartida(L, row, cel, comQuadro, partidas);
    const nome = texto(cel(row, "Jogador"));
    let atletaId = null;
    if (!nome) L.erros.push("jogador em branco");
    else { atletaId = jog[norm(nome)] || null; if (!atletaId) L.erros.push(`jogador "${nome}" não encontrado (escreva igual ao nome na aba Jogadores)`); }
    L.resumo = `${L.base} · ${nome || "?"}`;
    L.atletaId = atletaId;
    if (alvo && atletaId && !L.erros.length){
      L.alvoId = alvo.id;
      const k = `${alvo.id}|${atletaId}`;
      if (vistos[k]) L.erros.push(`jogador repetido nesta partida (linha ${vistos[k]})`);
      else vistos[k] = n;
      if (!L.erros.length && alvo.jogo && idsDaPartida(alvo.jogo).has(atletaId)){ L.existenteId = alvo.jogo.id; L.detalhe = "já está na partida"; }
    }
    linhas.push(L);
  }
  if (ws.rowCount > LIM.participantes + 1) linhas.push({ linha: LIM.participantes + 2, erros: [`a aba tem mais de ${LIM.participantes} linhas; importe o resto em outro arquivo`], resumo: "Limite de linhas" });
  return linhas;
}

// ----------------------------------------------------------------------------
// Comparação com o que já está cadastrado: para cada linha de algo que já existe,
// descobre se a planilha realmente muda alguma coisa. Assim a prévia só marca
// "Atualiza" onde há diferença, e só isso é gravado.
// ----------------------------------------------------------------------------
const vazioV = (v) => v === null || v === undefined || v === "";
function igualValor(a, b){
  if (vazioV(a) && vazioV(b)) return true;
  if (vazioV(a) || vazioV(b)) return false;
  if (typeof a === "string" || typeof b === "string") return String(a).trim() === String(b).trim();
  return a === b;
}
const ROTULO_ATLETA = { nomeCompleto: "nome completo", posicao: "posição", numero: "número", ativo: "ativo", podeVotar: "direito a voto", pagante: "pagante", pagoDesde: "pago desde", observacoes: "observações", telefone: "telefone" };
const ROTULO_PARTIDA = { horario: "horário", campoId: "campo", tipoPartida: "tipo", status: "status", placarNos: "placar nosso", placarAdversario: "placar adversário", observacoes: "observações" };
const PADRAO_ATLETA = { ativo: true, podeVotar: false, pagante: false };
const soDigitos = (v) => String(v || "").replace(/\D/g, "");

function assinaturaGol(e){
  return [e.atletaGolId || "", e.atletaAssistId || "", e.minuto ?? "", e.tipoGol || "", e.tempo || ""].join("|");
}

async function marcarMudancas(state, { jogadores, partidas, gols, participantes }){
  // Jogadores: campos preenchidos que diferem do cadastro + telefone (dado privado, lido à parte)
  await Promise.all(jogadores.map(async (L) => {
    if (!L.existenteId) return;
    const ex = state.atletas.find(a => a.id === L.existenteId) || {};
    L.mudancas = {};
    Object.entries(L.parcial).forEach(([k, v]) => {
      const atual = ex[k] === undefined && k in PADRAO_ATLETA ? PADRAO_ATLETA[k] : ex[k];
      if (!igualValor(atual, v)) L.mudancas[k] = v;
    });
    const campos = Object.keys(L.mudancas).map(k => ROTULO_ATLETA[k] || k);
    L.telMudou = false;
    if (L.telefone){
      let atualTel = null;
      try{ atualTel = (await getPrivateDoc("atletas_privado", L.existenteId)).telefone || ""; }
      catch(_){ atualTel = null; }   // não conseguiu ler: considera que muda
      L.telMudou = atualTel === null || soDigitos(atualTel) !== soDigitos(L.telefone);
      if (L.telMudou) campos.push(ROTULO_ATLETA.telefone);
    }
    L.mudou = campos.length > 0;
    L.detalhe = L.mudou ? `muda: ${campos.join(", ")}` : "já cadastrado, sem diferenças";
  }));

  // Partidas
  partidas.forEach(L => {
    if (!L.existenteId) return;
    const ex = state.jogos.find(j => j.id === L.existenteId) || {};
    L.mudancas = {};
    Object.entries(L.parcial).forEach(([k, v]) => { if (!igualValor(ex[k], v)) L.mudancas[k] = v; });
    const campos = Object.keys(L.mudancas).map(k => ROTULO_PARTIDA[k] || k);
    L.mudou = campos.length > 0;
    L.detalhe = L.mudou ? `muda: ${campos.join(", ")}` : "já cadastrada, sem diferenças";
  });

  // Gols: compara a lista da planilha (por partida) com a que já está na partida
  const grupos = new Map();
  gols.forEach(L => { if (L.existenteId && !L.erros.length) (grupos.get(L.alvoId) || grupos.set(L.alvoId, []).get(L.alvoId)).push(L); });
  grupos.forEach((linhas, id) => {
    const ex = state.jogos.find(j => j.id === id);
    const atual = (ex?.golsAssistencias || []).map(assinaturaGol).sort().join("\n");
    const novo = linhas.map(l => assinaturaGol(l.evento)).sort().join("\n");
    const mudou = atual !== novo;
    linhas.forEach(l => {
      l.mudou = mudou;
      l.detalhe = mudou ? "a lista de gols desta partida será substituída" : "a partida já tem exatamente esses gols";
    });
  });

  // Participantes que já estão na partida: não há o que mudar
  participantes.forEach(L => { if (L.existenteId){ L.mudou = false; L.detalhe = "já está na partida"; } });
}

// Linha que será gravada: sem erro e (nova, ou já existente com diferença e "Atualizar" marcado)
const vaiGravar = (l, atualiza) => !l.erros.length && (!l.existenteId || (atualiza && !!l.mudou));

async function lerArquivo(arquivo, state){
  const ExcelJS = await carregarExcelJS();
  const wb = new ExcelJS.Workbook();
  try{ await wb.xlsx.load(await arquivo.arrayBuffer()); }
  catch(err){ throw new Error("Não consegui abrir esse arquivo. Envie uma planilha Excel (.xlsx) salva a partir do modelo."); }
  // Planilha de outra modalidade (futsal x campo) não serve para este time.
  const marca = String(wb.subject || "").match(/modalidade:(futsal|campo)/);
  if (marca && (marca[1] === "futsal") !== ehFutsal()){
    throw new Error(`Essa planilha é do modelo de ${marca[1] === "futsal" ? "futsal" : "campo"}, mas este time é de ${modalidadeAtual().nome}. Baixe o modelo nesta tela, com o botão "Baixar modelo em branco".`);
  }
  const wj = wb.getWorksheet("Jogadores"), wp = wb.getWorksheet("Partidas");
  const wg = wb.getWorksheet("Gols"), wq = wb.getWorksheet("Participantes");
  if (!wj && !wp && !wg && !wq) throw new Error("O arquivo não tem as abas \"Jogadores\", \"Partidas\", \"Gols\" ou \"Participantes\". Use o modelo baixado nesta tela.");
  const jogadores = lerJogadores(wj, state);
  const partidas = lerPartidas(wp, state);
  const resultado = { jogadores, partidas, gols: lerGols(wg, state, partidas, jogadores), participantes: lerParticipantes(wq, state, partidas, jogadores) };
  await marcarMudancas(state, resultado);
  return resultado;
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
      <a href="#cadastros" class="btn btn-ghost btn-sm">&larr; Cadastros</a>
    </div>

    <div class="card card-pad" style="margin-bottom:14px;">
      <div class="card-title">1. Baixe a planilha</div>
      <div class="card-sub">Modelo de <strong>${escapeHtml(modalidadeAtual().nome)}</strong>, com as abas <strong>Jogadores</strong>, <strong>Partidas</strong>${ehFutsal() ? " (com a coluna Quadro)" : ""}, <strong>Gols</strong> (autor e assistência de cada gol) e <strong>Participantes</strong> (quem jogou cada partida), com listas de opções. Se preferir, exporte o que já está cadastrado, edite no Excel e envie de volta.</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn btn-primary" id="imp-modelo">Baixar modelo em branco</button>
        <button class="btn btn-ghost" id="imp-exportar">Exportar os dados atuais</button>
      </div>
    </div>

    <div class="card card-pad" style="margin-bottom:14px;">
      <div class="card-title">2. Preencha no Excel</div>
      <div class="card-sub" style="margin-bottom:0;">Uma linha por jogador, partida, gol ou participante; a aba <em>Como usar</em> explica cada coluna. Preencha na ordem das abas (Jogadores, Partidas, Gols, Participantes) e escreva nomes de jogadores e adversários sempre iguais. Não é preciso preencher todas as abas. Notas de avaliação não entram por aqui.</div>
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
  const unicos = (ls) => ls[0]?.tipo === "gol" ? new Set(ls.map(l => l.alvoId)).size : ls.length;
  const ok = linhas.filter(l => !l.erros.length);
  return {
    novos: ok.filter(l => !l.existenteId).length,
    // gols: conta partidas (várias linhas de gol pertencem à mesma partida); demais abas: linhas
    existentes: unicos(ok.filter(l => l.existenteId)),
    comMudanca: unicos(ok.filter(l => l.existenteId && l.mudou)),
    aGravar: ok.filter(l => vaiGravar(l, atualiza)).length,
    erros: linhas.filter(l => l.erros.length).length,
  };
}

function desenharPrevia(root, state){
  const alvo = $("#imp-previa", root);
  if (!alvo || !previa) return;
  const { jogadores, partidas, gols, participantes } = previa;
  const cj = contar(jogadores, atualizarExistentes), cp = contar(partidas, atualizarExistentes);
  const cg = contar(gols, atualizarExistentes), cq = contar(participantes, atualizarExistentes);
  const totalGravar = cj.aGravar + cp.aGravar + cg.aGravar + cq.aGravar;
  const novosAdv = [...new Set(partidas.filter(l => l.novoAdversario && vaiGravar(l, atualizarExistentes)).map(l => norm(l.novoAdversario)))];
  const novosCampos = [...new Set(partidas.filter(l => l.novoCampo && vaiGravar(l, atualizarExistentes)).map(l => norm(l.novoCampo)))];
  const nomeBonito = (lista, chave, campo) => lista.find(l => norm(l[campo]) === chave)?.[campo] || chave;

  const linhaHtml = (l, aba) => {
    let etiqueta, cls;
    if (l.erros.length){ etiqueta = "Erro"; cls = "badge-off"; }
    else if (l.existenteId && !l.mudou){ etiqueta = "Sem mudança"; cls = "badge-off"; }
    else if (l.existenteId){ etiqueta = atualizarExistentes ? "Atualiza" : "Mudou — ignorada"; cls = atualizarExistentes ? "badge-pending" : "badge-off"; }
    else { etiqueta = "Novo"; cls = "badge-ok"; }
    const msgs = [...l.erros, ...(l.avisos || []), ...(l.existenteId && !l.erros.length && l.detalhe ? [l.detalhe] : []), ...(l.telefone && !l.erros.length && !l.existenteId ? ["com telefone"] : []), ...(l.novoAdversario && !l.erros.length ? [`adversário novo: ${l.novoAdversario}`] : []), ...(l.novoCampo && !l.erros.length ? [`campo novo: ${l.novoCampo}`] : [])];
    return `<tr>
      <td>${aba}</td><td>${l.linha}</td><td><strong>${escapeHtml(l.resumo || "")}</strong></td>
      <td><span class="badge ${cls}">${etiqueta}</span></td>
      <td style="font-size:12.5px; color:${l.erros.length ? "var(--danger)" : "var(--ink-soft)"};">${escapeHtml(msgs.join("; "))}</td></tr>`;
  };
  // erros primeiro (para não ficarem escondidos)
  const ordenadas = [...jogadores.map(l => [l, "Jogadores"]), ...partidas.map(l => [l, "Partidas"]), ...gols.map(l => [l, "Gols"]), ...participantes.map(l => [l, "Participantes"])]
    .sort((a, b) => (b[0].erros.length ? 1 : 0) - (a[0].erros.length ? 1 : 0))
    .map(([l, aba]) => linhaHtml(l, aba));

  alvo.innerHTML = `
    <div class="manchete" style="margin-bottom:12px;">
      <div class="manchete-eyebrow">${escapeHtml(nomeArquivo)}</div>
      <div class="manchete-titulo">${totalGravar} registro${totalGravar === 1 ? "" : "s"} pronto${totalGravar === 1 ? "" : "s"} para importar</div>
      <div class="manchete-sub">
        Jogadores: ${cj.novos} novo${cj.novos === 1 ? "" : "s"}, ${cj.existentes} já existe${cj.existentes === 1 ? "" : "m"}${cj.existentes ? ` (${cj.comMudanca} com mudança)` : ""}, ${cj.erros} com erro ·
        Partidas: ${cp.novos} nova${cp.novos === 1 ? "" : "s"}, ${cp.existentes} já existe${cp.existentes === 1 ? "" : "m"}${cp.existentes ? ` (${cp.comMudanca} com mudança)` : ""}, ${cp.erros} com erro
        ${gols.length ? `<br>Gols: ${cg.novos} novo${cg.novos === 1 ? "" : "s"}, ${cg.existentes} de partida${cg.existentes === 1 ? "" : "s"} que já ${cg.existentes === 1 ? "tem" : "têm"} gols${cg.existentes ? ` (${cg.comMudanca} com lista diferente)` : ""}, ${cg.erros} com erro` : ""}
        ${participantes.length ? `<br>Participantes: ${cq.novos} novo${cq.novos === 1 ? "" : "s"}, ${cq.existentes} já ${cq.existentes === 1 ? "está" : "estão"} na partida, ${cq.erros} com erro` : ""}
        ${novosAdv.length || novosCampos.length ? `<br>Serão cadastrados também: ${novosAdv.length} adversário${novosAdv.length === 1 ? "" : "s"} (${escapeHtml(novosAdv.map(c => nomeBonito(partidas, c, "novoAdversario")).join(", ") || "—")}) e ${novosCampos.length} campo${novosCampos.length === 1 ? "" : "s"} (${escapeHtml(novosCampos.map(c => nomeBonito(partidas, c, "novoCampo")).join(", ") || "—")}).` : ""}
      </div>
    </div>
    ${(() => { const n = jogadores.filter(l => !l.erros.length && l.existenteId && l.telMudou).length; return n && !atualizarExistentes ? `<div class="landing-aviso" style="margin-bottom:12px;">${n} telefone${n === 1 ? "" : "s"} de jogador${n === 1 ? "" : "es"} já cadastrado${n === 1 ? "" : "s"} ${n === 1 ? "é diferente do que está no app e" : "são diferentes do que está no app e"} <strong>${n === 1 ? "não será gravado" : "não serão gravados"}</strong>. Marque "Atualizar também os que já existem" abaixo para gravar.</div>` : ""; })()}
    ${cj.erros + cp.erros + cg.erros + cq.erros ? `<div class="landing-aviso" style="margin-bottom:12px;">As linhas com erro <strong>não serão importadas</strong>. Corrija no Excel e envie de novo, ou importe só as que estão certas.</div>` : ""}
    ${cj.comMudanca + cp.comMudanca + cg.comMudanca ? `<label style="display:flex; align-items:center; gap:8px; font-size:13.5px; margin-bottom:12px;"><input type="checkbox" id="imp-atualizar" ${atualizarExistentes ? "checked" : ""} style="width:16px;height:16px;"> Atualizar também os que já existem e mudaram (só os campos que diferem; nos gols, a lista da partida é substituída pela da planilha)</label>` : ""}
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
  const ok = (l) => vaiGravar(l, atualiza);
  const jog = previa.jogadores.filter(ok);
  const par = previa.partidas.filter(ok);
  const gol = previa.gols.filter(l => ok(l) && l.alvoId);
  const part = previa.participantes.filter(l => ok(l) && l.alvoId);
  if (!jog.length && !par.length && !gol.length && !part.length) return;
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
      if (l.existenteId){ if (Object.keys(l.mudancas || {}).length) itens.push({ colecao: "atletas", id: l.existenteId, existente: true, dados: l.mudancas }); }
      else itens.push({ colecao: "atletas", id: l.novoId, existente: false, dados: l.dados });
      // telefone: dado privado, em documento à parte (mesmo id do atleta). Só quem tem telefone preenchido.
      if (l.telefone && (!l.existenteId || l.telMudou)) itens.push({ colecao: "atletas_privado", id: l.existenteId || l.novoId, mesclar: true, dados: { telefone: l.telefone } });
    });

    // gols e participantes agrupados por partida (id da partida -> { gols, rel })
    const porJogo = new Map();
    const doJogo = (id) => { if (!porJogo.has(id)) porJogo.set(id, { gols: null, rel: null }); return porJogo.get(id); };
    gol.forEach(l => {
      const g = doJogo(l.alvoId);
      g.gols = g.gols || []; g.rel = g.rel || new Set();
      g.gols.push(l.evento);
      [l.evento.atletaGolId, l.evento.atletaAssistId].forEach(id => { if (id && id !== GOL_CONTRA_ID) g.rel.add(id); });
    });
    part.forEach(l => { const g = doJogo(l.alvoId); g.rel = g.rel || new Set(); g.rel.add(l.atletaId); });

    const atualizacoes = new Map();   // partidas já existentes: id -> campos a atualizar
    par.forEach(l => {
      if (l.existenteId){ atualizacoes.set(l.existenteId, { ...(l.mudancas || {}) }); return; }
      const dados = { ...l.dados };
      if (!dados.adversarioId) dados.adversarioId = novosAdv[norm(l.novoAdversario)];
      if (!dados.campoId) dados.campoId = novosCampos[norm(l.novoCampo)];
      const g = porJogo.get(l.novoId);
      Object.assign(dados, {
        decisao: "", penaltisNos: null, penaltisAdversario: null, criterioVencedor: "", criterioMotivo: "",
        escalacaoInicial: [], escalacaoFinal: [], avaliacoesJogadores: {},
        relacionados: g?.rel ? [...g.rel] : [], golsAssistencias: g?.gols || [],
      });
      porJogo.delete(l.novoId);
      itens.push({ colecao: "jogos", id: l.novoId, existente: false, dados });
    });
    // o que sobrou em porJogo são partidas que já existiam: só acrescenta
    porJogo.forEach((g, id) => {
      const ex = state.jogos.find(j => j.id === id);
      if (!ex) return;
      const campos = atualizacoes.get(id) || {};
      if (g.gols) campos.golsAssistencias = g.gols;
      if (g.rel) campos.relacionados = [...new Set([...(ex.relacionados || []), ...g.rel])];
      atualizacoes.set(id, campos);
    });
    atualizacoes.forEach((dados, id) => { if (Object.keys(dados).length) itens.push({ colecao: "jogos", id, existente: true, dados }); });

    await importarEmLote(itens);
    const txt = (n, s, p) => `${n} ${n === 1 ? s : p}`;
    const resumo = [txt(jog.length, "jogador", "jogadores"), txt(par.length, "partida", "partidas")];
    const nTel = jog.filter(l => l.telefone && (!l.existenteId || l.telMudou)).length;
    if (nTel) resumo.push(txt(nTel, "telefone", "telefones"));
    if (gol.length) resumo.push(txt(gol.length, "gol", "gols"));
    if (part.length) resumo.push(txt(part.length, "participante", "participantes"));
    const frase = resumo.length > 2 ? resumo.slice(0, -1).join(", ") + " e " + resumo[resumo.length - 1] : resumo.join(" e ");
    toast(`Importação concluída: ${frase}.`, "ok");
    previa = null; nomeArquivo = ""; atualizarExistentes = false;
    const alvo = $("#imp-previa", root);
    if (alvo) alvo.innerHTML = `
      <div class="manchete"><div class="manchete-eyebrow">Pronto</div>
      <div class="manchete-titulo">${escapeHtml(frase)} importados</div>
      <div class="manchete-sub"><a href="#atletas">Ver atletas</a> · <a href="#jogos">Ver partidas</a> · <a href="#ranking">Ver ranking</a></div></div>`;
    const f = $("#imp-arquivo", root); if (f) f.value = "";
  }catch(err){
    console.error(err);
    toast("Não foi possível importar: " + (err.message || err), "err");
    const b = $("#imp-gravar", root); if (b){ b.disabled = false; b.textContent = "Tentar de novo"; }
  }finally{
    gravando = false;
  }
}
