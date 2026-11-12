import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  query, orderBy, where, serverTimestamp, setDoc, getDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db } from "./auth.js";
import { TEAM } from "./tenant.js";

// ----------------------------------------------------------------------------
// MULTI-TIME: todo dado do time mora em  times/{TEAM.id}/{coleção}/{doc}.
// As telas continuam chamando listenCollection("jogos", ...), createDoc("jogos", ...)
// etc. com o nome simples da coleção; é aqui que o caminho do time é colocado,
// então um time nunca enxerga nem grava nos dados de outro.
// ----------------------------------------------------------------------------

function colRef(name){
  if (!TEAM.id) throw new Error("Nenhum time selecionado.");
  return collection(db, "times", TEAM.id, name);
}
function docRef(name, id){
  if (!TEAM.id) throw new Error("Nenhum time selecionado.");
  return doc(db, "times", TEAM.id, name, id);
}

// ----------------------------------------------------------------------------
// Generic collection helpers (adversarios, campos, atletas, jogos)
// ----------------------------------------------------------------------------

export function listenCollection(name, orderField, cb){
  const q = query(colRef(name), orderBy(orderField, orderField === "data" ? "desc" : "asc"));
  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    cb(items);
  }, (err) => {
    console.error(`Erro ao ouvir ${name}:`, err);
    cb([], err);
  });
}

export async function createDoc(name, data){
  return addDoc(colRef(name), { ...data, criadoEm: serverTimestamp() });
}

export async function saveDoc(name, id, data){
  return updateDoc(docRef(name, id), data);
}

export async function removeDoc(name, id){
  return deleteDoc(docRef(name, id));
}

// Cria (ou sobrescreve) um documento com um id escolhido por quem chama, em
// vez de deixar o Firestore gerar um id aleatório — usado pra mensalidades
// (id = mês + atleta), onde marcar/desmarcar "pago" precisa ser uma
// operação idempotente (criar de novo com o mesmo id só atualiza o valor).
export async function createDocWithId(name, id, data){
  return setDoc(docRef(name, id), { ...data, criadoEm: serverTimestamp() });
}

// Ouve um único documento em tempo real (diferente de listenCollection, que
// ouve uma coleção inteira) — usado pra configurações gerais, como o valor
// atual da mensalidade.
export function listenDoc(name, id, cb){
  return onSnapshot(docRef(name, id), (snap) => {
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  }, (err) => {
    console.error(`Erro ao ouvir ${name}/${id}:`, err);
    cb(null, err);
  });
}

// ----------------------------------------------------------------------------
// Presenças (confirmação de presença por jogo) — coleção pública: qualquer
// pessoa com o link do jogo pode marcar. Doc id = `${jogoId}_${atletaId}`,
// então responder de novo só sobrescreve a resposta anterior.
// ----------------------------------------------------------------------------

export function listenPresencas(jogoId, cb){
  const q = query(colRef("presencas"), where("jogoId", "==", jogoId));
  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    cb(items);
  }, (err) => {
    console.error("Erro ao ouvir presencas:", err);
    cb([], err);
  });
}

export async function setPresenca(jogoId, atletaId, resposta){
  return setDoc(docRef("presencas", `${jogoId}_${atletaId}`), {
    jogoId, atletaId, resposta, atualizadoEm: serverTimestamp(),
  });
}

// ----------------------------------------------------------------------------
// Documentos "privados" (ex: atletas_privado) — mesmo id do documento
// público correspondente, leitura/escrita restrita à equipe do time
// pelas regras do Firestore.
// ----------------------------------------------------------------------------

export async function setPrivateDoc(name, id, data){
  return setDoc(docRef(name, id), data, { merge: true });
}

export async function getPrivateDoc(name, id){
  const snap = await getDoc(docRef(name, id));
  return snap.exists() ? snap.data() : {};
}

// ----------------------------------------------------------------------------
// Jogo — campos aninhados (escalação, gols/assistências, avaliações)
// Tudo fica dentro do próprio documento do jogo para manter a consulta simples.
// ----------------------------------------------------------------------------

export async function updateJogoField(jogoId, fields){
  return updateDoc(docRef("jogos", jogoId), fields);
}

// Grava vários documentos de uma vez (usado para carregar os dados de
// demonstração). Cada item: { colecao, id, dados }. O Firestore aceita até 500
// operações por lote, então quebramos em partes.
export async function gravarEmLote(itens){
  for (let i = 0; i < itens.length; i += 400){
    const lote = writeBatch(db);
    itens.slice(i, i + 400).forEach(it => lote.set(docRef(it.colecao, it.id), it.dados));
    await lote.commit();
  }
}

// Apaga vários documentos de uma vez. Cada item: { colecao, id }.
export async function apagarEmLote(itens){
  for (let i = 0; i < itens.length; i += 400){
    const lote = writeBatch(db);
    itens.slice(i, i + 400).forEach(it => lote.delete(docRef(it.colecao, it.id)));
    await lote.commit();
  }
}
