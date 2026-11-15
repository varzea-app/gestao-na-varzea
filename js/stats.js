import { avg } from "./utils.js";

// "Técnico" é uma categoria especial do campo Posição — usada pra cadastrar
// comissão técnica (que pode ter direito a voto na Avaliação) sem que eles
// apareçam nas listagens de jogadores (escalação, ranking, escalação ideal).
export const POSICAO_TECNICO = "Técnico";
export function ehJogador(atleta){
  return !!atleta && atleta.posicao !== POSICAO_TECNICO;
}

// Jogos "realizados" são os que entram nas estatísticas (jogos agendados/futuros não contam).
export function jogosRealizados(jogos){
  return jogos.filter(j => j.status === "realizado");
}

// ----------------------------------------------------------------------------
// Gols e assistências
// ----------------------------------------------------------------------------

// Valor especial usado no lugar de um atletaId em golsAssistencias quando o
// gol foi contra (o adversário marcou contra o próprio time) — conta pro
// placar/total de gols do time, mas não é creditado a nenhum atleta.
export const GOL_CONTRA_ID = "GOL_CONTRA";

// Opções de "como foi o gol" e "qual tempo", usadas no formulário de eventos.
export const TIPOS_GOL = ["Finalização", "Cabeceio", "Falta", "Pênalti"];
export const TEMPOS_JOGO = ["1º tempo", "2º tempo"];

export function golsEAssistenciasPorAtleta(jogos){
  const map = {}; // atletaId -> { gols, assistencias }
  const bump = (id, key) => {
    if (!id) return;
    if (!map[id]) map[id] = { gols: 0, assistencias: 0 };
    map[id][key]++;
  };
  jogosRealizados(jogos).forEach(j => {
    (j.golsAssistencias || []).forEach(evt => {
      if (evt.atletaGolId && evt.atletaGolId !== GOL_CONTRA_ID) bump(evt.atletaGolId, "gols");
      if (evt.atletaAssistId) bump(evt.atletaAssistId, "assistencias");
    });
  });
  return map;
}

export function totalGols(jogos){
  return jogosRealizados(jogos).reduce((sum, j) => sum + (j.golsAssistencias?.length || 0), 0);
}

export function totalAssistencias(jogos){
  return jogosRealizados(jogos).reduce((sum, j) =>
    sum + (j.golsAssistencias || []).filter(e => !!e.atletaAssistId).length, 0);
}

export function rankingGolsAssistencias(atletas, jogos){
  const map = golsEAssistenciasPorAtleta(jogos);
  return atletas
    .map(a => ({
      atleta: a,
      gols: map[a.id]?.gols || 0,
      assistencias: map[a.id]?.assistencias || 0,
    }))
    .filter(r => r.gols > 0 || r.assistencias > 0)
    .sort((a, b) => (b.gols + b.assistencias) - (a.gols + a.assistencias) || b.gols - a.gols);
}

// Ids de todos os atletas "da partida": relacionados (futsal, dois quadros),
// escalação inicial e escalação final, sem duplicar. Todo relacionado conta
// como 1 jogo disputado, mesmo sem nota.
export function idsDaPartida(jogo){
  return new Set([
    ...(jogo?.relacionados || []),
    ...normalizeEscalacao(jogo?.escalacaoInicial).map(e => e.atletaId),
    ...normalizeEscalacao(jogo?.escalacaoFinal).map(e => e.atletaId),
  ]);
}

// Atletas que estiveram na partida (relacionados, inicial ou final).
export function jogadoresDaPartida(jogo, atletas){
  const ids = idsDaPartida(jogo);
  return atletas.filter(a => ids.has(a.id) && ehJogador(a));
}

// Quantidade de partidas realizadas em que o atleta esteve na partida
// (relacionado, inicial ou final), independente de ter marcado gol/assistência.
export function contagemJogosPorAtleta(jogos){
  const map = {};
  jogosRealizados(jogos).forEach(j => {
    idsDaPartida(j).forEach(id => { map[id] = (map[id] || 0) + 1; });
  });
  return map;
}

