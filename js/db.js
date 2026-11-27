import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  query, orderBy, where, serverTimestamp, setDoc, getDoc, writeBatch, Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db, auth, ehSuperAdmin } from "./auth.js";
import { TEAM } from "./tenant.js";
import { planoVigente } from "./planos.js";

// ----------------------------------------------------------------------------
// MULTI-TIME: todo dado do time mora em  times/{TEAM.id}/{coleção}/{doc}.
// As telas continuam chamando listenCollection("jogos", ...), createDoc("jogos", ...)
// etc. com o nome simples da coleção; é aqui que o caminho do time é colocado,
// então um time nunca enxerga nem grava nos dados de outro.
// ----------------------------------------------------------------------------


// Plano vencido: o time fica só em consulta. As regras do Firestore já recusam
// a gravação; aqui interrompemos antes, com uma mensagem clara. O dono da
// plataforma não é barrado.
function exigirPlanoVigente(){
  if (planoVigente()) return;
  if (auth.currentUser && ehSuperAdmin(auth.currentUser.email)) return;
  throw Object.assign(
    new Error("o plano do time venceu e ele está só em consulta. Renove para voltar a cadastrar."),
    { code: "plano-vencido" }
  );
}

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
  exigirPlanoVigente();
  return addDoc(colRef(name), { ...data, criadoEm: serverTimestamp() });
}

export async function saveDoc(name, id, data){
  exigirPlanoVigente();
  return updateDoc(docRef(name, id), data);
}

export async function removeDoc(name, id){
  exigirPlanoVigente();
  return deleteDoc(docRef(name, id));
}

