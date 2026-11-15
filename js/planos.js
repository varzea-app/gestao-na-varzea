import { TEAM } from "./tenant.js";

// ============================================================================
// PLANOS — é AQUI que você decide o que cada plano libera.
// Cada plano lista os "recursos" que inclui. Para mover uma função de plano,
// basta mudar o nome do recurso de uma lista para outra.
//
// Sempre incluído (todos os planos): Dashboard, Ranking, Histórico/súmula,
// Cadastros (atletas, adversários, campos), Partidas com placar e gols/assistências.
// ============================================================================

const RECURSOS_PRO = [
  "escalacao",      // escalação inicial e final dentro da partida
  "avaliacao",      // página Avaliação (notas dos jogadores)
  "presenca",       // link público de confirmação de presença
  "extrato",        // extrato (ficha) de cada jogador
  "flyer",          // imagens de convite/resultado para compartilhar
];

const RECURSOS_CRAQUE = [
  ...RECURSOS_PRO,
  "financeiro",         // mensalidades e caixa do time
  "escalacao-ideal",    // melhor time por formação, calculado pelas notas
  "retrospecto",        // campanha contra cada adversário e campo
  "evolucao",           // evolução mês a mês: aproveitamento, notas e gols
  "premiacoes",         // destaque do mês / da temporada
  "avaliacao-campo",    // aba "Campo & adversário" da partida
];

export const PLANOS = {
  start:  { nome: "Start",  recursos: [] },
  pro:    { nome: "Pro",    recursos: RECURSOS_PRO },
  craque: { nome: "Craque", recursos: RECURSOS_CRAQUE },
  // Teste grátis: libera tudo por alguns dias (ver DIAS_DE_TESTE).
  teste:  { nome: "Teste grátis", recursos: RECURSOS_CRAQUE },
};

// Nome amigável de cada recurso, usado na mensagem "não incluso no seu plano".
export const NOMES_RECURSOS = {
  escalacao: "Escalação da partida",
  avaliacao: "Avaliação dos jogadores",
  presenca: "Confirmação de presença",
  extrato: "Extrato do jogador",
  flyer: "Imagens para compartilhar",
  financeiro: "Financeiro",
  "escalacao-ideal": "Escalação ideal",
  retrospecto: "Retrospecto",
  evolucao: "Evolução do ano",
  premiacoes: "Premiações",
  "avaliacao-campo": "Avaliação de campo e adversário",
};

// Rota do app → recurso que ela exige (rota que não está aqui é livre).
export const RECURSO_DA_ROTA = {
  avaliacao: "avaliacao",
  financeiro: "financeiro",
  extrato: "extrato",
  presenca: "presenca",
  "escalacao-ideal": "escalacao-ideal",
  retrospecto: "retrospecto",
  evolucao: "evolucao",
  premiacoes: "premiacoes",
};

export function planoDoTime(){
  return PLANOS[TEAM.plano] || PLANOS.start;
}

export function temRecurso(recurso){
  if (!recurso) return true;
  return planoDoTime().recursos.includes(recurso);
}

// Menor plano (start < pro < craque) que inclui o recurso — para a mensagem
// "disponível no plano X".
export function planoMinimo(recurso){
  for (const k of ["start", "pro", "craque"]){
    if (PLANOS[k].recursos.includes(recurso)) return PLANOS[k].nome;
  }
  return PLANOS.craque.nome;
}

// Plano dentro da validade? (sem data = sem vencimento)
export function planoVigente(){
  return !TEAM.validoAte || TEAM.validoAte.getTime() > Date.now();
}

// Dias de calendário entre hoje e a data (negativo = já passou). Contar por
// dia evita "faltam 6 dias" para uma data que vence daqui a 5 (o plano vale
// até o fim do dia).
export function diasAte(data){
  const dia = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((dia(data) - dia(new Date())) / 86400000);
}

export function diasRestantes(){
  return TEAM.validoAte ? diasAte(TEAM.validoAte) : null;
}
