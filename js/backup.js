import { collection, getDocs, Timestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db } from "./auth.js";
import { TEAM, SUBCOLECOES_DO_TIME } from "./tenant.js";
import { gravarEmLote } from "./db.js";

// ============================================================================
// Backup e importação de dados de um time.
// O arquivo .json tem o mesmo formato do botão "Exportar backup" do app antigo
// do Bom D' Copus, então serve tanto para trazer um time de fora quanto para
// guardar uma cópia de segurança.
// ============================================================================

export const COLECOES_BACKUP = SUBCOLECOES_DO_TIME;

export const NOMES_COLECOES = {
  adversarios: "Adversários", campos: "Campos", atletas: "Atletas",
  atletas_privado: "Atletas (dados privados)", jogos: "Jogos", financeiro: "Financeiro",
  configuracoes: "Configurações", presencas: "Confirmações de presença",
};

const FORMATO = "gestao-time-backup";

// Datas viram { __ts: milissegundos } no arquivo e voltam a ser datas do Firestore ao importar.
function codificar(v){
  if (v === null || v === undefined) return v;
  if (typeof v.toMillis === "function") return { __ts: v.toMillis() };
  if (v instanceof Date) return { __ts: v.getTime() };
  if (Array.isArray(v)) return v.map(codificar);
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, codificar(x)]));
  return v;
}

function decodificar(v){
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(decodificar);
  if (typeof v === "object"){
    const chaves = Object.keys(v);
    if (chaves.length === 1 && chaves[0] === "__ts" && typeof v.__ts === "number") return Timestamp.fromMillis(v.__ts);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decodificar(x)]));
  }
  return v;
}

// Lê todas as coleções do time aberto.
export async function gerarBackup(teamId = TEAM.id){
  const colecoes = {}, contagens = {}, falhas = [];
  for (const nome of COLECOES_BACKUP){
    try{
      const snap = await getDocs(collection(db, "times", teamId, nome));
      colecoes[nome] = snap.docs.map(d => ({ id: d.id, dados: codificar(d.data()) }));
      contagens[nome] = colecoes[nome].length;
    }catch(err){
      console.error("Backup — falha em", nome, err);
      falhas.push(nome);
    }
  }
  return {
    backup: { formato: FORMATO, versao: 1, origem: `gestao-time:${teamId}`, geradoEm: new Date().toISOString(), contagens, colecoes },
    contagens, falhas,
  };
}

export function baixarJson(objeto, nomeArquivo){
  const blob = new Blob([JSON.stringify(objeto)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nomeArquivo;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Lê e confere o arquivo escolhido. Lança um erro com mensagem clara se não servir.
export async function lerArquivoBackup(arquivo){
  let dados;
  try{ dados = JSON.parse(await arquivo.text()); }
  catch(err){ throw new Error("Este arquivo não é um backup válido (não consegui ler o conteúdo)."); }
  if (!dados || dados.formato !== FORMATO || typeof dados.colecoes !== "object") throw new Error("Este arquivo não parece ser um backup deste app.");
  if (dados.versao !== 1) throw new Error("Versão de backup não reconhecida.");
  const contagens = {};
  for (const nome of COLECOES_BACKUP){
    const lista = dados.colecoes[nome];
    if (lista === undefined) continue;
    if (!Array.isArray(lista)) throw new Error(`Backup inválido: "${nome}" não é uma lista.`);
    lista.forEach(item => {
      if (!item || typeof item.id !== "string" || !item.id || item.id.includes("/") || item.id === "." || item.id === ".." || typeof item.dados !== "object" || item.dados === null){
        throw new Error(`Backup inválido: há um registro com formato errado em "${nome}".`);
      }
    });
    contagens[nome] = lista.length;
  }
  if (!Object.keys(contagens).length) throw new Error("O backup está vazio.");
  return { dados, contagens };
}

// Grava o backup no time aberto. Os ids são mantidos, então importar de novo o
// mesmo arquivo só sobrescreve os mesmos registros (não duplica).
export async function importarBackup(dados){
  const itens = [];
  for (const nome of COLECOES_BACKUP){
    (dados.colecoes[nome] || []).forEach(item => itens.push({ colecao: nome, id: item.id, dados: decodificar(item.dados) }));
  }
  await gravarEmLote(itens);
  return itens.length;
}
