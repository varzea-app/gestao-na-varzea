import { TEAM } from "../tenant.js";
import { $, $$, escapeHtml, toast, formatDate, formatDateLong, todayISO } from "../utils.js";
import {
  saveDoc, setPrivateDoc, getPrivateDoc, lerDocumento, setPresenca,
  listenPresencasDoAtleta, listenFinanceiroDoAtleta,
} from "../db.js";
import { categoriasAtleta } from "../modalidade.js";
import { temRecurso } from "../planos.js";
import { extratoJogadorDados, mesLabel, fmtBRL, linhaPix } from "./financeiro.js";

// ============================================================================
// Meu espaço — a área do jogador que entrou com o link individual.
// Ele só enxerga e edita o que é dele: o próprio cadastro, a própria resposta
// de presença nos próximos jogos e o próprio extrato de mensalidades.
// ============================================================================

const RESPOSTAS = [
  { key: "vou", label: "Vou", icon: "✅" },
  { key: "talvez", label: "Talvez", icon: "🤔" },
  { key: "nao", label: "Não vou", icon: "❌" },
];

// Escutas abertas e dados que chegam do banco (a tela é redesenhada aos poucos,
// sem apagar o que a pessoa está digitando no cadastro).
let ctx = null;

function pararTudo(){
  if (!ctx) return;
  ctx.unsubs.forEach(f => { try{ f(); }catch(err){ /* ok */ } });
  ctx = null;
}

const aindaNaTela = () => location.hash.startsWith("#meu-espaco");

export function renderMeuEspaco(root, state){
  const atletaId = state.vinculo?.atletaId;
  const atleta = state.atletas.find(a => a.id === atletaId);
  if (!atleta){
    pararTudo();
    root.innerHTML = `<div class="empty-state"><h3>Cadastro não encontrado</h3><p>O atleta ligado a esta conta não existe mais. Fale com o administrador do time.</p></div>`;
    return;
  }

  if (!ctx || ctx.atletaId !== atletaId){
    pararTudo();
    ctx = { atletaId, unsubs: [], presencas: [], financeiro: [], config: null, financeiroErro: false, presencaErro: false, root, state };
    ctx.unsubs.push(listenPresencasDoAtleta(atletaId, (items, err) => {
      if (!ctx || ctx.atletaId !== atletaId) return;
      if (!aindaNaTela()) { pararTudo(); return; }
      ctx.presencas = items; ctx.presencaErro = !!err;
      atualizarPresencas();
    }));
    if (temRecurso("financeiro")){
      ctx.unsubs.push(listenFinanceiroDoAtleta(atletaId, (items, err) => {
        if (!ctx || ctx.atletaId !== atletaId) return;
        if (!aindaNaTela()) { pararTudo(); return; }
        ctx.financeiro = items; ctx.financeiroErro = !!err;
        atualizarFinanceiro();
      }));
      lerDocumento("configuracoes", "geral").then(c => { if (ctx && ctx.atletaId === atletaId){ ctx.config = c; atualizarFinanceiro(); } }).catch(() => {});
    }
  }
  ctx.root = root; ctx.state = state;

  // Esqueleto: só monta uma vez; depois só as partes dinâmicas são atualizadas.
  if (root.dataset.meuEspaco !== atletaId || !$("#me-raiz", root)){
    root.dataset.meuEspaco = atletaId;
    root.innerHTML = esqueleto(atleta);
    ligarCadastro(atleta);
    carregarPrivado(atleta);
  }
  $("#me-nome").textContent = atleta.nome;
  atualizarPresencas();
  atualizarFinanceiro();
}

// ----------------------------------------------------------------------------

