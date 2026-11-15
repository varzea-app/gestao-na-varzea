import { $, escapeHtml, fmt1 } from "../utils.js";
import { jogosRealizados, statsPorAtleta, ehJogador, jogosPorConfronto, idsDaPartida, mediaGeralJogadores, mediaNotaJogadoresNoJogo, golsEAssistenciasPorAtleta, resultadoJogo, notasDoAtletaNoJogo, normalizeEscalacao } from "../stats.js";
import { posicoesDaModalidade, posicaoNaModalidade, ordemPosicao } from "../modalidade.js";
import { MESES, anosDisponiveis, filtrarPorQuadro, quadroChipsHtml, wireQuadroChips, contarPorConfronto } from "../filters.js";

// Evolução do ano: mês a mês, como o time (ou um jogador) foi indo.
// Gráficos em SVG puro (sem biblioteca) que seguem o tema claro/escuro.
// Abaixo dos gráficos, uma leitura automática: melhor/pior mês, tendência dos
// últimos meses, ataque x defesa e se nota e resultado andam juntos.

const MES_CURTO = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

let filtroAno = "";
let filtroAtleta = "";   // "" = time todo

const soma = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const num = (v) => typeof v === "number" && !isNaN(v);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// ----------------------------------------------------------------------------
// Cálculo mês a mês
// ----------------------------------------------------------------------------
function calcularMeses(realizadosAno, atleta, porConfronto){
  const meses = [];
  for (let m = 1; m <= 12; m++){
    const mm = String(m).padStart(2, "0");
    const doMes = realizadosAno.filter(j => (j.data || "").slice(5, 7) === mm);
    const jogou = (j) => atleta ? idsDaPartida(j).has(atleta.id) : true;

    // Unidade de resultado: confronto (soma dos quadros) no Geral, ou a própria partida.
    let unidades = porConfronto ? jogosPorConfronto(doMes) : doMes;
    if (atleta) unidades = unidades.filter(u => u.jogosOriginais ? u.jogosOriginais.some(jogou) : jogou(u));
    let v = 0, e = 0, d = 0;
    unidades.forEach(u => { const r = resultadoJogo(u); if (r === "vitoria") v++; else if (r === "empate") e++; else if (r === "derrota") d++; });
    const nUn = v + e + d;

    const comPlacar = doMes.filter(j => num(j.placarNos) && num(j.placarAdversario));
    const golsPro = soma(comPlacar, j => j.placarNos), golsContra = soma(comPlacar, j => j.placarAdversario);

    const jogosAtleta = atleta ? doMes.filter(jogou) : [];
    const st = atleta ? statsPorAtleta([atleta], doMes)[0] : null;
    meses.push({
      m, curto: MES_CURTO[m - 1], nome: MESES[m - 1],
      partidas: doMes.length, nUn, v, e, d,
      aprov: nUn ? (v * 3 + e) / (nUn * 3) * 100 : null,
      pts: v * 3 + e,
      nPlacar: comPlacar.length, golsPro, golsContra,
      gpp: comPlacar.length ? golsPro / comPlacar.length : null,
      gcp: comPlacar.length ? golsContra / comPlacar.length : null,
      nota: atleta ? (st.media ?? null) : (mediaGeralJogadores(doMes) ?? null),
      gols: st ? st.gols : 0, assist: st ? st.assistencias : 0,
      jogou: jogosAtleta.length,
    });
  }
  return meses;
}

// ----------------------------------------------------------------------------
// Gráficos (SVG)
// ----------------------------------------------------------------------------
const W = 480, H = 270, PL = 40, PR = 20, PT = 28, PB = 46;

function eixos(labels, subs, yMin, yMax, passo, fmtY){
  const n = labels.length;
  const y = (v) => PT + (1 - (v - yMin) / (yMax - yMin)) * (H - PT - PB);
  let s = "";
  for (let v = yMin; v <= yMax + 1e-9; v += passo){
    s += `<line x1="${PL}" x2="${W - PR}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)" stroke-width="1"/>`;
    s += `<text x="${PL - 8}" y="${y(v) + 4}" text-anchor="end" font-size="13" style="fill:var(--ink-faint)">${fmtY(v)}</text>`;
  }
  return { y, base: s, n };
}

function rotulosX(labels, subs, xf){
  return labels.map((l, i) => `<text x="${xf(i)}" y="${H - PB + 18}" text-anchor="middle" font-size="13" style="fill:var(--ink-soft)">${l}</text>` +
    (subs[i] ? `<text x="${xf(i)}" y="${H - PB + 33}" text-anchor="middle" font-size="11" style="fill:var(--ink-faint)">${subs[i]}</text>` : "")).join("");
}

// séries: [{ nome, cor, valores:[num|null], pouco:[bool], fmt, rotulo:"cima"|"baixo", titulos:[string] }]
function graficoLinhas({ labels, subs, series, yMin, yMax, passo, fmtY, ref }){
  const n = labels.length;
  const x = (i) => n === 1 ? PL + (W - PL - PR) / 2 : PL + i * (W - PL - PR) / (n - 1);
  const { y, base } = eixos(labels, subs, yMin, yMax, passo, fmtY);
  let s = base;
  if (ref && num(ref.valor)){
    s += `<line x1="${PL}" x2="${W - PR}" y1="${y(ref.valor)}" y2="${y(ref.valor)}" style="stroke:var(--ink-faint)" stroke-width="1.2" stroke-dasharray="5 4"/>`;
  }
  series.forEach(sr => {
    // segmentos contínuos (mês sem dado quebra a linha)
    let seg = [];
    const fecha = () => { if (seg.length > 1) s += `<polyline points="${seg.join(" ")}" fill="none" style="stroke:${sr.cor}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`; seg = []; };
    sr.valores.forEach((v, i) => { if (num(v)) seg.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`); else fecha(); });
    fecha();
    sr.valores.forEach((v, i) => {
      if (!num(v)) return;
      const oco = sr.pouco && sr.pouco[i];
      s += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="5.5" style="stroke:${sr.cor}; fill:${oco ? "var(--card)" : sr.cor}" stroke-width="2.2"><title>${escapeHtml(sr.titulos ? sr.titulos[i] : `${labels[i]}: ${sr.fmt(v)}`)}</title></circle>`;
      let dy = sr.rotulo === "baixo" ? 20 : -11;
      if (y(v) + dy > H - PB - 3) dy = -11;   // perto do eixo: rótulo vai para cima
      s += `<text x="${x(i).toFixed(1)}" y="${(y(v) + dy).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" style="fill:var(--ink)">${sr.fmt(v)}</text>`;
    });
  });
  s += rotulosX(labels, subs, x);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" style="display:block; height:auto;">${s}</svg>`;
}

