import { serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { gravarEmLote, apagarEmLote } from "./db.js";

// ============================================================================
// Dados de DEMONSTRAÇÃO — time, jogadores e adversários totalmente fictícios,
// para gravar vídeos e mostrar o app cheio. Datas são relativas a "hoje", então
// a demonstração sempre parece atual. Usa um sorteio com semente fixa: rodar de
// novo gera exatamente os mesmos dados.
// ============================================================================

function sorteio(semente){
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const MESES_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const meioPonto = (n) => Math.round(n * 2) / 2;

const ELENCO = [
  // [id, nome, posição, número, pagante, podeVotar]
  ["atl-01", "Carlão", "Goleiro", 1, true, false],
  ["atl-02", "Beto Luva", "Goleiro", 12, true, false],
  ["atl-03", "Marcão", "Zagueiro", 3, true, true],
  ["atl-04", "Diego Zaga", "Zagueiro", 4, true, false],
  ["atl-05", "Fabinho", "Zagueiro", 14, true, false],
  ["atl-06", "Juninho", "Lateral", 2, true, false],
  ["atl-07", "Cadu", "Lateral", 6, true, false],
  ["atl-08", "Nando", "Lateral", 16, false, false],
  ["atl-09", "Rodrigo", "Volante", 5, true, true],
  ["atl-10", "Samuel", "Volante", 8, true, false],
  ["atl-11", "Thiago Meia", "Meia", 10, true, false],
  ["atl-12", "Vitinho", "Meia", 20, true, false],
  ["atl-13", "Tuca", "Meia", 17, false, false],
  ["atl-14", "Bruno Pará", "Atacante", 9, true, false],
  ["atl-15", "Léo Gol", "Atacante", 11, true, false],
  ["atl-16", "Pedrinho", "Atacante", 7, true, false],
  ["atl-17", "Professor Tadeu", "Técnico", null, false, true],
];

const ADVERSARIOS = [
  ["adv-1", "Unidos da Vila", "São Paulo"],
  ["adv-2", "Real Madrugada", "Osasco"],
  ["adv-3", "Atlético Boleiros", "Cotia"],
  ["adv-4", "Sport Clube Pelada", "Barueri"],
  ["adv-5", "Tigres da Zona Sul", "São Paulo"],
];

const CAMPOS = [
  ["cmp-1", "Campo do Parque", "Rua das Palmeiras, 120", "Gramado sintético"],
  ["cmp-2", "Arena Bola Cheia", "Av. dos Esportes, 800", "Society"],
  ["cmp-3", "Estádio da Vila", "Rua do Campinho, 45", "Gramado natural"],
];

// Resultado de cada partida realizada, da mais antiga para a mais recente: V vitória, E empate, D derrota.
const RESULTADOS = ["V", "V", "E", "D", "V", "V", "D", "V", "E", "V"];

const PESO_GOL = { Atacante: 6, Meia: 3, Volante: 1.2, Lateral: 1, Zagueiro: 0.8 };

function escolhaPonderada(lista, pesoDe, rnd){
  const total = lista.reduce((s, x) => s + pesoDe(x), 0);
  let r = rnd() * total;
  for (const x of lista){ r -= pesoDe(x); if (r <= 0) return x; }
  return lista[lista.length - 1];
}

export function montarDadosDemonstracao(hoje = new Date()){
  const rnd = sorteio(2026);
  const itens = [];
  const add = (colecao, id, dados) => itens.push({ colecao, id, dados });

  // ---- Cadastros ----
  ELENCO.forEach(([id, nome, posicao, numero, pagante, podeVotar]) => {
    add("atletas", id, { nome, posicao, numero, ativo: true, podeVotar, pagante, observacoes: "", criadoEm: serverTimestamp() });
  });
  ADVERSARIOS.forEach(([id, nome, cidade]) => add("adversarios", id, { nome, cidade, observacoes: "", criadoEm: serverTimestamp() }));
  CAMPOS.forEach(([id, nome, endereco, tipo]) => add("campos", id, { nome, endereco, tipo, observacoes: "", criadoEm: serverTimestamp() }));

  const jogadores = ELENCO.filter(a => a[2] !== "Técnico").map(([id, nome, posicao]) => ({ id, nome, posicao }));
  const porPos = (pos) => jogadores.filter(j => j.posicao === pos);
  const votantes = ELENCO.filter(a => a[5]).map(a => a[0]);

  // ---- Partidas ----
  // Domingo seguinte a hoje = próximo jogo; os realizados vão de semana em semana para trás.
  const proximoDomingo = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  proximoDomingo.setDate(proximoDomingo.getDate() + ((7 - proximoDomingo.getDay()) % 7 || 7));
  const dataSemanas = (n) => { const d = new Date(proximoDomingo); d.setDate(d.getDate() + 7 * n); return iso(d); };

  const jogosRealizados = [];
  RESULTADOS.forEach((res, i) => {
    const idJogo = `jogo-${String(i + 1).padStart(2, "0")}`;
    const semanasAtras = RESULTADOS.length - i; // o 1º da lista é o mais antigo
    const adv = ADVERSARIOS[i % ADVERSARIOS.length][0];
    const campo = CAMPOS[(i * 2 + 1) % CAMPOS.length][0];
    const golsNos = res === "V" ? 2 + Math.floor(rnd() * 3) : res === "E" ? 1 + Math.floor(rnd() * 2) : Math.floor(rnd() * 2);
    const golsAdv = res === "V" ? Math.floor(rnd() * Math.min(golsNos, 2)) : res === "E" ? golsNos : golsNos + 1 + Math.floor(rnd() * 2);

    // Escalação: 1 goleiro, 2 zagueiros, 2 laterais, 2 volantes, 2 meias, 2 atacantes (rodízio entre os do elenco).
    const pega = (pos, qtd) => { const lista = porPos(pos); const ini = Math.floor(rnd() * lista.length); return Array.from({ length: Math.min(qtd, lista.length) }, (_, k) => lista[(ini + k) % lista.length]); };
    const titulares = [...pega("Goleiro", 1), ...pega("Zagueiro", 2), ...pega("Lateral", 2), ...pega("Volante", 2), ...pega("Meia", 2), ...pega("Atacante", 2)];
    const idsTit = new Set(titulares.map(t => t.id));
    const inicial = titulares.map(t => ({ atletaId: t.id, posicao: t.posicao }));
    // Final: uma substituição (entra um reserva da mesma posição, quando houver).
    const final = inicial.map(e => ({ ...e }));
    const trocaIdx = 1 + Math.floor(rnd() * 8);
    const reserva = porPos(final[trocaIdx].posicao).find(j => !idsTit.has(j.id));
    if (reserva) final[trocaIdx] = { atletaId: reserva.id, posicao: final[trocaIdx].posicao };

    // Gols e assistências (só de quem esteve em campo).
    const emCampo = final.map(e => jogadores.find(j => j.id === e.atletaId));
    const minutos = Array.from({ length: golsNos }, () => 3 + Math.floor(rnd() * 85)).sort((a, b) => a - b);
    const tiposGol = ["Finalização", "Finalização", "Cabeceio", "Falta", "Pênalti"];
    const eventos = minutos.map(min => {
      const autor = escolhaPonderada(emCampo.filter(j => j.posicao !== "Goleiro"), j => PESO_GOL[j.posicao] || 1, rnd);
      const garcom = rnd() < 0.75 ? escolhaPonderada(emCampo.filter(j => j.id !== autor.id && j.posicao !== "Goleiro"), j => j.posicao === "Meia" ? 4 : 1.5, rnd) : null;
      return { atletaGolId: autor.id, atletaAssistId: garcom ? garcom.id : null, minuto: min, tipoGol: tiposGol[Math.floor(rnd() * tiposGol.length)], tempo: min <= 45 ? "1º tempo" : "2º tempo" };
    });
    const golsDe = (id) => eventos.filter(e => e.atletaGolId === id).length;

    // Notas: cada votante dá uma nota por jogador que atuou.
    const avaliacoes = {};
    const jogaramIds = new Set([...inicial, ...final].map(e => e.atletaId));
    jogaramIds.forEach(id => {
      const base = 6.3 + (res === "V" ? 0.5 : res === "D" ? -0.5 : 0) + golsDe(id) * 0.8;
      avaliacoes[id] = {};
      votantes.forEach(v => {
        avaliacoes[id][v] = { nota: Math.max(4, Math.min(10, meioPonto(base + (rnd() - 0.5) * 2))), obs: "" };
      });
    });

    const data = dataSemanas(-semanasAtras);
    jogosRealizados.push(idJogo);
    add("jogos", idJogo, {
      data, horario: ["08:00", "10:00", "15:30"][i % 3], status: "realizado", adversarioId: adv, campoId: campo,
      tipoPartida: i % 4 === 3 ? "Campeonato" : "Amistoso", placarNos: golsNos, placarAdversario: golsAdv,
      decisao: "", penaltisNos: null, penaltisAdversario: null, criterioVencedor: "", criterioMotivo: "", observacoes: "",
      escalacaoInicial: inicial, escalacaoFinal: final, golsAssistencias: eventos, avaliacoesJogadores: avaliacoes,
      avaliacaoCampo: { nota: meioPonto(6 + rnd() * 3), obs: "" }, avaliacaoAdversario: { nota: meioPonto(6 + rnd() * 3), obs: "" },
      criadoEm: serverTimestamp(),
    });
  });

  // Próximos jogos (agendados) + confirmações de presença no primeiro.
  const agendados = [
    { id: "jogo-11", semanas: 0, adv: ADVERSARIOS[0][0], campo: CAMPOS[1][0], horario: "09:00", tipo: "Amistoso" },
    { id: "jogo-12", semanas: 1, adv: ADVERSARIOS[3][0], campo: CAMPOS[0][0], horario: "10:00", tipo: "Campeonato" },
  ];
  agendados.forEach(g => add("jogos", g.id, {
    data: dataSemanas(g.semanas), horario: g.horario, status: "agendado", adversarioId: g.adv, campoId: g.campo, tipoPartida: g.tipo,
    placarNos: null, placarAdversario: null, decisao: "", penaltisNos: null, penaltisAdversario: null, criterioVencedor: "", criterioMotivo: "", observacoes: "",
    escalacaoInicial: [], escalacaoFinal: [], golsAssistencias: [], avaliacoesJogadores: {}, avaliacaoCampo: null, avaliacaoAdversario: null,
    criadoEm: serverTimestamp(),
  }));
  jogadores.forEach((j, i) => {
    const r = i % 7 === 3 ? "nao" : i % 5 === 2 ? "talvez" : i % 9 === 8 ? null : "vou";
    if (r) add("presencas", `jogo-11_${j.id}`, { jogoId: "jogo-11", atletaId: j.id, resposta: r, atualizadoEm: serverTimestamp() });
  });

  // ---- Financeiro ----
  const valorMensalidade = 40;
  add("configuracoes", "geral", { valorMensalidade, chavePix: "time.demo@email.com", pixNome: "Tesouraria do Time", criadoEm: serverTimestamp() });
  const mesRefDe = (atras) => { const d = new Date(hoje.getFullYear(), hoje.getMonth() - atras, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
  const rotuloMes = (ref) => { const [a, m] = ref.split("-").map(Number); return `${MESES_PT[m - 1]}/${a}`; };
  [3, 2, 1, 0].forEach(atras => {
    const ref = mesRefDe(atras);
    const chancePago = [0.97, 0.93, 0.85, 0.6][3 - atras];
    ELENCO.filter(a => a[4]).forEach(([id, nome]) => {
      if (rnd() > chancePago) return;
      const dia = Math.min(28, 3 + Math.floor(rnd() * 20));
      const dataPg = atras === 0 ? iso(new Date(hoje.getFullYear(), hoje.getMonth(), Math.min(dia, hoje.getDate()))) : `${ref}-${String(dia).padStart(2, "0")}`;
      add("financeiro", `mens_${ref}_${id}`, { tipo: "mensalidade", valor: valorMensalidade, data: dataPg, descricao: `Mensalidade ${rotuloMes(ref)} — ${nome}`, atletaId: id, mesRef: ref, criadoEm: serverTimestamp() });
    });
  });
  const lancamento = (n, tipo, valor, data, descricao) => add("financeiro", `lanc-${n}`, { tipo, valor, data, descricao, criadoEm: serverTimestamp() });
  lancamento(1, "entrada", 350, `${mesRefDe(3)}-02`, "Saldo inicial do caixa");
  lancamento(2, "entrada", 300, `${mesRefDe(2)}-10`, "Patrocínio — Bar do Zé (camisas)");
  lancamento(3, "saida", 180, `${mesRefDe(3)}-20`, "Aluguel do campo — 2 jogos");
  lancamento(4, "saida", 220, `${mesRefDe(2)}-05`, "Bolas novas (2 unidades)");
  lancamento(5, "saida", 150, `${mesRefDe(2)}-22`, "Aluguel do campo");
  lancamento(6, "saida", 120, `${mesRefDe(1)}-08`, "Kit de coletes");
  lancamento(7, "saida", 160, `${mesRefDe(1)}-27`, "Arbitragem e aluguel do campo");
  lancamento(8, "entrada", 200, `${mesRefDe(0)}-02`, "Rifa da confraternização");

  return itens;
}

export async function popularDemonstracao(){
  const itens = montarDadosDemonstracao();
  await gravarEmLote(itens);
  return itens.length;
}

// Apaga os dados do time que estão na tela (usado para recomeçar uma demonstração).
export async function limparDadosDoTime(state){
  const alvos = [
    ...state.atletas.map(x => ["atletas", x.id]), ...state.atletas.map(x => ["atletas_privado", x.id]),
    ...state.adversarios.map(x => ["adversarios", x.id]), ...state.campos.map(x => ["campos", x.id]),
    ...state.jogos.map(x => ["jogos", x.id]), ...state.financeiro.map(x => ["financeiro", x.id]),
    ["configuracoes", "geral"],
  ];
  // Presenças ficam em outra coleção: apaga as dos jogos conhecidos, por atleta.
  state.jogos.forEach(j => state.atletas.forEach(a => alvos.push(["presencas", `${j.id}_${a.id}`])));
  await apagarEmLote(alvos.map(([colecao, id]) => ({ colecao, id })));
  return alvos.length;
}