function esqueleto(atleta){
  return `
  <div id="me-raiz">
    <div class="topbar">
      <div>
        <div class="eyebrow">${TEAM.nomeHtml}</div>
        <h1>Olá, <span id="me-nome"></span></h1>
        <div style="font-size:13px; color:var(--ink-soft); margin-top:4px;">Aqui você confirma presença, atualiza seus dados e acompanha o seu extrato.</div>
      </div>
    </div>

    ${temRecurso("presenca") ? `
    <section class="card card-pad" style="margin-bottom:16px;">
      <h2 class="card-title">Próximos jogos</h2>
      <div class="card-sub">Sua confirmação de presença. Você pode mudar de ideia quando quiser.</div>
      <div id="me-presencas"></div>
    </section>` : ""}

    <section class="card card-pad" style="margin-bottom:16px;">
      <h2 class="card-title">Meu cadastro</h2>
      <div class="card-sub">Seus dados. CPF e nascimento são opcionais e ficam visíveis só para você e para a diretoria do time.</div>
      <form id="me-form">
        <div class="form-grid">
          <div class="field span-2"><label>Nome *</label><input type="text" name="nome" required maxlength="40" value="${escapeHtml(atleta.nome || "")}"></div>
          <div class="field span-2"><label>Nome completo</label><input type="text" name="nomeCompleto" maxlength="80" value="${escapeHtml(atleta.nomeCompleto || "")}"></div>
          <div class="field"><label>Posição / categoria</label>
            <select name="posicao"><option value="">Selecione</option>${categoriasAtleta().map(p => `<option value="${escapeHtml(p)}" ${atleta.posicao === p ? "selected" : ""}>${escapeHtml(p)}</option>`).join("")}</select></div>
          <div class="field"><label>Número da camisa</label><input type="number" name="numero" min="0" max="999" value="${atleta.numero ?? ""}"></div>
          <div class="field"><label>Telefone</label><input type="text" name="telefone" placeholder="(00) 00000-0000" disabled></div>
          <div class="field"><label>CPF (opcional)</label><input type="text" name="cpf" placeholder="000.000.000-00" disabled></div>
          <div class="field"><label>Data de nascimento (opcional)</label><input type="date" name="dataNascimento" disabled></div>
        </div>
        <div class="form-actions"><button type="submit" class="btn btn-primary" id="me-salvar">Salvar meus dados</button></div>
      </form>
    </section>

    ${temRecurso("financeiro") ? `
    <section class="card card-pad" id="me-fin-secao" style="margin-bottom:16px; display:none;">
      <h2 class="card-title">Meu extrato financeiro</h2>
      <div id="me-financeiro"></div>
    </section>` : ""}

    <p class="field-hint" style="text-align:center;">Para ver as estatísticas do time, use o menu: <a href="#ranking">Ranking</a> · <a href="#historico">Histórico</a> · <a href="#extrato/${atleta.id}">Meu extrato esportivo</a></p>
  </div>`;
}

async function carregarPrivado(atleta){
  const form = $("#me-form");
  try{
    const priv = await getPrivateDoc("atletas_privado", atleta.id);
    if (!form || !ctx) return;
    ["telefone", "cpf", "dataNascimento"].forEach(k => { if (form.elements[k]) form.elements[k].value = priv[k] || ""; });
  }catch(err){
    console.error(err);
    toast("Não foi possível carregar telefone, CPF e nascimento agora.", "err");
  }
  ["telefone", "cpf", "dataNascimento"].forEach(k => { if (form?.elements[k]) form.elements[k].disabled = false; });
}

function ligarCadastro(atleta){
  $("#me-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const nome = f.nome.value.trim();
    if (!nome){ toast("Informe o seu nome.", "err"); return; }
    const btn = $("#me-salvar");
    btn.disabled = true;
    try{
      await saveDoc("atletas", atleta.id, {
        nome,
        nomeCompleto: f.nomeCompleto.value.trim(),
        posicao: f.posicao.value || "",
        numero: f.numero.value === "" ? null : Number(f.numero.value),
      });
      // Os campos privados só são gravados depois de carregados (sem apagar nada por engano).
      if (!f.telefone.disabled){
        await setPrivateDoc("atletas_privado", atleta.id, {
          telefone: f.telefone.value.trim(),
          cpf: f.cpf.value.trim(),
          dataNascimento: f.dataNascimento.value || "",
        });
      }
      toast("Dados salvos.", "ok");
    }catch(err){
      console.error(err);
      toast("Não foi possível salvar: " + (err.message || "erro"), "err");
    }
    btn.disabled = false;
  });
}

// ----------------------------------------------------------------------------
// Presença: só a resposta do próprio jogador, jogo a jogo.
// ----------------------------------------------------------------------------

