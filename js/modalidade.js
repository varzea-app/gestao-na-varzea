// Modalidade do time: campo (11), society (7) ou futsal (5).
// Define as posições que o time usa, quantos jogadores entram em campo e as
// siglas dos avisos. A modalidade fica em times/{id}.modalidade; time sem esse
// campo (os criados antes desta versão) é "campo".
import { TEAM } from "./tenant.js";
import { POSICAO_TECNICO } from "./stats.js";

const POSICOES_CAMPO = ["Goleiro", "Zagueiro", "Lateral", "Volante", "Meia", "Atacante"];
const POSICOES_FUTSAL = ["Goleiro", "Fixo", "Ala", "Pivô"];

export const MODALIDADES = {
  campo: { id: "campo", nome: "Campo", jogadores: 11, posicoes: POSICOES_CAMPO },
  society: { id: "society", nome: "Society", jogadores: 7, posicoes: POSICOES_CAMPO },
  futsal: { id: "futsal", nome: "Futsal", jogadores: 5, posicoes: POSICOES_FUTSAL },
};

export const SIGLAS = {
  Goleiro: "GOL", Zagueiro: "ZAG", Lateral: "LAT", Volante: "VOL", Meia: "MEI", Atacante: "ATA",
  Fixo: "FIX", Ala: "ALA", "Pivô": "PIV",
};

const PLURAIS = {
  Goleiro: "goleiros", Zagueiro: "zagueiros", Lateral: "laterais", Volante: "volantes", Meia: "meias", Atacante: "atacantes",
  Fixo: "fixos", Ala: "alas", "Pivô": "pivôs",
};

// Ordem de exibição (de trás para a frente); posições "equivalentes" dividem o lugar.
const ORDEM = {
  Goleiro: 0, Zagueiro: 1, Fixo: 1, Lateral: 2, Ala: 2, Volante: 3, Meia: 4, Atacante: 5, "Pivô": 5,
};

export function idModalidade(){
  return MODALIDADES[TEAM.modalidade] ? TEAM.modalidade : "campo";
}
export function modalidadeAtual(){ return MODALIDADES[idModalidade()]; }

// Posições jogadas em campo (usadas na escalação da partida).
export function posicoesDaModalidade(){ return modalidadeAtual().posicoes; }
// Categorias do cadastro do atleta: as posições + Técnico (que não joga).
export function categoriasAtleta(){ return [...posicoesDaModalidade(), POSICAO_TECNICO]; }
export function jogadoresEmCampo(){ return modalidadeAtual().jogadores; }

export function siglaPosicao(pos){ return SIGLAS[pos] || pos || "---"; }
export function ordemPosicao(pos){ return pos in ORDEM ? ORDEM[pos] : 99; }
export function pluralPosicao(pos){ return PLURAIS[pos] || String(pos || "").toLowerCase(); }

// Posições "vizinhas" (usadas só como último recurso na escalação ideal).
export function posicoesProximas(){
  if (idModalidade() === "futsal"){
    return { Goleiro: [], Fixo: ["Ala"], Ala: ["Fixo", "Pivô"], "Pivô": ["Ala"] };
  }
  return {
    Goleiro: [], Zagueiro: ["Lateral", "Volante"], Lateral: ["Zagueiro", "Meia"],
    Volante: ["Meia", "Zagueiro"], Meia: ["Volante", "Atacante"], Atacante: ["Meia"],
  };
}

const DE_CAMPO_PARA_FUTSAL = { Goleiro: "Goleiro", Zagueiro: "Fixo", Lateral: "Ala", Atacante: "Pivô", Volante: "", Meia: "" };
const DE_FUTSAL_PARA_CAMPO = { Goleiro: "Goleiro", Fixo: "Zagueiro", Ala: "Lateral", "Pivô": "Atacante" };

// Posição equivalente ao trocar de modalidade. Campo e society usam as mesmas
// posições (nada muda). Devolve "" quando não há equivalente (volante e meia no
// futsal); "Técnico" e posições vazias ficam como estão.
export function converterPosicao(pos, de, para){
  if (!pos || pos === POSICAO_TECNICO) return pos || "";
  const futsalDe = de === "futsal", futsalPara = para === "futsal";
  if (futsalDe === futsalPara) return pos;
  if (futsalPara) return pos in DE_CAMPO_PARA_FUTSAL ? DE_CAMPO_PARA_FUTSAL[pos] : pos;
  return pos in DE_FUTSAL_PARA_CAMPO ? DE_FUTSAL_PARA_CAMPO[pos] : pos;
}

// Leva uma posição jogada numa partida antiga para o vocabulário da modalidade
// atual (ex.: "Zagueiro" de um jogo antigo vira "Fixo" num time que passou para
// o futsal). Posições sem equivalente voltam vazias.
export function posicaoNaModalidade(pos){
  if (!pos) return pos;
  return idModalidade() === "futsal" ? converterPosicao(pos, "campo", "futsal") : converterPosicao(pos, "futsal", "campo");
}
