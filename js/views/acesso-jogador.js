import { $, escapeHtml, toast, formatDate, confirmAction, dataISOLocal } from "../utils.js";
import { TEAM, linkDoTime } from "../tenant.js";
import { criarConvite, cancelarConvites, desvincularJogador } from "../db.js";

// ============================================================================
// Acesso do jogador ao app — parte da equipe (dentro do cadastro do atleta).
// A equipe gera um link individual por atleta, manda para ele, e quando ele
// entra com o Google o atleta fica ligado àquela conta. A qualquer momento a
// equipe pode desvincular e mandar um link novo.
// ============================================================================

function paraData(v){
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  return v instanceof Date ? v : new Date(v);
}

const fmtData = (d) => d ? formatDate(dataISOLocal(d)) : "";

export function linkDoConvite(token){
  return linkDoTime(`#convite/${token}`);
}

function textoWhats(atleta, link){
  return `Oi, ${atleta.nome}! Acesse o app do ${TEAM.nome} com a sua conta Google para confirmar presença, editar seu cadastro e ver seu extrato. Esse link é só seu e vale uma vez:\n${link}`;
}

// Situação do atleta, a partir do que a equipe já carregou.
function situacao(state, atletaId){
  const vinc = (state.vinculos || []).find(v => v.atletaId === atletaId) || null;
  const convs = (state.convites || []).filter(c => c.atletaId === atletaId);
  return { vinc, convs };
}

function corpoHtml(atleta, loc){
  const { vinc, convs } = loc;
  const pend = convs.find(c => !c.usado) || null;
  const exp = pend ? paraData(pend.expiraEm) : null;
  const vencido = !!(exp && exp.getTime() < Date.now());
  if (vinc){
    return `
      <div class="acesso-linha"><span class="badge badge-ok">Acesso ativo</span> <span class="acesso-email">${escapeHtml(vinc.email || "")}</span></div>
      <p class="field-hint">Esse atleta entra no app com essa conta Google. Se o acesso for de outra pessoa ou o celular foi perdido, desvincule e mande um link novo.</p>
      <div class="acesso-botoes"><button type="button" class="btn btn-ghost btn-sm" id="ac-desvincular">Desvincular conta</button></div>`;
  }
  if (pend && !vencido){
    return `
      <div class="acesso-linha"><span class="badge badge-off">Link gerado</span> <span class="acesso-email">vale até ${escapeHtml(fmtData(exp))} · uso único</span></div>
      <div class="acesso-botoes">
        <button type="button" class="btn btn-primary btn-sm" id="ac-copiar">Copiar link</button>
        <button type="button" class="btn btn-ghost btn-sm" id="ac-whats">Enviar no WhatsApp</button>
        <button type="button" class="btn btn-ghost btn-sm" id="ac-novo">Gerar novo link</button>
        <button type="button" class="btn btn-ghost btn-sm" id="ac-cancelar">Cancelar link</button>
      </div>`;
  }
  return `
    ${pend && vencido ? `<p class="field-hint">O último link expirou em ${escapeHtml(fmtData(exp))}.</p>` : `<p class="field-hint">Sem acesso ao app. Gere um link individual e mande para ${escapeHtml(atleta.nome)}.</p>`}
    <div class="acesso-botoes"><button type="button" class="btn btn-primary btn-sm" id="ac-gerar">Gerar link de acesso</button></div>`;
}

// HTML da seção (vai dentro do formulário do atleta, já existente).
export function acessoJogadorHtml(state, atleta){
  if (state.acessosIndisponivel){
    return `<div class="acesso-jogador" id="acesso-jogador">
      <h4>Acesso do jogador ao app</h4>
      <p class="field-hint">Indisponível agora: as novas regras do Firestore ainda não foram publicadas no console do Firebase.</p>
    </div>`;
  }
  return `<div class="acesso-jogador" id="acesso-jogador">
    <h4>Acesso do jogador ao app</h4>
    <div id="acesso-corpo">${corpoHtml(atleta, situacao(state, atleta.id))}</div>
  </div>`;
}

// Liga os botões da seção. `loc` guarda a situação local, para a tela
// refletir na hora o que acabou de acontecer (antes do banco confirmar).
export function ligarAcessoJogador(state, atleta){
  if (state.acessosIndisponivel) return;
  const corpo = $("#acesso-corpo");
  if (!corpo) return;
  const loc = situacao(state, atleta.id);
  loc.convs = [...loc.convs];

  const redesenhar = () => { corpo.innerHTML = corpoHtml(atleta, loc); ligar(); };
  const tokensAtuais = () => loc.convs.map(c => c.id);
  const pendente = () => loc.convs.find(c => !c.usado) || null;

  const gerar = async () => {
    try{
      const token = await criarConvite(atleta.id, tokensAtuais());
      loc.convs = [{ id: token, atletaId: atleta.id, usado: false, expiraEm: new Date(Date.now() + 7 * 86400000) }];
      redesenhar();
      try{ await navigator.clipboard.writeText(linkDoConvite(token)); toast("Link gerado e copiado! Cole no WhatsApp.", "ok"); }
      catch(err){ toast("Link gerado. Toque em Copiar link.", "ok"); }
    }catch(err){
      console.error(err);
      toast("Não foi possível gerar o link: " + err.message, "err");
    }
  };

  function ligar(){
    $("#ac-gerar")?.addEventListener("click", gerar);
    $("#ac-novo")?.addEventListener("click", async () => {
      if (!(await confirmAction("Gerar um novo link? O link anterior deixa de funcionar.", { confirmLabel: "Gerar novo", title: "Novo link" }))) return;
      gerar();
    });
    $("#ac-copiar")?.addEventListener("click", async () => {
      const p = pendente(); if (!p) return;
      try{ await navigator.clipboard.writeText(linkDoConvite(p.id)); toast("Link copiado!", "ok"); }
      catch(err){ toast("Não foi possível copiar automaticamente.", "err"); }
    });
    $("#ac-whats")?.addEventListener("click", () => {
      const p = pendente(); if (!p) return;
      window.open(`https://wa.me/?text=${encodeURIComponent(textoWhats(atleta, linkDoConvite(p.id)))}`, "_blank", "noopener");
    });
    $("#ac-cancelar")?.addEventListener("click", async () => {
      try{
        await cancelarConvites(tokensAtuais());
        loc.convs = [];
        redesenhar();
        toast("Link cancelado.", "ok");
      }catch(err){ toast("Erro: " + err.message, "err"); }
    });
    $("#ac-desvincular")?.addEventListener("click", async () => {
      if (!(await confirmAction(`Desvincular a conta ${loc.vinc?.email || ""} de ${atleta.nome}? Ela perde o acesso na hora. Depois você pode gerar um link novo.`, { confirmLabel: "Desvincular", title: "Desvincular conta" }))) return;
      try{
        await desvincularJogador(loc.vinc.id, tokensAtuais());
        loc.vinc = null; loc.convs = [];
        redesenhar();
        toast("Conta desvinculada.", "ok");
      }catch(err){ toast("Erro: " + err.message, "err"); }
    });
  }
  ligar();
}