// barras agrupadas ou empilhadas; séries: [{ nome, cor, valores:[num] }]
function graficoBarras({ labels, subs, series, empilhado, passo }){
  const n = labels.length;
  const totais = labels.map((_, i) => empilhado ? soma(series, sr => sr.valores[i] || 0) : Math.max(...series.map(sr => sr.valores[i] || 0)));
  const topo = Math.max(1, ...totais);
  const yMax = Math.ceil(topo / passo) * passo;
  const { y, base } = eixos(labels, subs, 0, yMax, passo, v => String(v));
  const faixa = (W - PL - PR) / n;
  const x0 = (i) => PL + i * faixa;
  const larg = Math.min(46, faixa * 0.62);
  let s = base;
  labels.forEach((l, i) => {
    const cx = x0(i) + faixa / 2;
    if (empilhado){
      let acc = 0;
      series.forEach(sr => {
        const v = sr.valores[i] || 0; if (!v) return;
        const yTop = y(acc + v), yBase = y(acc), h = yBase - yTop;
        s += `<rect x="${(cx - larg / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${larg.toFixed(1)}" height="${h.toFixed(1)}" rx="2" style="fill:${sr.cor}"><title>${escapeHtml(`${l}: ${v} ${sr.nome.toLowerCase()}`)}</title></rect>`;
        if (h >= 17) s += `<text x="${cx.toFixed(1)}" y="${(yTop + h / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">${v}</text>`;
        acc += v;
      });
      if (acc) s += `<text x="${cx.toFixed(1)}" y="${(y(acc) - 6).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" style="fill:var(--ink)">${acc}</text>`;
    } else {
      const lb = larg / series.length;
      series.forEach((sr, k) => {
        const v = sr.valores[i] || 0;
        const bx = cx - larg / 2 + k * lb;
        const h = y(0) - y(v);
        if (v) s += `<rect x="${bx.toFixed(1)}" y="${y(v).toFixed(1)}" width="${(lb - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2" style="fill:${sr.cor}"><title>${escapeHtml(`${l}: ${v} ${sr.nome.toLowerCase()}`)}</title></rect>`;
        if (v) s += `<text x="${(bx + (lb - 2) / 2).toFixed(1)}" y="${(y(v) - 5).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" style="fill:var(--ink)">${v}</text>`;
      });
    }
  });
  s += rotulosX(labels, subs, (i) => x0(i) + faixa / 2);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" style="display:block; height:auto;">${s}</svg>`;
}

const legenda = (itens) => `<div class="evo-leg">${itens.map(([cor, t]) => `<span><i style="background:${cor}"></i>${escapeHtml(t)}</span>`).join("")}</div>`;

// ----------------------------------------------------------------------------
// Leitura automática dos gráficos
// ----------------------------------------------------------------------------
const pct = (v) => `${Math.round(v)}%`;
const lista = (nomes) => nomes.length <= 1 ? (nomes[0] || "") : nomes.slice(0, -1).join(", ") + " e " + nomes[nomes.length - 1];

function pearson(pares){
  const n = pares.length; if (n < 4) return null;
  const mx = soma(pares, p => p[0]) / n, my = soma(pares, p => p[1]) / n;
  const sxy = soma(pares, p => (p[0] - mx) * (p[1] - my));
  const sx = Math.sqrt(soma(pares, p => (p[0] - mx) ** 2)), sy = Math.sqrt(soma(pares, p => (p[1] - my) ** 2));
  return sx && sy ? sxy / (sx * sy) : null;
}

// compara os últimos meses com os anteriores; devolve { rec, ant, nomes } ou null
function recenteVsAnterior(com, valorGrupo){
  if (com.length < 4) return null;
  const k = Math.min(3, Math.floor(com.length / 2));
  const rec = com.slice(-k), ant = com.slice(0, -k);
  return { rec: valorGrupo(rec), ant: valorGrupo(ant), nomes: k === 1 ? rec[0].nome : `${rec[0].curto}–${rec[k - 1].curto}`, k };
}

