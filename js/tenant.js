import { auth, db, emailNormalizado, ehSuperAdmin } from "./auth.js";
import {
  doc, getDoc, setDoc, updateDoc, getDocs, deleteDoc, collection, onSnapshot, serverTimestamp, Timestamp, arrayUnion,
  arrayRemove, writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { APP_NOME, DIAS_DE_TESTE } from "./firebase-config.js";

// ============================================================================
// "Time" ativo (multi-time)
// Um único app atende vários times. Cada time tem um id (ex.: "meu-time") e todos
// os dados dele ficam em  times/{id}/...  no Firestore. O time aberto vem do
// endereço (?time=meu-time) ou do último time usado neste navegador.
// ============================================================================

const LS_ULTIMO_TIME = "app_ultimo_time";

export const COR_PADRAO = { primaria: "#1C1C1C", destaque: "#E4B62B" };

export const PRESETS_CORES = [
  { nome: "Preto e amarelo", primaria: "#1C1C1C", destaque: "#E4B62B" },
  { nome: "Verde e dourado", primaria: "#14532D", destaque: "#E4B62B" },
  { nome: "Azul e celeste", primaria: "#12306B", destaque: "#4FC3F7" },
  { nome: "Grená e dourado", primaria: "#6B1020", destaque: "#F2C14E" },
  { nome: "Roxo e lima", primaria: "#3B1F6B", destaque: "#B8E04A" },
  { nome: "Marinho e laranja", primaria: "#0F2747", destaque: "#FF8A3D" },
];

// Objeto "vivo": as telas leem TEAM.nome etc. na hora de desenhar, então
// basta atualizar estes campos (Object.assign) para tudo refletir a mudança.
export const TEAM = {
  id: null,
  existe: false,
  nome: "",
  nomeUpper: "",
  nomeHtml: "",        // nome já escapado, para usar dentro de HTML
  nomeUpperHtml: "",
  sigla: "",
  escudo: "",          // endereço da imagem exibida (escudo enviado ou o padrão gerado)
  escudoEnviado: "",   // só o escudo que o dirigente enviou (vazio = usando o padrão)
  corPrimaria: COR_PADRAO.primaria,
  corDestaque: COR_PADRAO.destaque,
  plano: "start",
  validoAte: null,     // Date ou null
  donoEmail: "",
  modalidade: "campo", // campo (11) | society (7) | futsal (5)
  visibilidade: "publica", // publica (qualquer pessoa com o link vê as telas) | equipe (só a equipe logada)
};

export function hashtags(){
  const slug = (TEAM.id || "").replace(/-/g, "");
  const tags = [`#${slug}`, "#futeboldevarzea"];
  if (TEAM.sigla) tags.push(`#somos${TEAM.sigla.toLowerCase().replace(/[^a-z0-9]/g, "")}`);
  return tags.join("\n");
}

// ----------------------------------------------------------------------------
// Id do time
// ----------------------------------------------------------------------------

export function idValido(id){
  return /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(String(id || ""));
}

export function slugify(texto){
  return String(texto || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export function resolverTeamId(){
  try{
    const param = new URLSearchParams(location.search).get("time");
    if (param){
      const id = param.trim().toLowerCase();
      if (idValido(id)){ localStorage.setItem(LS_ULTIMO_TIME, id); return id; }
      return "invalido:" + id;
    }
    const salvo = localStorage.getItem(LS_ULTIMO_TIME);
    if (salvo && idValido(salvo)) return salvo;
  }catch(err){ /* localStorage indisponível — segue sem lembrar o time */ }
  return null;
}

export function irParaTime(id, hash = "#dashboard"){
  try{ localStorage.setItem(LS_ULTIMO_TIME, id); }catch(err){ /* ok */ }
  location.href = `${location.origin}${location.pathname}?time=${encodeURIComponent(id)}${hash}`;
}

export function sairDoTime(){
  try{ localStorage.removeItem(LS_ULTIMO_TIME); }catch(err){ /* ok */ }
  location.href = `${location.origin}${location.pathname}`;
}

// Link público do time (para compartilhar). `hash` opcional, ex.: "#presenca/abc".
export function linkDoTime(hash = ""){
  return `${location.origin}${location.pathname}?time=${encodeURIComponent(TEAM.id)}${hash}`;
}

// ----------------------------------------------------------------------------
// Cores
// ----------------------------------------------------------------------------

function hexParaRgb(hex){
  const h = String(hex || "").replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return [28, 28, 28];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbParaHex([r, g, b]){
  return "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
function misturar(hexA, hexB, t){
  const a = hexParaRgb(hexA), b = hexParaRgb(hexB);
  return rgbParaHex(a.map((v, i) => v + (b[i] - v) * t));
}
function luminancia(hex){
  const [r, g, b] = hexParaRgb(hex).map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const tintaSobre = (fundo) => luminancia(fundo) > 0.45 ? "#171717" : "#FFFFFF";
// A cor principal é usada em superfícies escuras (menu lateral, súmula): se vier
// muito clara, escurece para o texto branco continuar legível.
function garantirEscura(hex){
  return luminancia(hex) > 0.18 ? misturar(hex, "#000000", 0.55) : hex;
}

export function cssDoTema(primaria, destaque){
  const P = garantirEscura(primaria || COR_PADRAO.primaria);
  const G = destaque || COR_PADRAO.destaque;
  const [gr, gg, gb] = hexParaRgb(G);
  return `
:root{
  --pitch:${P};
  --pitch-dark:${misturar(P, "#000000", 0.2)};
  --pitch-darker:${misturar(P, "#000000", 0.85)};
  --pitch-light:${misturar(G, "#FFFFFF", 0.85)};
  --gold:${G};
  --gold-ink:${tintaSobre(G)};
  --accent-ink:${tintaSobre(P)};
  --pending-bg:${misturar(G, "#FFFFFF", 0.82)};
}
html[data-theme="dark"]{
  --pitch-light:rgba(${gr},${gg},${gb},.14);
  --pending-bg:rgba(${gr},${gg},${gb},.16);
  --accent-ink:${tintaSobre(G)};
}`;
}

// Escudo padrão: círculo na cor do time com a sigla — usado até o dirigente
// enviar o escudo de verdade.
export function escudoPadrao(sigla, primaria, destaque){
  const P = garantirEscura(primaria || COR_PADRAO.primaria);
  const G = destaque || COR_PADRAO.destaque;
  const txt = String(sigla || "?").toUpperCase().replace(/[<>&"']/g, "").slice(0, 3) || "?";
  const tam = txt.length >= 3 ? 150 : 190;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="256" cy="256" r="250" fill="${G}"/><circle cx="256" cy="256" r="226" fill="${P}"/><text x="256" y="256" text-anchor="middle" dominant-baseline="central" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-size="${tam}" fill="${G}">${txt}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

// Redimensiona a imagem enviada (cabe num quadrado, sem cortar) e devolve um
// data URL PNG pequeno — guardado direto no documento do time no Firestore.
export function redimensionarImagem(file, lado = 256){
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error("Escolha um arquivo de imagem (PNG ou JPG)."));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const esc = Math.min(lado / img.width, lado / img.height, 1);
      const w = Math.max(1, Math.round(img.width * esc)), h = Math.max(1, Math.round(img.height * esc));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Não consegui ler essa imagem.")); };
    img.src = url;
  });
}

// ----------------------------------------------------------------------------
// Carregar o time e aplicar a marca na tela
// ----------------------------------------------------------------------------

function escHtml(t){
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function preencherTeam(id, d){
  const nome = (d.nome || "").trim() || "Meu Time";
  const sigla = (d.sigla || "").trim() || nome.split(/\s+/).map(p => p[0]).join("").slice(0, 3).toUpperCase();
  const corPrimaria = d.corPrimaria || COR_PADRAO.primaria;
  const corDestaque = d.corDestaque || COR_PADRAO.destaque;
  Object.assign(TEAM, {
    id, existe: true, nome, nomeUpper: nome.toUpperCase(), nomeHtml: escHtml(nome), nomeUpperHtml: escHtml(nome.toUpperCase()), sigla,
    escudoEnviado: d.escudo || "",
    escudo: d.escudo || escudoPadrao(sigla, corPrimaria, corDestaque),
    corPrimaria, corDestaque,
    plano: d.plano || "start",
    validoAte: d.validoAte?.toDate ? d.validoAte.toDate() : (d.validoAte ? new Date(d.validoAte) : null),
    donoEmail: d.donoEmail || "",
    modalidade: ["campo", "society", "futsal"].includes(d.modalidade) ? d.modalidade : "campo",
    visibilidade: d.visibilidade === "equipe" ? "equipe" : "publica",
  });
}

export async function carregarTime(id){
  TEAM.id = id;
  try{
    const snap = await getDoc(doc(db, "times", id));
    if (!snap.exists()){ TEAM.existe = false; return false; }
    preencherTeam(id, snap.data());
    return true;
  }catch(err){
    console.error("Erro ao carregar o time:", err);
    TEAM.existe = false;
    return false;
  }
}

// Mantém a marca em dia quando o dirigente edita as configurações.
export function observarTime(cb){
  return onSnapshot(doc(db, "times", TEAM.id), (snap) => {
    if (!snap.exists()) return;
    preencherTeam(TEAM.id, snap.data());
    aplicarMarca();
    if (cb) cb();
  }, (err) => console.error("Erro ao ouvir o time:", err));
}

function definirLink(rel, href, extra = {}){
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el){ el = document.createElement("link"); el.rel = rel; document.head.appendChild(el); }
  Object.entries(extra).forEach(([k, v]) => el.setAttribute(k, v));
  el.href = href;
}

export function aplicarMarca(){
  document.title = TEAM.existe ? `${TEAM.nome} — Gestão do Time` : APP_NOME;

  let tema = document.getElementById("tema-do-time");
  if (!tema){ tema = document.createElement("style"); tema.id = "tema-do-time"; document.head.appendChild(tema); }
  tema.textContent = cssDoTema(TEAM.corPrimaria, TEAM.corDestaque);
  if (!TEAM.existe) return; // tela inicial (sem time): só título e tema padrão

  const P = garantirEscura(TEAM.corPrimaria);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute("content", P));
  const titApp = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (titApp) titApp.setAttribute("content", TEAM.nome);

  document.querySelectorAll(".brand-name, .mobile-topbar-brand span").forEach(el => { el.textContent = TEAM.nomeUpper; });
  document.querySelectorAll(".brand-crest-img, .mobile-topbar-brand img").forEach(el => { el.src = TEAM.escudo; el.alt = TEAM.nome; });

  // Ícone da aba / "adicionar à tela inicial" / app instalável: o escudo do time.
  // Primeiro o escudo como está (aparece na hora); depois, quando as imagens quadradas
  // com fundo ficam prontas, elas substituem (iPhone e Android preferem PNG opaco).
  definirLink("icon", TEAM.escudo);
  definirLink("apple-touch-icon", TEAM.escudo);
  definirManifesto(P, [
    { src: absoluto(TEAM.escudo), sizes: "192x192", type: tipoImagem(TEAM.escudo), purpose: "any" },
    { src: absoluto(TEAM.escudo), sizes: "512x512", type: tipoImagem(TEAM.escudo), purpose: "any" },
  ]);
  montarIconesDoTime(P).catch(() => { /* fica com o escudo simples acima */ });
}

const absoluto = (u) => /^data:|^https?:/.test(u) ? u : new URL(u, location.href).href;
const tipoImagem = (u) => u.startsWith("data:image/svg") ? "image/svg+xml" : "image/png";

// Manifesto do app instalável gerado na hora, com o nome e o ícone do time.
// (O Chrome do Android usa; no iPhone vale o apple-touch-icon.)
function definirManifesto(P, icons){
  try{
    const base = location.origin + location.pathname;
    const manifesto = {
      name: `${TEAM.nome} — Gestão do Time`, short_name: TEAM.nome.slice(0, 12),
      start_url: `${base}?time=${TEAM.id}#dashboard`, scope: base, display: "standalone",
      background_color: P, theme_color: P, icons,
    };
    const blob = new Blob([JSON.stringify(manifesto)], { type: "application/manifest+json" });
    definirLink("manifest", URL.createObjectURL(blob));
  }catch(err){ /* sem manifesto dinâmico, o app continua funcionando */ }
}

// Desenha o escudo centralizado sobre a cor do time e devolve um PNG quadrado.
async function iconeQuadrado(src, lado, fundo, folga){
  const img = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = erro; i.src = src; });
  const c = document.createElement("canvas"); c.width = c.height = lado;
  const x = c.getContext("2d");
  x.fillStyle = fundo; x.fillRect(0, 0, lado, lado);
  const area = lado * (1 - 2 * folga);
  const nw = img.naturalWidth || area, nh = img.naturalHeight || area;
  const esc = Math.min(area / nw, area / nh);
  const w = nw * esc, h = nh * esc;
  x.imageSmoothingQuality = "high";
  x.drawImage(img, (lado - w) / 2, (lado - h) / 2, w, h);
  return c.toDataURL("image/png");
}

async function montarIconesDoTime(P){
  const [i180, i192, i512, m512] = await Promise.all([
    iconeQuadrado(TEAM.escudo, 180, P, 0.08),
    iconeQuadrado(TEAM.escudo, 192, P, 0.08),
    iconeQuadrado(TEAM.escudo, 512, P, 0.08),
    iconeQuadrado(TEAM.escudo, 512, P, 0.2),   // "maskable": o Android pode recortar as bordas
  ]);
  definirLink("apple-touch-icon", i180);
  definirLink("icon", i192);
  definirManifesto(P, [
    { src: i192, sizes: "192x192", type: "image/png", purpose: "any" },
    { src: i512, sizes: "512x512", type: "image/png", purpose: "any" },
    { src: m512, sizes: "512x512", type: "image/png", purpose: "maskable" },
  ]);
}

// ----------------------------------------------------------------------------
// Equipe (quem pode editar) — guardada em times/{id}/privado/equipe
// ----------------------------------------------------------------------------

export async function lerEquipe(){
  const snap = await getDoc(doc(db, "times", TEAM.id, "privado", "equipe"));
  return snap.exists() ? (snap.data().emails || []) : [];
}

export async function salvarEquipe(emails){
  const limpos = [...new Set(emails.map(emailNormalizado).filter(Boolean))];
  await setDoc(doc(db, "times", TEAM.id, "privado", "equipe"), { emails: limpos });
  return limpos;
}

// O usuário logado pode editar este time? (dono da plataforma ou membro da equipe)
export async function usuarioEhDaEquipe(user){
  if (!user || !TEAM.id) return false;
  if (ehSuperAdmin(user.email)) return true;
  try{
    const emails = await lerEquipe();
    return emails.map(emailNormalizado).includes(emailNormalizado(user.email));
  }catch(err){
    return false; // sem permissão = não é da equipe
  }
}

// ----------------------------------------------------------------------------
// Criar time e lista "meus times"
// ----------------------------------------------------------------------------

export async function criarTime({ id, nome, sigla, donoEmail, plano = "teste", validoAte = null, corPrimaria, corDestaque, modalidade = "campo" }){
  const fim = validoAte || new Date(Date.now() + DIAS_DE_TESTE * 86400000);
  const dono = emailNormalizado(donoEmail);
  await setDoc(doc(db, "times", id), {
    nome: nome.trim(), sigla: (sigla || "").trim().toUpperCase(),
    escudo: "", corPrimaria: corPrimaria || COR_PADRAO.primaria, corDestaque: corDestaque || COR_PADRAO.destaque,
    plano, validoAte: Timestamp.fromDate(fim), donoEmail: dono, criadoEm: serverTimestamp(),
    // "campo" é o padrão: só grava o campo quando é outra modalidade.
    ...(modalidade && modalidade !== "campo" ? { modalidade } : {}),
  });
  await setDoc(doc(db, "times", id, "privado", "equipe"), { emails: [dono] });
  const eu = auth.currentUser ? emailNormalizado(auth.currentUser.email) : "";
  if (eu && eu === dono){
    await setDoc(doc(db, "acessos", eu), { times: arrayUnion(id) }, { merge: true });
  }
}

export async function meusTimes(email){
  try{
    const snap = await getDoc(doc(db, "acessos", emailNormalizado(email)));
    return snap.exists() ? (snap.data().times || []) : [];
  }catch(err){ return []; }
}

export async function plataformaAberta(){
  try{
    const snap = await getDoc(doc(db, "plataforma", "config"));
    return snap.exists() && snap.data().autoCadastro === true;
  }catch(err){ return false; }
}

// ----------------------------------------------------------------------------
// Edição do time, lista de times e painel do dono
// ----------------------------------------------------------------------------

// Campos que a equipe do time pode mudar (o firestore.rules aceita só estes).
export async function atualizarTime(campos){
  await updateDoc(doc(db, "times", TEAM.id), campos);
}

export async function listarTimes(){
  const snap = await getDocs(collection(db, "times"));
  const itens = [];
  snap.forEach(d => {
    const x = d.data();
    itens.push({
      id: d.id, nome: x.nome || d.id, plano: x.plano || "start", donoEmail: x.donoEmail || "",
      validoAte: x.validoAte?.toDate ? x.validoAte.toDate() : null,
    });
  });
  return itens.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

// Só o dono da plataforma: muda plano e validade de qualquer time.
export async function atualizarPlanoDoTime(id, { plano, validoAte }){
  await updateDoc(doc(db, "times", id), { plano, validoAte: Timestamp.fromDate(validoAte) });
}

// Coleções de dados que existem dentro de times/{id}. O Firestore não apaga
// subcoleções sozinho quando o documento do time é apagado, por isso a lista
// fica aqui (e o backup usa a mesma).
export const SUBCOLECOES_DO_TIME = ["adversarios", "campos", "atletas", "atletas_privado", "jogos", "financeiro", "configuracoes", "presencas"];

// Só o dono da plataforma: apaga o time inteiro (todos os dados, a equipe e o
// próprio time) e tira o time da lista "Seus times" de quem fazia parte dele.
// Devolve quantos documentos foram apagados. O documento do time é o último a
// sair, então, se algo falhar no meio, o time continua na lista e dá para tentar de novo.
export async function excluirTime(id){
  if (!idValido(id)) throw new Error("Código de time inválido.");
  const emails = new Set();
  const equipe = await getDoc(doc(db, "times", id, "privado", "equipe"));
  if (equipe.exists()) (equipe.data().emails || []).forEach(e => emails.add(emailNormalizado(e)));
  const time = await getDoc(doc(db, "times", id));
  if (time.exists() && time.data().donoEmail) emails.add(emailNormalizado(time.data().donoEmail));

  let total = 0;
  for (const nome of [...SUBCOLECOES_DO_TIME, "privado"]){
    const snap = await getDocs(collection(db, "times", id, nome));
    const refs = snap.docs.map(d => d.ref);
    for (let i = 0; i < refs.length; i += 400){
      const lote = writeBatch(db);
      refs.slice(i, i + 400).forEach(r => lote.delete(r));
      await lote.commit();
    }
    total += refs.length;
  }
  await deleteDoc(doc(db, "times", id));
  total += 1;

  // Limpa o atalho "Seus times". Falha aqui não é grave (o atalho só aponta para um time que não existe mais).
  for (const email of emails){
    try{ await setDoc(doc(db, "acessos", email), { times: arrayRemove(id) }, { merge: true }); }
    catch(err){ console.warn("Não consegui limpar o atalho de", email, err); }
  }
  try{ if (localStorage.getItem(LS_ULTIMO_TIME) === id) localStorage.removeItem(LS_ULTIMO_TIME); }catch(err){ /* ok */ }
  return total;
}

export async function definirAutoCadastro(aberto){
  await setDoc(doc(db, "plataforma", "config"), { autoCadastro: !!aberto }, { merge: true });
}
