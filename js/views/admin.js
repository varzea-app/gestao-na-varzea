import { $, $$, escapeHtml, toast, formatDate, dataISOLocal, openModal, closeModal } from "../utils.js";
import { listarTimes, atualizarPlanoDoTime, definirAutoCadastro, irParaTime, excluirTime } from "../tenant.js";
import { gerarBackup, baixarJson } from "../backup.js";
import { plataformaAberta } from "../tenant.js";
import { PLANOS, diasAte } from "../planos.js";
import { formCriarTimeHtml, ligarFormCriarTime } from "./landing.js";

// ============================================================================
// Painel do dono da plataforma (#admin): todos os times, plano e validade,
// criação de time e abertura do auto-cadastro. Só aparece para SUPER_ADMINS.
// ============================================================================

const SEM_VENCIMENTO = new Date("2100-01-01T12:00:00");
const isoData = (d) => dataISOLocal(d);

function situacao(t){
  if (!t.validoAte) return { txt: "sem data", cls: "venc-ok" };
  const dias = diasAte(t.validoAte);
  if (dias > 3000) return { txt: "sem vencimento", cls: "venc-ok" };
  if (dias < 0) return { txt: `vencido há ${-dias} dia${dias === -1 ? "" : "s"}`, cls: "venc-erro" };
  if (dias === 0) return { txt: "vence hoje", cls: "venc-erro" };
  return { txt: `vence em ${dias} dia${dias === 1 ? "" : "s"}`, cls: dias <= 7 ? "venc-aviso" : "venc-ok" };
}

function textoCobranca(t){
  const dataFim = t.validoAte ? formatDate(isoData(t.validoAte)) : "";
  const venceu = t.validoAte && t.validoAte.getTime() < Date.now();
  const link = `${location.origin}${location.pathname}?time=${encodeURIComponent(t.id)}`;
  return `Olá! O plano ${(PLANOS[t.plano] || PLANOS.start).nome} do time ${t.nome} ${venceu ? "venceu" : "vence"} em ${dataFim}. `
    + `Para ${venceu ? "voltar a cadastrar" : "continuar cadastrando sem interrupção"}, é só renovar por Pix e me avisar que eu libero na hora. `
    + `Link do time: ${link}`;
}

export async function renderAdmin(root, state){
  const user = state.usuario;
  root.innerHTML = `
    <div class="topbar"><div><div class="eyebrow">Dono da plataforma</div><h1>Painel</h1></div></div>
    <div class="card card-pad">
      <div class="card-title">Criar time</div>
      <div class="card-sub">Cria o time, o primeiro administrador e o período de teste. Depois use "Abrir" e, em Configurações, "Preencher com dados de exemplo" para montar uma demonstração.</div>
      ${formCriarTimeHtml({ ehSuper: true, email: user?.email })}
    </div>
    <div class="card card-pad">
      <div class="card-title">Times</div>
      <div class="card-sub">Mude o plano e a validade de cada time. Um time com plano vencido fica só em consulta.</div>
      <div id="admin-times">Carregando…</div>
    </div>
    <div class="card card-pad">
      <div class="card-title">Auto-cadastro</div>
      <div class="card-sub">Fechado: só você cria times. Aberto: qualquer pessoa com conta Google pode criar um time com teste grátis.</div>
      <label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="admin-aberto"> Permitir que dirigentes criem o próprio time</label>
    </div>`;

  ligarFormCriarTime(root, { ehSuper: true, aoCriar: (id) => irParaTime(id, "#configuracoes") });

  plataformaAberta().then(v => { const c = $("#admin-aberto", root); if (c) c.checked = v; });
  $("#admin-aberto", root).addEventListener("change", async (e) => {
    try{ await definirAutoCadastro(e.target.checked); toast(e.target.checked ? "Auto-cadastro aberto." : "Auto-cadastro fechado.", "ok"); }
    catch(err){ toast("Erro: " + err.message, "err"); e.target.checked = !e.target.checked; }
  });

  let times = [];
  try{ times = (await listarTimes()).sort((a, b) => (a.validoAte?.getTime() ?? Infinity) - (b.validoAte?.getTime() ?? Infinity)); }
  catch(err){ $("#admin-times", root).textContent = "Não foi possível listar os times: " + err.message; return; }

  const opcoes = (atual) => Object.entries(PLANOS).map(([k, p]) => `<option value="${k}" ${k === atual ? "selected" : ""}>${escapeHtml(p.nome)}</option>`).join("");
  $("#admin-times", root).innerHTML = times.length ? `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Time</th><th>Plano</th><th>Vale até</th><th>Situação</th><th></th></tr></thead>
      <tbody>${times.map(t => `
        <tr data-id="${escapeHtml(t.id)}">
          <td><strong>${escapeHtml(t.nome)}</strong><div class="card-sub" style="margin:0;">${escapeHtml(t.id)}${t.donoEmail ? ` · ${escapeHtml(t.donoEmail)}` : ""}</div></td>
          <td><select data-plano>${opcoes(t.plano)}</select></td>
          <td><input type="date" data-validade value="${t.validoAte ? isoData(t.validoAte) : ""}"></td>
          <td data-situacao class="${situacao(t).cls}" style="white-space:nowrap;">${situacao(t).txt}</td>
          <td style="white-space:nowrap;">
            <button class="btn btn-ghost btn-sm" data-mais30>+30 dias</button>
            <button class="btn btn-ghost btn-sm" data-sem-venc>Sem vencimento</button>
            <button class="btn btn-primary btn-sm" data-salvar>Salvar</button>
            <button class="btn btn-ghost btn-sm" data-cobrar>Lembrar no WhatsApp</button>
            <button class="btn btn-gold btn-sm" data-abrir>Abrir</button>
            <button class="btn btn-danger btn-sm" data-excluir>Excluir</button>
          </td>
        </tr>`).join("")}</tbody>
    </table></div>` : `<div class="card-sub">Nenhum time ainda.</div>`;

  $$("#admin-times tr[data-id]", root).forEach(tr => {
    const id = tr.dataset.id;
    const campoData = $("[data-validade]", tr);
    $("[data-mais30]", tr).addEventListener("click", () => {
      const base = campoData.value ? new Date(campoData.value + "T12:00:00") : new Date();
      const inicio = base.getTime() > Date.now() ? base : new Date();
      inicio.setDate(inicio.getDate() + 30);
      campoData.value = isoData(inicio);
    });
    $("[data-sem-venc]", tr).addEventListener("click", () => { campoData.value = isoData(SEM_VENCIMENTO); });
    $("[data-abrir]", tr).addEventListener("click", () => irParaTime(id));
    $("[data-excluir]", tr).addEventListener("click", () => abrirExclusao(root, state, times.find(x => x.id === id), () => renderAdmin(root, state)));
    $("[data-cobrar]", tr).addEventListener("click", () => {
      const t = times.find(x => x.id === id);
      window.open(`https://wa.me/?text=${encodeURIComponent(textoCobranca(t))}`, "_blank", "noopener");
    });
    $("[data-salvar]", tr).addEventListener("click", async (e) => {
      if (!campoData.value) return toast("Escolha a data de validade.", "err");
      e.target.disabled = true;
      try{
        await atualizarPlanoDoTime(id, { plano: $("[data-plano]", tr).value, validoAte: new Date(campoData.value + "T23:59:00") });
        const t = times.find(x => x.id === id);
        t.plano = $("[data-plano]", tr).value; t.validoAte = new Date(campoData.value + "T23:59:00");
        const sit = situacao(t); const cel = $("[data-situacao]", tr);
        cel.textContent = sit.txt; cel.className = sit.cls;
        toast(`Plano de ${id} atualizado.`, "ok");
      }catch(err){ console.error(err); toast("Erro: " + err.message, "err"); }
      e.target.disabled = false;
    });
  });
}