function leitura(meses, ctx){
  const out = [];
  const { atleta, porConfronto, ano, doAnoJogos } = ctx;
  const un = porConfronto ? "confronto" : "jogo", uns = porConfronto ? "confrontos" : "jogos";

  // Aproveitamento: melhor e pior mês
  const comRes = meses.filter(x => x.nUn > 0);
  if (comRes.length >= 2){
    const base = comRes.filter(x => x.nUn >= 2).length >= 2 ? comRes.filter(x => x.nUn >= 2) : comRes;
    const ord = [...base].sort((a, b) => b.aprov - a.aprov || b.nUn - a.nUn);
    const mel = ord[0], pio = ord[ord.length - 1];
    if (mel.aprov !== pio.aprov){
      out.push(`<strong>Aproveitamento${atleta ? " do time com " + escapeHtml(atleta.nome) + " em campo" : ""}:</strong> o melhor mês foi ${mel.nome} (${pct(mel.aprov)} em ${plural(mel.nUn, un, uns)}) e o mais fraco foi ${pio.nome} (${pct(pio.aprov)} em ${plural(pio.nUn, un, uns)}).`);
    } else {
      out.push(`<strong>Aproveitamento:</strong> manteve-se em ${pct(mel.aprov)} nos meses com jogos.`);
    }
    const t = recenteVsAnterior(comRes, g => soma(g, x => x.pts) / (soma(g, x => x.nUn) * 3) * 100);
    if (t){
      const dif = t.rec - t.ant;
      const frase = Math.abs(dif) < 5 ? "estável" : dif > 0 ? "em alta" : "em queda";
      out.push(`<strong>Tendência:</strong> em ${t.nomes} o aproveitamento foi de ${pct(t.rec)}, contra ${pct(t.ant)} nos meses anteriores — ${frase}${Math.abs(dif) >= 5 ? ` (${dif > 0 ? "+" : ""}${Math.round(dif)} pontos percentuais)` : ""}.`);
    }
  }

  // Nota média
  const comNota = meses.filter(x => num(x.nota));
  if (comNota.length >= 2){
    const ord = [...comNota].sort((a, b) => b.nota - a.nota);
    const t = recenteVsAnterior(comNota, g => soma(g, x => x.nota) / g.length);
    let f = `<strong>Nota média${atleta ? " de " + escapeHtml(atleta.nome) : ""}:</strong> pico em ${ord[0].nome} (${fmt1(ord[0].nota)}) e vale em ${ord[ord.length - 1].nome} (${fmt1(ord[ord.length - 1].nota)}).`;
    if (t){
      const dif = t.rec - t.ant;
      f += ` Em ${t.nomes} ficou em ${fmt1(t.rec)}, contra ${fmt1(t.ant)} antes — ${Math.abs(dif) < 0.3 ? "estável" : dif > 0 ? "em alta" : "em queda"}.`;
    }
    out.push(f);
  }
  const mesesJogoSemNota = meses.filter(x => (atleta ? x.jogou > 0 : x.partidas > 0) && !num(x.nota));
  if (mesesJogoSemNota.length && comNota.length) out.push(`<strong>Atenção:</strong> ${lista(mesesJogoSemNota.map(x => x.nome))} ${mesesJogoSemNota.length === 1 ? "teve jogos mas não tem" : "tiveram jogos mas não têm"} notas lançadas, então ${mesesJogoSemNota.length === 1 ? "esse mês fica" : "esses meses ficam"} em branco no gráfico de notas.`);

  if (!atleta){
    // Ataque x defesa
    const comGols = meses.filter(x => x.nPlacar > 0);
    const g = (grp, campo) => soma(grp, x => x[campo]) / soma(grp, x => x.nPlacar);
    const ta = recenteVsAnterior(comGols, grp => ({ pro: g(grp, "golsPro"), contra: g(grp, "golsContra") }));
    if (ta){
      const dp = ta.rec.pro - ta.ant.pro, dc = ta.rec.contra - ta.ant.contra;
      const atq = Math.abs(dp) < 0.2 ? "o ataque se manteve" : dp > 0 ? "o ataque melhorou" : "o ataque caiu";
      const def = Math.abs(dc) < 0.2 ? "a defesa se manteve" : dc < 0 ? "a defesa melhorou" : "a defesa piorou";
      out.push(`<strong>Ataque x defesa:</strong> em ${ta.nomes} o time fez ${fmt1(ta.rec.pro)} e sofreu ${fmt1(ta.rec.contra)} gols por partida (antes: ${fmt1(ta.ant.pro)} e ${fmt1(ta.ant.contra)}) — ${atq} e ${def}.`);
    }
    const melAtq = [...comGols].filter(x => x.nPlacar >= 2).sort((a, b) => b.gpp - a.gpp)[0];
    const melDef = [...comGols].filter(x => x.nPlacar >= 2).sort((a, b) => a.gcp - b.gcp)[0];
    if (melAtq && melDef && comGols.length >= 3) out.push(`<strong>Destaques de gols:</strong> o ataque rendeu mais em ${melAtq.nome} (${fmt1(melAtq.gpp)} por partida) e a defesa foi melhor em ${melDef.nome} (${fmt1(melDef.gcp)} sofridos por partida).`);
  } else {
    // Jogador: gols + assistências e presença
    const ga = meses.filter(x => x.gols + x.assist > 0).sort((a, b) => (b.gols + b.assist) - (a.gols + a.assist));
    if (ga.length) out.push(`<strong>Participação em gols:</strong> ${plural(soma(meses, x => x.gols), "gol", "gols")} e ${plural(soma(meses, x => x.assist), "assistência", "assistências")} no ano; o melhor mês foi ${ga[0].nome} (${ga[0].gols}G + ${ga[0].assist}A).`);
    const totJ = soma(meses, x => x.partidas), jog = soma(meses, x => x.jogou);
    if (totJ) out.push(`<strong>Presença:</strong> esteve em ${jog} das ${totJ} partidas do ano (${pct(jog / totJ * 100)}).`);
    // com x sem ele em campo
    const jogou = (j) => idsDaPartida(j).has(atleta.id);
    const resu = (lista) => {
      const us = porConfronto ? jogosPorConfronto(lista) : lista;
      let v = 0, e = 0, n = 0;
      us.forEach(u => { const r = resultadoJogo(u); if (!r) return; n++; if (r === "vitoria") v++; else if (r === "empate") e++; });
      return { n, ap: n ? (v * 3 + e) / (n * 3) * 100 : null };
    };
    const com = resu(doAnoJogos.filter(jogou)), sem = resu(doAnoJogos.filter(j => !jogou(j)));
    if (com.n >= 3 && sem.n >= 3) out.push(`<strong>Com e sem ele:</strong> o time teve ${pct(com.ap)} de aproveitamento com ${escapeHtml(atleta.nome)} em campo (${plural(com.n, un, uns)}) e ${pct(sem.ap)} sem ele (${plural(sem.n, un, uns)}). É só uma comparação — não prova que o resultado depende dele.`);
  }

  // Nota x resultado
  if (!atleta){
    const r = pearson(meses.filter(x => num(x.nota) && x.aprov !== null).map(x => [x.nota, x.aprov]));
    if (r !== null && r >= 0.5) out.push(`<strong>Notas e resultados andam juntos:</strong> nos meses em que a nota média subiu, o aproveitamento também tendeu a subir.`);
    else if (r !== null && r <= -0.5) out.push(`<strong>Curioso:</strong> os meses de nota média mais alta foram, em geral, os de aproveitamento mais baixo — vale olhar se as notas estão exigentes ou se o time joga bem mas não converte.`);
  }

  (ctx.extras || []).forEach(t => t && out.push(t));

  // Volume e amostra pequena
  const semJogo = meses.filter((x, i) => x.partidas === 0 && i < ctx.ultimoMes);
  if (semJogo.length) out.push(`<strong>Sem partidas:</strong> ${lista(semJogo.map(x => x.nome))}.`);
  const poucos = comRes.filter(x => x.nUn < 3);
  if (poucos.length && comRes.length > poucos.length) out.push(`<strong>Cuidado com a amostra:</strong> ${lista(poucos.map(x => x.nome))} ${poucos.length === 1 ? "teve" : "tiveram"} menos de 3 ${uns}; os pontos desses meses (círculo vazado nos gráficos) variam muito com um único resultado.`);
  if (!out.length) out.push(`Ainda há poucos dados em ${ano} para uma leitura: com mais meses de jogos, a análise aparece aqui.`);
  return out;
}