// Cria (ou sobrescreve) um documento com um id escolhido por quem chama, em
// vez de deixar o Firestore gerar um id aleatório — usado pra mensalidades
// (id = mês + atleta), onde marcar/desmarcar "pago" precisa ser uma
// operação idempotente (criar de novo com o mesmo id só atualiza o valor).
export async function createDocWithId(name, id, data){
  exigirPlanoVigente();
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

// Lê um documento uma única vez (sem ficar ouvindo). Devolve { id, ...dados } ou null.
export async function lerDocumento(name, id){
  const snap = await getDoc(docRef(name, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
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

// Todos os "vou" do time, de todos os jogos (usado na Avaliação: quem confirmou
// presença pode ter entrado no jogo mesmo sem constar em nenhuma escalação).
export function listenPresencasConfirmadas(cb){
  const q = query(colRef("presencas"), where("resposta", "==", "vou"));
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
  exigirPlanoVigente();
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
  exigirPlanoVigente();
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
  exigirPlanoVigente();
  return updateDoc(docRef("jogos", jogoId), fields);
}

// Grava vários documentos de uma vez (usado para carregar os dados de
// demonstração). Cada item: { colecao, id, dados }. O Firestore aceita até 500
// operações por lote, então quebramos em partes.
export async function gravarEmLote(itens){
  exigirPlanoVigente();
  for (let i = 0; i < itens.length; i += 400){
    const lote = writeBatch(db);
    itens.slice(i, i + 400).forEach(it => lote.set(docRef(it.colecao, it.id), it.dados));
    await lote.commit();
  }
}

// Importação por planilha. Cada item: { colecao, id?, dados, existente }.
// Novo (existente=false): cria com id gerado (ou o id informado) e criadoEm.
// Já existente: atualiza só os campos enviados, sem apagar o resto do documento.
// Devolve { id, colecao } de cada novo item, na ordem recebida.
export async function importarEmLote(itens){
  exigirPlanoVigente();
  const feitos = [];
  for (let i = 0; i < itens.length; i += 400){
    const lote = writeBatch(db);
    itens.slice(i, i + 400).forEach(it => {
      if (it.mesclar){
        // documento privado: cria ou completa, sem apagar os outros campos
        lote.set(docRef(it.colecao, it.id), it.dados, { merge: true });
      } else if (it.existente){
        lote.update(docRef(it.colecao, it.id), it.dados);
      } else {
        const ref = it.id ? docRef(it.colecao, it.id) : doc(colRef(it.colecao));
        lote.set(ref, { ...it.dados, criadoEm: serverTimestamp() });
        feitos.push({ id: ref.id, colecao: it.colecao });
      }
    });
    await lote.commit();
  }
  return feitos;
}

// Gera um id novo para a coleção do time (usado para ligar jogos a adversários e campos criados na mesma importação).
export function novoIdDoc(colecao){
  return doc(colRef(colecao)).id;
}

// Apaga vários documentos de uma vez. Cada item: { colecao, id }.
export async function apagarEmLote(itens){
  exigirPlanoVigente();
  for (let i = 0; i < itens.length; i += 400){
    const lote = writeBatch(db);
    itens.slice(i, i + 400).forEach(it => lote.delete(docRef(it.colecao, it.id)));
    await lote.commit();
  }
}

// ----------------------------------------------------------------------------
// Acesso do jogador (conta Google ligada a um atleta, por link individual)
//   convites/{token}  → link de uso único, com validade (criado pela equipe)
//   vinculos/{uid}    → conta Google ↔ atleta (criado pelo jogador ao usar o link)
// ----------------------------------------------------------------------------

// Código secreto do link (24 bytes aleatórios, em texto seguro para URL).
export function novoTokenConvite(){
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Gera o link individual de um atleta. Convites antigos dele (usados ou não)
// são apagados, então só existe um link válido por atleta.
export async function criarConvite(atletaId, tokensAntigos = [], dias = 7){
  exigirPlanoVigente();
  const token = novoTokenConvite();
  const lote = writeBatch(db);
  tokensAntigos.forEach(t => lote.delete(docRef("convites", t)));
  lote.set(docRef("convites", token), {
    atletaId, usado: false,
    expiraEm: Timestamp.fromDate(new Date(Date.now() + dias * 86400000)),
    criadoPor: (auth.currentUser?.email || "").toLowerCase(),
    criadoEm: serverTimestamp(),
  });
  await lote.commit();
  return token;
}

export async function cancelarConvites(tokens){
  exigirPlanoVigente();
  const lote = writeBatch(db);
  tokens.forEach(t => lote.delete(docRef("convites", t)));
  await lote.commit();
}

// A equipe tira o acesso: apaga o vínculo (e os convites) do atleta.
export async function desvincularJogador(uid, tokens = []){
  exigirPlanoVigente();
  const lote = writeBatch(db);
  lote.delete(docRef("vinculos", uid));
  tokens.forEach(t => lote.delete(docRef("convites", t)));
  await lote.commit();
}

// O jogador usa o link: cria o vínculo e marca o convite como usado (na mesma gravação).
export async function vincularConvite(token, atletaId){
  exigirPlanoVigente();
  const u = auth.currentUser;
  if (!u) throw new Error("Entre com sua conta Google primeiro.");
  const lote = writeBatch(db);
  lote.set(docRef("vinculos", u.uid), {
    atletaId, token, email: (u.email || "").toLowerCase(), criadoEm: serverTimestamp(),
  });
  lote.update(docRef("convites", token), { usado: true, usadoEm: serverTimestamp(), usadoPor: u.uid });
  await lote.commit();
}

// Respostas de presença de UM atleta (a tela do jogador só mostra as dele).
export function listenPresencasDoAtleta(atletaId, cb){
  const q = query(colRef("presencas"), where("atletaId", "==", atletaId));
  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    cb(items);
  }, (err) => {
    console.error("Erro ao ouvir presencas do atleta:", err);
    cb([], err);
  });
}

// Mensalidades/isenções de UM atleta (as regras só deixam o jogador ler as dele).
export function listenFinanceiroDoAtleta(atletaId, cb){
  const q = query(colRef("financeiro"), where("atletaId", "==", atletaId));
  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    cb(items);
  }, (err) => {
    console.error("Erro ao ouvir financeiro do atleta:", err);
    cb([], err);
  });
}