function atualizarPresencas(){
  const box = $("#me-presencas");
  if (!box || !ctx) return;
  const { state, presencas } = ctx;
  const hoje = todayISO();
  const jogos = state.jogos
    .filter(j => j.status !== "realizado" && (j.data || "") >= hoje)
    .sort((a, b) => (a.data || "").localeCompare(b.data || ""))
    .slice(0, 6);
  const respostaDe = new Map(presencas.map(p => [p.jogoId, p.resposta]));
  if (ctx.presencaErro){ box.innerHTML = `<p class="field-hint">Não foi possível carregar suas confirmações agora.</p>`; return; }
  if (!jogos.length){ box.innerHTML = `<p class="field-hint">Nenhum jogo marcado por enquanto.</p>`; return; }
  box.innerHTML = jogos.map(j => {
    const adv = state.adversarios.find(a => a.id === j.adversarioId)?.nome || "Adversário";
    const campo = state.campos.find(c => c.id === j.campoId)?.nome || "";
    const atual = respostaDe.get(j.id);
    return `
      <div class="me-jogo">
        <div>
          <strong>${TEAM.nomeHtml} vs ${escapeHtml(adv)}</strong>
          <div class="me-jogo-sub">🗓️ ${escapeHtml(formatDateLong(j.data))}${j.horario ? ` · ⏰ ${escapeHtml(j.horario)}` : ""}${campo ? ` · 📍 ${escapeHtml(campo)}` : ""}</div>
        </div>
        <div class="me-jogo-botoes">${RESPOSTAS.map(r => `<button type="button" class="btn btn-sm ${atual === r.key ? "btn-primary" : "btn-ghost"}" data-jogo="${j.id}" data-resp="${r.key}">${r.icon} ${r.label}</button>`).join("")}</div>
      </div>`;
  }).join("");
  $$("[data-resp]", box).forEach(b => b.addEventListener("click", async () => {
    b.disabled = true;
    try{
      await setPresenca(b.dataset.jogo, ctx.atletaId, b.dataset.resp);
      toast("Presença registrada.", "ok");
    }catch(err){
      console.error(err);
      toast("Não foi possível registrar: " + (err.message || "erro"), "err");
      b.disabled = false;
    }
  }));
}

// ----------------------------------------------------------------------------
// Financeiro: o extrato de mensalidades do próprio jogador.
// ----------------------------------------------------------------------------

function atualizarFinanceiro(){
  const box = $("#me-financeiro");
  if (!box || !ctx) return;
  if (ctx.financeiroErro){ box.innerHTML = `<p class="field-hint">Não foi possível carregar o seu extrato agora.</p>`; return; }
  const atleta = ctx.state.atletas.find(a => a.id === ctx.atletaId);
  if (!atleta) return;
  const d = extratoJogadorDados({ configFinanceiro: ctx.config, financeiro: ctx.financeiro }, atleta);
  // Quem não paga mensalidade e nunca pagou não tem o que ver aqui: a seção fica escondida.
  const secao = $("#me-fin-secao");
  if (secao) secao.style.display = (atleta.pagante || d.linhas.length) ? "" : "none";
  const rows = [...d.linhas].reverse().map(l => `
    <tr>
      <td>${mesLabel(l.mes)}</td>
      <td><span class="badge ${l.status === "pago" ? "badge-ok" : l.status === "isento" ? "badge-off" : "badge-danger"}">${l.status === "pago" ? "Pago" : l.status === "isento" ? "Isento" : "Pendente"}</span></td>
      <td>${l.status === "pago" ? formatDate(l.data) : "—"}</td>
      <td style="font-family:var(--font-mono); font-weight:700;">${l.status === "isento" ? "—" : fmtBRL(l.valor)}</td>
    </tr>`).join("");
  const pix = linhaPix({ configFinanceiro: ctx.config });
  box.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:12px;">
      <div class="kpi-tile"><div class="kpi-label">Pago</div><div class="kpi-value" style="font-size:22px;">${fmtBRL(d.totalPago)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Pendente</div><div class="kpi-value" style="font-size:22px; color:${d.totalPend ? "var(--danger)" : "inherit"};">${fmtBRL(d.totalPend)}</div></div>
    </div>
    ${pix && d.totalPend ? `<p class="field-hint">${escapeHtml(pix)}</p>` : ""}
    ${atleta.pagante ? "" : `<p class="field-hint">Você não está marcado como pagante — só aparecem os meses que você já pagou.</p>`}
    <div class="table-wrap"><table>
      <thead><tr><th>Mês</th><th>Situação</th><th>Pago em</th><th>Valor</th></tr></thead>
      <tbody>${rows || `<tr class="empty-row"><td colspan="4">Sem mensalidades no período.</td></tr>`}</tbody>
    </table></div>`;
}
