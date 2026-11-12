import { $, $$, escapeHtml, toast, formatDate } from "../utils.js";
import { listarTimes, atualizarPlanoDoTime, definirAutoCadastro, irParaTime } from "../tenant.js";
import { plataformaAberta } from "../tenant.js";
import { PLANOS, diasAte } from "../planos.js";
import { formCriarTimeHtml, ligarFormCriarTime } from "./landing.js";

// ============================================================================
// Painel do dono da plataforma (#admin): todos os times, plano e validade,
// criação de time e abertura do auto-cadastro. Só aparece para SUPER_ADMINS.
// ============================================================================

const SEM_VENCIMENTO = new Date("2100-01-01T12:00:00");
const isoData = (d) => d.toISOString().slice(0, 10);

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
