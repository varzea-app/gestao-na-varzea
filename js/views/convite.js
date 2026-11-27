import { TEAM } from "../tenant.js";
import { $, escapeHtml, toast, formatDate, dataISOLocal } from "../utils.js";
import { lerDocumento, vincularConvite } from "../db.js";

// ============================================================================
// Link individual de acesso do jogador (#convite/<código>). O jogador entra com
// a conta Google, confere que o convite é dele e confirma. A conta passa a
// ficar ligada àquele atleta; o convite vale uma vez só e tem validade.
// ============================================================================

const GOOGLE_SVG = `<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.87-3.04.87-2.34 0-4.32-1.58-5.03-3.7H.95v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.73A5.4 5.4 0 0 1 3.69 9c0-.6.1-1.19.28-1.73V4.94H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.06l3.02-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.94l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>`;

// Resultado da leitura do convite, guardado por código (a tela é redesenhada
// várias vezes; só lemos uma vez).
let lido = { token: null, estado: "nada", convite: null };   // nada | lendo | ok | invalido | usado | expirado | erro
let confirmando = false;

function cartao(root, titulo, corpo, extra = ""){
  root.innerHTML = `
    <div class="card restricted-card">
      <img src="${TEAM.escudo}" alt="${TEAM.nomeHtml}">
      <h2>${titulo}</h2>
      ${corpo}
      ${extra}
    </div>`;
}

export function renderConvite(root, state, token, { entrar, aposVincular, authPronto }){
  if (!token){
    cartao(root, "Convite inválido", `<p>O link está incompleto. Peça um link novo ao administrador do time.</p>`);
    return;
  }
  if (!authPronto){ root.innerHTML = `<div class="loader">Carregando…</div>`; return; }

  const user = state.usuario;
  if (!user){
    cartao(root, `Acesso ao ${escapeHtml(TEAM.nome)}`,
      `<p>Você recebeu um link de acesso individual. Entre com a sua conta Google para continuar.</p>
       <button id="cv-login" class="btn-google">${GOOGLE_SVG} Entrar com Google</button>`);
    $("#cv-login", root)?.addEventListener("click", entrar);
    return;
  }
  if (state.isJogador){
    const a = state.atletas.find(x => x.id === state.vinculo?.atletaId);
    cartao(root, "Acesso já ativo", `<p>Esta conta já está ligada ${a ? `ao atleta <strong>${escapeHtml(a.nome)}</strong>` : "a um atleta"}.</p>`,
      `<div style="margin-top:12px;"><a class="btn btn-primary btn-sm" href="#meu-espaco">Abrir meu espaço</a></div>`);
    return;
  }

  // Conta logada, ainda sem vínculo: lê o convite uma vez.
  if (lido.token !== token){
    lido = { token, estado: "lendo", convite: null };
    lerDocumento("convites", token).then(c => {
      if (!c) lido = { token, estado: "invalido", convite: null };
      else if (c.usado) lido = { token, estado: "usado", convite: c };
      else {
        const exp = c.expiraEm?.toDate ? c.expiraEm.toDate() : new Date(c.expiraEm);
        lido = { token, estado: exp.getTime() < Date.now() ? "expirado" : "ok", convite: c };
      }
      if (location.hash.startsWith("#convite/")) renderConvite(root, state, token, { entrar, aposVincular, authPronto });
    }).catch(err => {
      console.error(err);
      lido = { token, estado: "erro", convite: null };
      if (location.hash.startsWith("#convite/")) renderConvite(root, state, token, { entrar, aposVincular, authPronto });
    });
  }

  if (lido.estado === "lendo"){ root.innerHTML = `<div class="loader">Conferindo o convite…</div>`; return; }
  const aviso = {
    invalido: "Este link não existe mais. Ele pode ter sido cancelado ou substituído por um novo. Peça um link novo ao administrador do time.",
    usado: "Este link já foi usado. Se foi você, é só entrar no app normalmente. Se não foi, avise o administrador do time.",
    expirado: "Este link expirou. Peça um link novo ao administrador do time.",
    erro: "Não foi possível conferir o convite agora. Tente de novo em instantes.",
  }[lido.estado];
  if (aviso){
    cartao(root, "Convite indisponível", `<p>${aviso}</p>`,
      `<div style="margin-top:12px;"><a class="btn btn-ghost btn-sm" href="#dashboard">Ir para o início</a></div>`);
    return;
  }

  const atleta = state.atletas.find(a => a.id === lido.convite.atletaId);
  if (!atleta){
    cartao(root, "Convite indisponível", `<p>O atleta deste convite não foi encontrado. Peça um link novo ao administrador.</p>`);
    return;
  }
  const exp = lido.convite.expiraEm?.toDate ? lido.convite.expiraEm.toDate() : new Date(lido.convite.expiraEm);
  cartao(root, `Olá, ${escapeHtml(atleta.nome)}!`,
    `<p>Este convite é para você acessar o <strong>${escapeHtml(TEAM.nome)}</strong> como <strong>${escapeHtml(atleta.nome)}</strong>.</p>
     <p class="field-hint">Você entrou com <strong>${escapeHtml(user.email || "")}</strong>. Depois de confirmar, essa conta fica ligada ao seu cadastro, e você poderá editar seus dados, confirmar presença nos jogos e ver o seu extrato.${state.isAuthorized ? " Como você também é da equipe, continua com o acesso de administrador e ganha o item “Meu espaço” no menu." : ""}</p>
     <button id="cv-confirmar" class="btn btn-primary">Sou eu, confirmar acesso</button>
     <p class="field-hint" style="margin-top:12px;">Não é você? Feche esta página e avise o administrador. O link vale uma vez e expira em ${escapeHtml(formatDate(dataISOLocal(exp)))}.</p>`);
  $("#cv-confirmar", root)?.addEventListener("click", async (e) => {
    if (confirmando) return;
    confirmando = true; e.target.disabled = true;
    try{
      await vincularConvite(token, atleta.id);
      toast("Acesso liberado!", "ok");
      lido = { token: null, estado: "nada", convite: null };
      await aposVincular();
    }catch(err){
      console.error(err);
      toast("Não foi possível confirmar: " + (err.message || "erro"), "err");
      e.target.disabled = false;
    }
    confirmando = false;
  });
}