// ----------------------------------------------------------------------------
// Futsal: dois quadros no mesmo dia
// ----------------------------------------------------------------------------

// jogo.quadro: "1" | "2" | "" (sem quadro). O time tem sempre o mesmo nome;
// só a identificação muda ("1º quadro" / "2º quadro").
export function rotuloQuadro(jogo){
  return jogo?.quadro === "1" ? "1º quadro" : jogo?.quadro === "2" ? "2º quadro" : "";
}

// Ordem cronológica de jogos: data, depois horário (sem horário vai por último
// no dia) e, no empate, o 2º quadro antes do 1º (no futsal o 2º quadro joga primeiro).
export function ordemCronologica(a, b){
  return (a.data || "").localeCompare(b.data || "")
    || (a.horario || "99:99").localeCompare(b.horario || "99:99")
    || (b.quadro || "").localeCompare(a.quadro || "");
}

// Agrupa jogos em "confrontos": jogos com quadro, do mesmo dia e contra o mesmo
// adversário, viram 1 confronto (placares somados). Jogos sem quadro, ou contra
// adversários diferentes, são confrontos de 1 jogo. Cada confronto traz:
// { chave, data, adversarioId, campoId, jogos[], placarNos, placarAdversario,
//   resultado, parcial, id } — "parcial" = há jogo do grupo ainda sem placar
// (agendado); nesse caso o placar soma só o que já foi jogado.
export function agruparConfrontos(jogos){
  const grupos = new Map();
  jogos.forEach(j => {
    const chave = j.quadro ? `${j.data || ""}|${j.adversarioId || ""}` : `solo|${j.id}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(j);
  });
  return [...grupos.entries()].map(([chave, js]) => {
    js.sort((a, b) => (a.quadro || "").localeCompare(b.quadro || "") || (a.horario || "").localeCompare(b.horario || ""));
    const jogados = js.filter(j => j.status === "realizado" && typeof j.placarNos === "number" && typeof j.placarAdversario === "number");
    const nos = jogados.reduce((t, j) => t + j.placarNos, 0);
    const eles = jogados.reduce((t, j) => t + j.placarAdversario, 0);
    const base = js[0];
    return {
      chave, id: base.id, data: base.data, adversarioId: base.adversarioId, campoId: base.campoId,
      jogos: js, placarNos: jogados.length ? nos : null, placarAdversario: jogados.length ? eles : null,
      resultado: jogados.length ? (nos > eles ? "vitoria" : nos < eles ? "derrota" : "empate") : null,
      parcial: jogados.length < js.length,
    };
  });
}

// Resultados "por confronto": devolve a lista de jogos realizados trocando cada
// confronto de 2+ quadros por UM jogo com os placares somados (sem pênaltis nem
// critério, que valem por quadro). Confrontos de 1 jogo ficam como estão. É o que
// o filtro "Geral" usa para contar vitórias, empates e derrotas.
export function jogosPorConfronto(realizados){
  return agruparConfrontos(realizados).map(c => {
    if (c.jogos.length === 1) return c.jogos[0];
    return {
      ...c.jogos[0], id: c.id, quadro: "", status: "realizado",
      placarNos: c.placarNos, placarAdversario: c.placarAdversario,
      decisao: "", penaltisNos: null, penaltisAdversario: null, criterioVencedor: "", criterioMotivo: "",
      jogosOriginais: c.jogos,
    };
  });
}

// Estatísticas combinadas de cada atleta (jogos, gols, assistências, nota
// média), calculadas a partir de um conjunto de jogos já filtrado (por
// período ou por partida específica) — usado na tela de Ranking.
export function statsPorAtleta(atletas, jogos, votanteIds = null){
  const gaMap = golsEAssistenciasPorAtleta(jogos);
  const jogosMap = contagemJogosPorAtleta(jogos);
  return atletas.map(a => {
    const { media, qtd } = mediaNotaAtleta(a.id, jogos, votanteIds);
    return {
      atleta: a,
      jogosCount: jogosMap[a.id] || 0,
      gols: gaMap[a.id]?.gols || 0,
      assistencias: gaMap[a.id]?.assistencias || 0,
      media,
      qtdAvaliacoes: qtd,
    };
  });
}

// ----------------------------------------------------------------------------
// Escalação — posição jogada em cada partida
// ----------------------------------------------------------------------------

// Aceita tanto o formato novo (array de {atletaId, posicao}) quanto o antigo
// (array de ids em string, de jogos criados antes desse recurso existir).
export function normalizeEscalacao(arr){
  return (arr || [])
    .map(e => typeof e === "string" ? { atletaId: e, posicao: null } : { atletaId: e?.atletaId, posicao: e?.posicao || null })
    .filter(e => !!e.atletaId);
}

// Posição em que o atleta atuou numa partida específica: prioriza a escalação
// final (reflete o que de fato aconteceu em campo, incluindo substituições),
// caindo para a inicial se só ela tiver a posição informada.
export function posicaoJogadaNoJogo(jogo, atletaId){
  const buscar = (field) => normalizeEscalacao(jogo?.[field]).find(e => e.atletaId === atletaId)?.posicao || null;
  return buscar("escalacaoFinal") || buscar("escalacaoInicial");
}

// ----------------------------------------------------------------------------
// Avaliações — suportam múltiplos votantes por partida (diretores/capitão).
// Formato em jogo.avaliacoesJogadores: { [atletaId]: { [votanteId]: { nota, obs } } }.
// Partidas antigas (de antes desse recurso) guardam { [atletaId]: { nota, obs } }
// direto, sem identificar quem votou — esse formato "achatado" continua sendo
// lido normalmente, só sem separar por votante.
// ----------------------------------------------------------------------------

// Todas as notas atribuídas a um atleta numa partida. Por padrão conta os
// votos de todo mundo; passando `votanteIds` (array de ids), conta só os
// votos de quem está nessa lista — usado no filtro "quem votou" do Ranking.
export function notasDoAtletaNoJogo(jogo, atletaId, votanteIds = null){
  const entry = jogo?.avaliacoesJogadores?.[atletaId];
  if (!entry) return [];
  if (typeof entry.nota === "number"){
    // Formato antigo (nota única, sem votante identificado) — se um filtro
    // de votante específico foi pedido, não dá pra saber quem votou, então
    // essa nota fica de fora (evita contar um voto "sem dono" como se fosse
    // de alguém que a pessoa selecionou).
    return votanteIds && votanteIds.length > 0 ? [] : [entry.nota];
  }
  const chaves = votanteIds && votanteIds.length > 0 ? votanteIds : Object.keys(entry);
  return chaves.map(id => entry[id]?.nota).filter(n => typeof n === "number");
}

// Nota que um votante específico deu a um atleta numa partida (ou null, se ele
// ainda não votou ou se a partida só tem o formato antigo sem votante identificado).
export function notaDoVotanteNoJogo(jogo, atletaId, votanteId){
  const entry = jogo?.avaliacoesJogadores?.[atletaId];
  if (!entry || typeof entry.nota === "number") return null;
  return typeof entry[votanteId]?.nota === "number" ? entry[votanteId].nota : null;
}

// Critério das notas dos jogadores: partidas de Campeonato não entram nas médias
// (ranking, dashboard, escalação ideal, premiações, evolução). As notas dessas
// partidas continuam sendo lançadas e aparecem jogo a jogo; só não contam no
// cálculo. Partida sem tipo informado conta (não dá para saber que é campeonato).
export const TIPOS_FORA_DA_NOTA = ["campeonato"];
export function contaParaNota(jogo){
  return !TIPOS_FORA_DA_NOTA.includes(String(jogo?.tipoPartida || "").trim().toLowerCase());
}

// Nota média de todos os jogadores avaliados numa partida específica — usada
// para o ranking "melhores partidas" do Dashboard.
export function mediaNotaJogadoresNoJogo(jogo){
  const todas = [];
  Object.keys(jogo?.avaliacoesJogadores || {}).forEach(atletaId => {
    todas.push(...notasDoAtletaNoJogo(jogo, atletaId));
  });
  return { media: avg(todas), qtd: todas.length };
}

export function mediaNotaAtleta(atletaId, jogos, votanteIds = null){
  const notas = [];
  jogosRealizados(jogos).filter(contaParaNota).forEach(j => notas.push(...notasDoAtletaNoJogo(j, atletaId, votanteIds)));
  return { media: avg(notas), qtd: notas.length };
}

// Notas médias de cada atleta separadas pela posição que ele efetivamente
// jogou em cada partida (não a posição de cadastro). Um atleta que já jogou
// de Zagueiro em alguns jogos e de Lateral em outros terá uma média para
// cada posição. Se a partida não tiver posição informada (jogos antigos),
// usa a posição de cadastro do atleta como fallback só para não perder o dado.
export function notasPorPosicao(atletas, jogos, mapearPosicao = null){
  const map = {}; // atletaId -> { posicao -> notas[] }
  jogosRealizados(jogos).filter(contaParaNota).forEach(j => {
    Object.keys(j.avaliacoesJogadores || {}).forEach(atletaId => {
      const notas = notasDoAtletaNoJogo(j, atletaId);
      if (notas.length === 0) return;
      const atleta = atletas.find(a => a.id === atletaId);
      let posicao = posicaoJogadaNoJogo(j, atletaId) || atleta?.posicao || null;
      if (posicao && mapearPosicao) posicao = mapearPosicao(posicao); // ex.: partida antiga de campo, time hoje de futsal
      if (!posicao) return;
      if (!map[atletaId]) map[atletaId] = {};
      if (!map[atletaId][posicao]) map[atletaId][posicao] = [];
      map[atletaId][posicao].push(...notas);
    });
  });
  const result = {};
  Object.entries(map).forEach(([atletaId, porPosicao]) => {
    result[atletaId] = {};
    Object.entries(porPosicao).forEach(([posicao, notas]) => {
      result[atletaId][posicao] = { media: avg(notas), qtd: notas.length };
    });
  });
  return result;
}

export function mediaGeralJogadores(jogos){
  const todasNotas = [];
  jogosRealizados(jogos).filter(contaParaNota).forEach(j => {
    Object.keys(j.avaliacoesJogadores || {}).forEach(atletaId => {
      todasNotas.push(...notasDoAtletaNoJogo(j, atletaId));
    });
  });
  return avg(todasNotas);
}

export function mediaCampo(campoId, jogos){
  const notas = jogosRealizados(jogos)
    .filter(j => j.campoId === campoId)
    .map(j => j.avaliacaoCampo?.nota)
    .filter(n => typeof n === "number");
  return { media: avg(notas), qtd: notas.length };
}

export function mediaAdversario(adversarioId, jogos){
  const notas = jogosRealizados(jogos)
    .filter(j => j.adversarioId === adversarioId)
    .map(j => j.avaliacaoAdversario?.nota)
    .filter(n => typeof n === "number");
  return { media: avg(notas), qtd: notas.length };
}

export function mediaGeralCampos(jogos){
  return avg(jogosRealizados(jogos).map(j => j.avaliacaoCampo?.nota).filter(n => typeof n === "number"));
}

export function mediaGeralAdversarios(jogos){
  return avg(jogosRealizados(jogos).map(j => j.avaliacaoAdversario?.nota).filter(n => typeof n === "number"));
}

// ----------------------------------------------------------------------------
// Contagens / resultado
// ----------------------------------------------------------------------------
export function contagemJogosPorCampo(jogos){
  const map = {};
  jogosRealizados(jogos).forEach(j => { if (j.campoId) map[j.campoId] = (map[j.campoId] || 0) + 1; });
  return map;
}

export function contagemJogosPorAdversario(jogos){
  const map = {};
  jogosRealizados(jogos).forEach(j => { if (j.adversarioId) map[j.adversarioId] = (map[j.adversarioId] || 0) + 1; });
  return map;
}

// Saldo de gols do time (gols feitos - gols tomados), com base no placar de
// cada partida realizada — não na contagem de eventos de gol registrados,
// para refletir o placar oficial mesmo que algum gol não tenha sido detalhado.
export function saldoGols(jogos){
  const realizados = jogosRealizados(jogos);
  const feitos = realizados.reduce((s, j) => s + (j.placarNos ?? 0), 0);
  const sofridos = realizados.reduce((s, j) => s + (j.placarAdversario ?? 0), 0);
  return { feitos, sofridos, saldo: feitos - sofridos };
}

export function resultadoJogo(jogo){
  if (jogo.placarNos === null || jogo.placarNos === undefined || jogo.placarAdversario === null || jogo.placarAdversario === undefined){
    return null;
  }
  if (jogo.placarNos > jogo.placarAdversario) return "vitoria";
  if (jogo.placarNos < jogo.placarAdversario) return "derrota";
  return "empate";
}

// Desempate de jogo empatado no tempo normal (pênaltis ou critério de
// festival/WO). Nas estatísticas o jogo segue como empate; isso é só um selo.
// Retorna null se não houver desempate válido.
export function desempateJogo(jogo){
  if (!jogo || resultadoJogo(jogo) !== "empate") return null;
  const num = (v) => typeof v === "number" && !isNaN(v);
  if (jogo.decisao === "penaltis" && num(jogo.penaltisNos) && num(jogo.penaltisAdversario) && jogo.penaltisNos !== jogo.penaltisAdversario){
    const nos = jogo.penaltisNos > jogo.penaltisAdversario;
    return {
      tipo: "penaltis", vencedor: nos ? "nos" : "adversario",
      texto: `${nos ? "venceu" : "perdeu"} nos pênaltis (${jogo.penaltisNos}x${jogo.penaltisAdversario})`,
    };
  }
  if (jogo.decisao === "criterio" && (jogo.criterioVencedor === "nos" || jogo.criterioVencedor === "adversario")){
    const nos = jogo.criterioVencedor === "nos";
    const motivo = (jogo.criterioMotivo || "").trim();
    return {
      tipo: "criterio", vencedor: jogo.criterioVencedor,
      texto: `${nos ? "vitória" : "derrota"} por critério${motivo ? ` (${motivo})` : ""}`,
    };
  }
  return null;
}

// porConfronto = true: vitórias/empates/derrotas contam o confronto (soma dos
// quadros) como 1; qtdJogos continua sendo o total de partidas.
export function resumoGeral(jogos, porConfronto = false){
  const realizados = jogosRealizados(jogos);
  let vitorias = 0, empates = 0, derrotas = 0;
  (porConfronto ? jogosPorConfronto(realizados) : realizados).forEach(j => {
    const r = resultadoJogo(j);
    if (r === "vitoria") vitorias++;
    else if (r === "empate") empates++;
    else if (r === "derrota") derrotas++;
  });
  const confrontos = agruparConfrontos(realizados);
  return {
    qtdJogos: realizados.length,
    qtdConfrontos: confrontos.length,
    temQuadros: realizados.some(j => !!j.quadro),
    qtdGols: totalGols(jogos),
    qtdAssistencias: totalAssistencias(jogos),
    mediaJogadores: mediaGeralJogadores(jogos),
    mediaCampo: mediaGeralCampos(jogos),
    mediaAdversario: mediaGeralAdversarios(jogos),
    vitorias, empates, derrotas,
  };
}