// ----------------------------------------------------------------------------
// Excluir time: apaga todos os dados, a equipe e o próprio time. Para não
// apagar por engano, é preciso digitar o código do time.
// ----------------------------------------------------------------------------
function abrirExclusao(root, state, time, aoTerminar){
  openModal(`
    <div class="modal-head"><h3>Excluir time</h3><button class="modal-close" id="exc-fechar">&times;</button></div>
    <div class="modal-body">
      <p style="font-size:13.5px; margin:0 0 8px;">Você vai apagar <strong>${escapeHtml(time.nome)}</strong> (<code>${escapeHtml(time.id)}</code>) e <strong>todos os dados dele</strong>: atletas, jogos, financeiro, presenças, configurações e a lista da equipe. <strong>Não dá para desfazer.</strong></p>
      <label style="display:flex; align-items:center; gap:8px; font-size:13.5px; margin:10px 0;"><input type="checkbox" id="exc-backup" checked> Baixar um backup (arquivo .json) antes de excluir</label>
      <label style="font-size:13px; color:var(--ink-soft);">Para confirmar, digite o código do time:</label>
      <input type="text" id="exc-codigo" autocomplete="off" placeholder="${escapeHtml(time.id)}" style="width:100%; margin-top:4px;">
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="exc-cancelar">Cancelar</button>
        <button type="button" class="btn btn-danger" id="exc-confirmar" disabled>Excluir definitivamente</button>
      </div>
      <div class="card-sub" id="exc-status" style="margin-top:8px;"></div>
    </div>`);
  const campo = $("#exc-codigo"), botao = $("#exc-confirmar"), status = $("#exc-status");
  campo.addEventListener("input", () => { botao.disabled = campo.value.trim().toLowerCase() !== time.id; });
  $("#exc-fechar").addEventListener("click", closeModal);
  $("#exc-cancelar").addEventListener("click", closeModal);
  botao.addEventListener("click", async () => {
    if (campo.value.trim().toLowerCase() !== time.id) return;
    botao.disabled = true; $("#exc-cancelar").disabled = true; campo.disabled = true;
    try{
      if ($("#exc-backup").checked){
        status.textContent = "Gerando o backup…";
        const { backup, falhas } = await gerarBackup(time.id);
        if (falhas.length) throw new Error("Não consegui ler tudo para o backup (" + falhas.join(", ") + "). Nada foi apagado.");
        baixarJson(backup, `backup-${time.id}-${dataISOLocal()}.json`);
      }
      status.textContent = "Apagando os dados do time…";
      const total = await excluirTime(time.id);
      closeModal();
      toast(`Time ${time.id} excluído (${total} registros apagados).`, "ok");
      aoTerminar();
    }catch(err){
      console.error(err);
      status.textContent = "Erro: " + err.message + " — se algo ficou pela metade, é só tentar excluir de novo.";
      botao.disabled = false; $("#exc-cancelar").disabled = false; campo.disabled = false;
    }
  });
}