// ----------------------------------------------------------------------------
// Tela
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// Quem produz os gols: gols + assistências de cada jogador, mês a mês
// ----------------------------------------------------------------------------
function producaoDeGols(doAnoJogos, jogadores, meses, ultimoMes){
  const porMes = [];
  for (let m = 1; m <= ultimoMes; m++){
    const mm = String(m).padStart(2, "0");
    porMes.push(golsEAssistenciasPorAtleta(doAnoJogos.filter(j => (j.data || "").slice(5, 7) === mm)));
  }
  const linhas = jogadores.map(a => {
    const cel = porMes.map(mp => ({ g: mp[a.id]?.gols || 0, a: mp[a.id]?.assistencias || 0 }));
    return { atleta: a, cel, g: soma(cel, c => c.g), a: soma(cel, c => c.a) };
  }).filter(l => l.g + l.a > 0).sort((x, y) => (y.g + y.a) - (x.g + x.a) || y.g - x.g || (x.atleta.nome || "").localeCompare(y.atleta.nome || "", "pt-BR"));

  // quem esquentou / esfriou: G+A por partida do time nos últimos meses x nos anteriores
  const comJogo = meses.slice(0, ultimoMes).map((x, i) => ({ i, partidas: x.partidas })).filter(x => x.partidas > 0);
  let quentes = [], frios = [], janela = null;
  if (comJogo.length >= 4){
    const k = Math.min(3, Math.floor(comJogo.length / 2));
    const rec = comJogo.slice(-k).map(x => x.i), ant = comJogo.slice(0, -k).map(x => x.i);
    const pRec = soma(rec, i => meses[i].partidas), pAnt = soma(ant, i => meses[i].partidas);
    janela = k === 1 ? meses[rec[0]].nome : `${meses[rec[0]].curto}–${meses[rec[k - 1]].curto}`;
    linhas.forEach(l => {
      const gaRec = soma(rec, i => l.cel[i].g + l.cel[i].a), gaAnt = soma(ant, i => l.cel[i].g + l.cel[i].a);
      const rr = gaRec / pRec, ra = gaAnt / pAnt;
      const item = { atleta: l.atleta, gaRec, gaAnt, rr, ra };
      if (gaRec >= 2 && rr - ra >= 0.3) quentes.push(item);
      else if (gaAnt >= 3 && ra - rr >= 0.3) frios.push(item);
    });
    quentes.sort((x, y) => (y.rr - y.ra) - (x.rr - x.ra)); frios.sort((x, y) => (y.ra - y.rr) - (x.ra - x.rr));
    quentes = quentes.slice(0, 3); frios = frios.slice(0, 3);
  }
  return { linhas: linhas.slice(0, 10), totalComGols: linhas.length, quentes, frios, janela };
}

function tabelaProducao(prod, meses, ultimoMes){
  if (!prod.linhas.length) return `<p style="color:var(--ink-faint); font-size:13px; margin:8px 0 0;">Ainda não há gols com autor lançado neste ano.</p>`;
  const max = Math.max(1, ...prod.linhas.flatMap(l => l.cel.map(c => c.g + c.a)));
  const vis = meses.slice(0, ultimoMes);
  const cabeca = `<tr><th>Jogador</th>${vis.map(x => `<th class="evo-c">${x.curto}</th>`).join("")}<th class="evo-c">Ano</th></tr>`;
  const corpo = prod.linhas.map(l => `<tr><td class="evo-nome">${escapeHtml(l.atleta.nome)}</td>${l.cel.map((c, i) => {
    if (!vis[i].partidas) return `<td class="evo-c"></td>`;
    const v = c.g + c.a;
    if (!v) return `<td class="evo-c" style="color:var(--ink-faint);">–</td>`;
    const alfa = 0.18 + 0.62 * v / max;
    const tip = `${vis[i].nome}: ${plural(c.g, "gol", "gols")} e ${plural(c.a, "assistência", "assistências")}`;
    return `<td class="evo-c evo-calor" title="${escapeHtml(tip)}" style="background:rgba(228,182,43,${alfa.toFixed(2)}); color:${alfa > 0.5 ? "#171717" : "var(--ink)"};">${v}</td>`;
  }).join("")}<td class="evo-c" style="white-space:nowrap;"><strong>${l.g + l.a}</strong> <span style="color:var(--ink-faint); font-size:11px;">${l.g}G ${l.a}A</span></td></tr>`).join("");
  const nomes = (arr) => arr.map(x => escapeHtml(x.atleta.nome)).join(", ");
  const tags = (prod.quentes.length || prod.frios.length) ? `<div class="evo-rodape">${prod.quentes.length ? `<strong>Em alta em ${prod.janela}:</strong> ${nomes(prod.quentes)}. ` : ""}${prod.frios.length ? `<strong>Em baixa:</strong> ${nomes(prod.frios)}.` : ""}</div>` : "";
  return `<div class="table-wrap" style="margin-top:6px;"><table class="evo-tabela"><thead>${cabeca}</thead><tbody>${corpo}</tbody></table></div>
    <div class="evo-rodape">Cada célula é gols + assistências no mês; mais escuro = mais participação. “–” = jogou o time naquele mês e o jogador não participou de gol.${prod.totalComGols > prod.linhas.length ? ` Mostrando os ${prod.linhas.length} maiores de ${prod.totalComGols}.` : ""}</div>${tags}`;
}

// ----------------------------------------------------------------------------
// Resultado por faixa de nota: o time rende mais quando a nota do jogo é alta?
// ----------------------------------------------------------------------------
function notaDaUnidade(u){
  const js = u.jogosOriginais || [u];
  let soma_ = 0, qtd = 0;
  js.forEach(j => { const r = mediaNotaJogadoresNoJogo(j); if (r.qtd){ soma_ += r.media * r.qtd; qtd += r.qtd; } });
  return qtd ? soma_ / qtd : null;
}

function faixasDeNota(doAnoJogos, porConfronto){
  const us = (porConfronto ? jogosPorConfronto(doAnoJogos) : doAnoJogos)
    .map(u => ({ nota: notaDaUnidade(u), r: resultadoJogo(u), nos: u.placarNos, eles: u.placarAdversario }))
    .filter(x => num(x.nota) && x.r);
  if (us.length < 6) return { poucos: true, n: us.length };
  us.sort((a, b) => a.nota - b.nota);
  const n = us.length, c1 = Math.round(n / 3), c2 = Math.round(2 * n / 3);
  const nomes = ["Notas mais baixas", "Notas medianas", "Notas mais altas"];
  const faixas = [us.slice(0, c1), us.slice(c1, c2), us.slice(c2)].map((g, i) => {
    const v = g.filter(x => x.r === "vitoria").length, e = g.filter(x => x.r === "empate").length, d = g.filter(x => x.r === "derrota").length;
    return { nome: nomes[i], n: g.length, v, e, d, aprov: (v * 3 + e) / (g.length * 3) * 100,
      min: g[0].nota, max: g[g.length - 1].nota, gpp: soma(g, x => x.nos || 0) / g.length, gcp: soma(g, x => x.eles || 0) / g.length };
  });
  return { poucos: false, n, faixas };
}

function blocoFaixas(f, un, uns){
  if (f.poucos) return `<p style="color:var(--ink-faint); font-size:13px; margin:8px 0 0;">Poucos ${uns} com nota neste ano (${f.n}). Com pelo menos 6 ${uns} avaliados dá para comparar as faixas.</p>`;
  const linhas = f.faixas.map(x => `
    <div class="evo-faixa">
      <div class="evo-faixa-topo"><strong>${x.nome}</strong><span>nota ${fmt1(x.min)} a ${fmt1(x.max)} · ${plural(x.n, un, uns)}</span></div>
      <div class="evo-barra-linha"><div class="evo-barra"><span style="width:${Math.max(2, Math.round(x.aprov))}%"></span></div><b>${Math.round(x.aprov)}%</b></div>
      <div class="evo-faixa-sub">${x.v}V · ${x.e}E · ${x.d}D · ${fmt1(x.gpp)} gols marcados e ${fmt1(x.gcp)} sofridos por jogo</div>
    </div>`).join("");
  return linhas;
}

function leituraFaixas(f){
  if (f.poucos) return null;
  const alta = f.faixas[2], baixa = f.faixas[0], dif = alta.aprov - baixa.aprov;
  if (dif >= 15) return `<strong>Nota e resultado:</strong> o time rendeu ${pct(alta.aprov)} nos jogos de nota mais alta e ${pct(baixa.aprov)} nos de nota mais baixa — as notas acompanham os resultados. Lembre que a nota é dada depois do jogo e pode refletir o placar.`;
  if (dif <= -15) return `<strong>Nota e resultado:</strong> curiosamente o aproveitamento foi maior nos jogos de nota mais baixa (${pct(baixa.aprov)}) do que nos de nota mais alta (${pct(alta.aprov)}). Vale olhar se as notas estão sendo dadas com critério parecido em todos os jogos.`;
  return `<strong>Nota e resultado:</strong> pouca diferença entre as faixas (${pct(baixa.aprov)} nas notas mais baixas e ${pct(alta.aprov)} nas mais altas) — neste ano, a nota do jogo não previu bem o resultado.`;
}

// ----------------------------------------------------------------------------
// Melhores duplas por posição (pela posição JOGADA, não a de cadastro)
// ----------------------------------------------------------------------------
const MIN_JOGOS_POSICAO = 2;
const TITULO_POSICAO = { Zagueiro: "Zaga", Lateral: "Laterais", Volante: "Volantes", Meia: "Meio-campo", Atacante: "Ataque", Fixo: "Fixo", Ala: "Alas", "Pivô": "Pivôs" };

// posição -> atletaId -> { notas, jogos:Set }.
// Posições da partida = a da escalação inicial E a da final (se o jogador mudou de posição no
// meio do jogo, a nota da partida vale para as duas, já que não dá para separar onde foi melhor).
// Sem posição em nenhuma escalação, usa a de cadastro; partidas antigas são levadas ao vocabulário da modalidade.
function notasPorPosicaoJogada(jogadores, doAnoJogos){
  const porId = new Map(jogadores.map(a => [a.id, a]));
  const mapa = {};
  doAnoJogos.forEach(j => {
    const ini = new Map(normalizeEscalacao(j.escalacaoInicial).map(e => [e.atletaId, e.posicao]));
    const fin = new Map(normalizeEscalacao(j.escalacaoFinal).map(e => [e.atletaId, e.posicao]));
    Object.keys(j.avaliacoesJogadores || {}).forEach(id => {
      const a = porId.get(id); if (!a) return;
      const notas = notasDoAtletaNoJogo(j, id); if (!notas.length) return;
      let posicoes = [ini.get(id), fin.get(id)].filter(Boolean);
      if (!posicoes.length && a.posicao) posicoes = [a.posicao];
      posicoes = [...new Set(posicoes.map(p => posicaoNaModalidade(p)).filter(Boolean))];
      posicoes.forEach(pos => {
        const x = ((mapa[pos] = mapa[pos] || {})[id] = mapa[pos][id] || { notas: [], jogos: new Set() });
        x.notas.push(...notas); x.jogos.add(j.id);
      });
    });
  });
  return mapa;
}

function melhoresDuplas(jogadores, doAnoJogos){
  const nomes = new Map(jogadores.map(a => [a.id, a.nome]));
  const mapa = notasPorPosicaoJogada(jogadores, doAnoJogos);
  const posicoes = posicoesDaModalidade().filter(p => p !== "Goleiro").sort((a, b) => ordemPosicao(a) - ordemPosicao(b));
  const blocos = posicoes.map(pos => {
    const todos = Object.entries(mapa[pos] || {}).map(([id, x]) => ({ id, nome: nomes.get(id), media: soma(x.notas, n => n) / x.notas.length, jogos: x.jogos }));
    // só entra quem atuou ao menos 2 jogos avaliados na posição (1 jogo com nota alta não vale)
    const el = todos.filter(t => t.jogos.size >= MIN_JOGOS_POSICAO);
    const duplas = [];
    for (let i = 0; i < el.length; i++) for (let k = i + 1; k < el.length; k++){
      const a = el[i], b = el[k];
      duplas.push({ a, b, nota: (a.media + b.media) / 2, juntos: [...a.jogos].filter(x => b.jogos.has(x)).length });
    }
    duplas.sort((x, y) => y.nota - x.nota || y.juntos - x.juntos || (y.a.jogos.size + y.b.jogos.size) - (x.a.jogos.size + x.b.jogos.size));
    return { pos, titulo: TITULO_POSICAO[pos] || pos, candidatos: el.length, duplas: duplas.slice(0, 3) };
  });
  // quantas duplas cada jogador integra (em todo o quadro) e onde
  const contagem = {};
  blocos.forEach(b => b.duplas.forEach(d => [d.a, d.b].forEach(j => {
    const c = contagem[j.id] = contagem[j.id] || { nome: j.nome, total: 0, porPos: {} };
    c.total++; c.porPos[b.titulo] = (c.porPos[b.titulo] || 0) + 1;
  })));
  const repetidos = Object.values(contagem).filter(c => c.total > 1).sort((x, y) => y.total - x.total || x.nome.localeCompare(y.nome, "pt-BR"));
  return { blocos, contagem, repetidos };
}

function htmlDuplas(d){
  if (!d.blocos.some(b => b.duplas.length)) return `<p style="color:var(--ink-faint); font-size:13px; margin:8px 0 0;">Ainda não há notas suficientes por posição neste ano: cada dupla precisa de dois jogadores com pelo menos 2 jogos avaliados na mesma posição.</p>`;
  const chip = (j) => {
    const n = d.contagem[j.id]?.total || 1;
    return `<span class="evo-chip${n > 1 ? " evo-chip-rep" : ""}" ${n > 1 ? `title="${escapeHtml(j.nome)} aparece em ${n} duplas"` : ""}>${escapeHtml(j.nome)}${n > 1 ? `<sup>×${n}</sup>` : ""}</span>`;
  };
  const blocos = d.blocos.map(b => `
    <div class="evo-pos-bloco">
      <div class="evo-pos-titulo">${escapeHtml(b.titulo)}</div>
      ${b.duplas.length ? b.duplas.map((x, i) => `
        <div class="evo-dupla${i === 0 ? " evo-dupla-top" : ""}">
          <span class="evo-dupla-rank">${i + 1}º</span>
          <div class="evo-dupla-corpo">
            <div class="evo-dupla-nomes">${chip(x.a)} <span class="evo-mais">+</span> ${chip(x.b)}</div>
            <div class="evo-dupla-sub">${escapeHtml(x.a.nome)} ${fmt1(x.a.media)} (${x.a.jogos.size}j) · ${escapeHtml(x.b.nome)} ${fmt1(x.b.media)} (${x.b.jogos.size}j) · ${x.juntos ? `juntos em ${plural(x.juntos, "jogo", "jogos")}` : "ainda não jogaram juntos"}</div>
          </div>
          <div class="evo-dupla-nota">${fmt1(x.nota)}</div>
        </div>`).join("") : `<p class="evo-vazio">Ainda não há 2 jogadores com ${MIN_JOGOS_POSICAO}+ jogos avaliados nessa posição.</p>`}
    </div>`).join("");
  const rep = d.repetidos.length
    ? `<div class="evo-rep"><strong>Em mais de uma dupla:</strong> ${d.repetidos.map(r => `<span class="evo-chip evo-chip-rep">${escapeHtml(r.nome)}<sup>×${r.total}</sup></span> <span class="evo-rep-det">${Object.entries(r.porPos).map(([t, n]) => n > 1 ? `${t} (${n})` : t).join(", ")}</span>`).join(" · ")}</div>` : "";
  return `${rep}<div class="evo-duplas">${blocos}</div>`;
}

export function renderEvolucao(root, state){
  wireQuadroChips(root, () => renderEvolucao(root, state));
  const realizados = jogosRealizados(filtrarPorQuadro(state.jogos));
  const anos = anosDisponiveis(realizados);
  if (!filtroAno || !anos.includes(filtroAno)) filtroAno = anos[0] || "";
  const jogadores = state.atletas.filter(ehJogador).sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR"));
  const atleta = jogadores.find(a => a.id === filtroAtleta) || null;
  if (!atleta) filtroAtleta = "";

  const topo = `
    <div class="topbar"><div><div class="eyebrow">Relatórios</div><h1>Evolução do ano</h1></div>
      <a href="#relatorios" class="btn btn-ghost btn-sm">&larr; Relatórios</a></div>
    ${quadroChipsHtml(state.jogos)}
    <div class="form-grid" style="max-width:480px; margin-bottom:20px;">
      <div class="field"><label>Ano</label>
        <select id="ev-ano">${anos.map(a => `<option value="${a}" ${a === filtroAno ? "selected" : ""}>${a}</option>`).join("")}</select></div>
      <div class="field"><label>Jogador</label>
        <select id="ev-atleta"><option value="">Time todo</option>${jogadores.map(a => `<option value="${a.id}" ${atleta && a.id === atleta.id ? "selected" : ""}>${escapeHtml(a.nome)}${a.ativo === false ? " (inativo)" : ""}</option>`).join("")}</select></div>
    </div>`;

  const ligar = () => {
    $("#ev-ano", root)?.addEventListener("change", (e) => { filtroAno = e.target.value; renderEvolucao(root, state); });
    $("#ev-atleta", root)?.addEventListener("change", (e) => { filtroAtleta = e.target.value; renderEvolucao(root, state); });
  };

  if (!anos.length){
    root.innerHTML = topo + `<div class="empty-state"><h3>Ainda sem partidas realizadas</h3><p>Assim que os jogos forem realizados, a evolução mês a mês aparece aqui.</p></div>`;
    ligar(); return;
  }

  const doAnoJogos = realizados.filter(j => (j.data || "").startsWith(filtroAno));
  const porConfronto = contarPorConfronto(realizados);
  const meses = calcularMeses(doAnoJogos, atleta, porConfronto);
  const ultimoMes = Math.max(1, ...meses.filter(x => x.partidas > 0).map(x => x.m));
  const vis = meses.slice(0, ultimoMes);
  const labels = vis.map(x => x.curto);
  const un = porConfronto ? "confronto" : "jogo", uns = porConfronto ? "confrontos" : "jogos";
  const subs = vis.map(x => atleta ? (x.jogou ? `${x.jogou}j` : "") : (x.nUn ? `${x.nUn} ${x.nUn === 1 ? un : uns}`.replace("confrontos", "conf.").replace("confronto", "conf.") : ""));
  const pouco = vis.map(x => x.nUn > 0 && x.nUn < 2);

  // totais do ano (para KPIs e linhas de referência)
  const tV = soma(meses, x => x.v), tE = soma(meses, x => x.e), tN = soma(meses, x => x.nUn);
  const aprovAno = tN ? (tV * 3 + tE) / (tN * 3) * 100 : null;
  const notaAno = atleta ? (statsPorAtleta([atleta], doAnoJogos)[0].media ?? null) : (mediaGeralJogadores(doAnoJogos) ?? null);
  const tPlacar = soma(meses, x => x.nPlacar), gppAno = tPlacar ? soma(meses, x => x.golsPro) / tPlacar : null;

  const kpis = atleta
    ? [["Jogos disputados", `${soma(meses, x => x.jogou)}`], ["Gols", `${soma(meses, x => x.gols)}`], ["Assistências", `${soma(meses, x => x.assist)}`],
       ["Nota média", fmt1(notaAno)], ["Aproveitamento do time", aprovAno === null ? "—" : `${Math.round(aprovAno)}<span class="unit">%</span>`]]
    : [[porConfronto ? "Partidas / confrontos" : "Jogos realizados", porConfronto ? `${soma(meses, x => x.partidas)}<span class="unit">/ ${tN}</span>` : `${soma(meses, x => x.partidas)}`],
       ["Aproveitamento", aprovAno === null ? "—" : `${Math.round(aprovAno)}<span class="unit">%</span>`], ["Nota média", fmt1(notaAno)], ["Gols por partida", fmt1(gppAno)]];

  // ---- gráficos ----
  const verde = "var(--vit)", ouro = "var(--gold)", verm = "var(--danger)", cinza = "var(--ink-faint)";
  const cardGrafico = (titulo, sub, svg, leg) => `<div class="card card-pad evo-card"><div class="card-title">${titulo}</div><div class="card-sub">${sub}</div>${svg}${leg || ""}</div>`;

  const gAprov = graficoLinhas({
    labels, subs, yMin: 0, yMax: 100, passo: 25, fmtY: v => `${v}%`,
    ref: aprovAno === null ? null : { valor: aprovAno, texto: `média do ano ${Math.round(aprovAno)}%` },
    series: [{ cor: ouro, valores: vis.map(x => x.aprov), fmt: v => `${Math.round(v)}%`, pouco,
      titulos: vis.map(x => `${x.nome}: ${x.aprov === null ? "sem jogos" : `${Math.round(x.aprov)}% (${x.v}V ${x.e}E ${x.d}D)`}`) }],
  });

  const notas = vis.map(x => x.nota).filter(num);
  let nMin = notas.length ? Math.floor(Math.min(...notas, notaAno ?? 99) - 0.5) : 0, nMax = notas.length ? Math.ceil(Math.max(...notas, notaAno ?? 0) + 0.5) : 10;
  nMin = Math.max(0, nMin); nMax = Math.min(10, Math.max(nMax, nMin + 2));
  const gNota = graficoLinhas({
    labels, subs: vis.map(x => atleta ? (x.jogou ? `${x.jogou}j` : "") : ""), yMin: nMin, yMax: nMax, passo: nMax - nMin > 5 ? 2 : 1, fmtY: v => String(v),
    ref: notaAno === null ? null : { valor: notaAno, texto: `média do ano ${fmt1(notaAno)}` },
    series: [{ cor: ouro, valores: vis.map(x => x.nota), fmt: v => fmt1(v), pouco: vis.map(() => false),
      titulos: vis.map(x => `${x.nome}: ${num(x.nota) ? "nota " + fmt1(x.nota) : "sem notas lançadas"}`) }],
  });

  let g3, g4, t3, s3, leg3, t4, s4, leg4;
  if (!atleta){
    const maxG = Math.max(1, ...vis.map(x => Math.max(x.gpp || 0, x.gcp || 0)));
    const topoG = Math.ceil(maxG + 0.5), passoG = topoG > 6 ? 2 : 1;
    t3 = "Gols por partida: marcados × sofridos"; s3 = "Ataque e defesa mês a mês.";
    g3 = graficoLinhas({
      labels, subs, yMin: 0, yMax: Math.ceil(topoG / passoG) * passoG, passo: passoG, fmtY: v => String(v),
      series: [
        { cor: verde, valores: vis.map(x => x.gpp), fmt: v => fmt1(v), rotulo: "cima", pouco: vis.map(x => x.nPlacar > 0 && x.nPlacar < 2), titulos: vis.map(x => `${x.nome}: ${x.gpp === null ? "sem placar" : `${fmt1(x.gpp)} gols marcados por partida (${x.golsPro} em ${x.nPlacar})`}`) },
        { cor: verm, valores: vis.map(x => x.gcp), fmt: v => fmt1(v), rotulo: "baixo", pouco: vis.map(x => x.nPlacar > 0 && x.nPlacar < 2), titulos: vis.map(x => `${x.nome}: ${x.gcp === null ? "sem placar" : `${fmt1(x.gcp)} gols sofridos por partida (${x.golsContra} em ${x.nPlacar})`}`) },
      ],
    });
    leg3 = legenda([[verde, "Marcados"], [verm, "Sofridos"]]);
    t4 = `Resultados por mês`; s4 = porConfronto ? "Vitórias, empates e derrotas por confronto." : "Vitórias, empates e derrotas em cada mês.";
    g4 = graficoBarras({ labels, subs: vis.map(() => ""), empilhado: true, passo: Math.max(...vis.map(x => x.nUn)) > 8 ? 2 : 1,
      series: [{ nome: "Vitórias", cor: verde, valores: vis.map(x => x.v) }, { nome: "Empates", cor: cinza, valores: vis.map(x => x.e) }, { nome: "Derrotas", cor: verm, valores: vis.map(x => x.d) }] });
    leg4 = legenda([[verde, "Vitórias"], [cinza, "Empates"], [verm, "Derrotas"]]);
  } else {
    t3 = "Gols e assistências"; s3 = `${escapeHtml(atleta.nome)}, mês a mês.`;
    g3 = graficoBarras({ labels, subs: vis.map(() => ""), empilhado: false, passo: Math.max(...vis.map(x => Math.max(x.gols, x.assist))) > 8 ? 2 : 1,
      series: [{ nome: "Gols", cor: ouro, valores: vis.map(x => x.gols) }, { nome: "Assistências", cor: verde, valores: vis.map(x => x.assist) }] });
    leg3 = legenda([[ouro, "Gols"], [verde, "Assistências"]]);
    t4 = "Presença"; s4 = "Partidas do time em cada mês e em quantas ele esteve.";
    g4 = graficoBarras({ labels, subs: vis.map(() => ""), empilhado: false, passo: Math.max(...vis.map(x => x.partidas)) > 8 ? 2 : 1,
      series: [{ nome: "Partidas do time", cor: cinza, valores: vis.map(x => x.partidas) }, { nome: "Jogou", cor: ouro, valores: vis.map(x => x.jogou) }] });
    leg4 = legenda([[cinza, "Partidas do time"], [ouro, "Jogou"]]);
  }

  // blocos extras (só no modo "Time todo")
  let blocosExtras = "", extras = [];
  if (!atleta){
    const prod = producaoDeGols(doAnoJogos, jogadores, meses, ultimoMes);
    const faixas = faixasDeNota(doAnoJogos, porConfronto);
    const duplas = melhoresDuplas(jogadores, doAnoJogos);
    if (duplas.repetidos.length) extras.push(`<strong>Duplas:</strong> ${duplas.repetidos.slice(0, 3).map(r => `${escapeHtml(r.nome)} aparece em ${r.total} das melhores duplas (${Object.entries(r.porPos).map(([t, n]) => n > 1 ? `${t} ×${n}` : t).join(", ")})`).join("; ")}.`);
    const fraseFaixas = leituraFaixas(faixas);
    if (fraseFaixas) extras.push(fraseFaixas);
    if (prod.quentes.length) extras.push(`<strong>Esquentando:</strong> ${prod.quentes.map(x => `${escapeHtml(x.atleta.nome)} (${fmt1(x.rr)} gols + assistências por partida em ${prod.janela}, contra ${fmt1(x.ra)} antes)`).join("; ")}.`);
    if (prod.frios.length) extras.push(`<strong>Esfriando:</strong> ${prod.frios.map(x => `${escapeHtml(x.atleta.nome)} (${fmt1(x.rr)} por partida em ${prod.janela}, contra ${fmt1(x.ra)} antes)`).join("; ")}.`);
    blocosExtras = `
      <div class="card card-pad" style="margin-bottom:16px;">
        <div class="card-title">Quem produz os gols</div>
        <div class="card-sub">Gols + assistências dos jogadores que mais participaram de gols em ${filtroAno}, mês a mês.</div>
        ${tabelaProducao(prod, meses, ultimoMes)}
      </div>
      <div class="card card-pad" style="margin-bottom:16px;">
        <div class="card-title">Melhores duplas por posição</div>
        <div class="card-sub">Pela nota média de cada jogador <strong>na posição em que jogou</strong> (a da escalação, não a do cadastro) em ${filtroAno}. Só entra quem atuou em <strong>pelo menos 2 jogos avaliados</strong> na posição. Se o jogador mudou de posição na partida (uma na escalação inicial e outra na final), a nota daquela partida vale para as duas posições. A nota da dupla é a média das duas; mostramos as 3 melhores de cada posição, e quem aparece em mais de uma dupla fica em dourado, com o número de duplas.</div>
        ${htmlDuplas(duplas)}
        <div class="evo-rodape">“j” = jogos avaliados na posição. A dupla é a combinação das melhores notas; “juntos” mostra em quantos jogos os dois atuaram na posição ao mesmo tempo. Goleiro fica de fora (é um só em campo).</div>
      </div>
      <div class="card card-pad" style="margin-bottom:16px;">
        <div class="card-title">Resultado por faixa de nota</div>
        <div class="card-sub">Os ${uns} do ano com nota lançada, divididos em três grupos pela nota média do jogo (mais baixas, medianas e mais altas), com o aproveitamento de cada grupo.</div>
        ${blocoFaixas(faixas, un, uns)}
        ${faixas.poucos ? "" : `<div class="evo-rodape">Os grupos são relativos ao próprio ano (um terço dos jogos em cada). A nota é dada depois da partida, então pode refletir o resultado em vez de causá-lo.</div>`}
      </div>`;
  }
  const analise = leitura(meses, { atleta, porConfronto, ano: filtroAno, doAnoJogos, ultimoMes, extras });
  const algumPouco = pouco.some(Boolean);

  root.innerHTML = topo + `
    <div class="kpi-grid">${kpis.map(([l, v]) => `<div class="kpi-tile"><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div></div>`).join("")}</div>
    <div class="evo-grid">
      ${cardGrafico(atleta ? "Aproveitamento do time com ele em campo" : "Aproveitamento mês a mês", `Pontos conquistados ÷ pontos disputados (vitória 3, empate 1) em ${filtroAno}.`, gAprov, `<div class="evo-rodape">Linha tracejada = média do ano (${aprovAno === null ? "—" : Math.round(aprovAno) + "%"}).${algumPouco ? ` Círculo vazado = mês com apenas 1 ${un}.` : ""}</div>`)}
      ${cardGrafico(atleta ? "Nota média do jogador" : "Nota média dos jogadores", atleta ? "Média das notas que ele recebeu em cada mês." : "Média de todas as notas dadas aos jogadores em cada mês.", gNota, `<div class="evo-rodape">Linha tracejada = média do ano (${fmt1(notaAno)}).</div>`)}
      ${cardGrafico(t3, s3, g3, leg3)}
      ${cardGrafico(t4, s4, g4, leg4)}
    </div>
    ${blocosExtras}
    <div class="card card-pad" style="margin-top:4px;">
      <div class="card-title">O que os gráficos mostram</div>
      <div class="card-sub">Leitura automática de ${filtroAno}${atleta ? ` para ${escapeHtml(atleta.nome)}` : ""}. Meses com poucos jogos oscilam bastante: use como pista, não como sentença.</div>
      <ul class="evo-leitura">${analise.map(t => `<li>${t}</li>`).join("")}</ul>
    </div>`;
  ligar();
}
