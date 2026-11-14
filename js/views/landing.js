import { $, $$, escapeHtml, toast } from "../utils.js";
import { getDoc, doc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db, loginWithGoogle, logout, emailNormalizado } from "../auth.js";
import { APP_NOME, CONTATO_WHATSAPP } from "../firebase-config.js";
import { irParaTime, idValido, slugify, criarTime, meusTimes, plataformaAberta } from "../tenant.js";

// ============================================================================
// Tela inicial (quando não há um time aberto): entrar num time existente,
// ver "meus times" e criar um time novo (só o dono da plataforma, ou qualquer
// pessoa se o auto-cadastro estiver aberto no painel #admin).
// ============================================================================

async function timeExiste(id){
  try{ return (await getDoc(doc(db, "times", id))).exists(); }
  catch(err){ return false; }
}

export function formCriarTimeHtml({ ehSuper, email }){
  return `
    <form id="form-criar-time" class="form-grid" autocomplete="off">
      <div class="field span-2"><label>Nome do time *</label><input type="text" name="nome" required maxlength="40" placeholder="Ex.: Unidos do Bairro"></div>
      <div class="field"><label>Código do time (vira o endereço) *</label><input type="text" name="id" required maxlength="40" placeholder="unidos-do-bairro"></div>
      <div class="field"><label>Sigla (até 3 letras)</label><input type="text" name="sigla" maxlength="3" placeholder="UDB"></div>
      <div class="field span-2"><label>Modalidade *</label>
        <select name="modalidade">
          <option value="campo">Campo — 11 jogadores</option>
          <option value="society">Society — 7 jogadores</option>
          <option value="futsal">Futsal — 5 jogadores</option>
        </select></div>
      <div class="field span-2"><label>E-mail Google de quem vai administrar${ehSuper ? "" : " (o seu)"} *</label>
        <input type="email" name="dono" required value="${escapeHtml(email || "")}" ${ehSuper ? "" : "readonly"}></div>
      <div class="form-actions span-2"><button type="submit" class="btn btn-primary">Criar time</button></div>
    </form>`;
}

export function ligarFormCriarTime(root, { ehSuper, planoInicial = "teste", aoCriar }){
  const form = $("#form-criar-time", root);
  if (!form) return;
  const campoNome = form.elements["nome"], campoId = form.elements["id"], campoSigla = form.elements["sigla"];
  let idEditado = false, siglaEditada = false;
  campoId.addEventListener("input", () => { idEditado = true; });
  campoSigla.addEventListener("input", () => { siglaEditada = true; });
  campoNome.addEventListener("input", () => {
    if (!idEditado) campoId.value = slugify(campoNome.value);
    if (!siglaEditada) campoSigla.value = campoNome.value.split(/\s+/).filter(Boolean).map(p => p[0]).join("").slice(0, 3).toUpperCase();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = campoNome.value.trim();
    const id = slugify(campoId.value);
    const dono = emailNormalizado(form.elements["dono"].value);
    if (!nome) return toast("Informe o nome do time.", "err");
    if (!idValido(id)) return toast("O código precisa ter de 3 a 40 letras, números ou hífens.", "err");
    if (!dono.includes("@")) return toast("Informe um e-mail válido.", "err");
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try{
      if (await timeExiste(id)){ toast("Esse código já está em uso. Escolha outro.", "err"); btn.disabled = false; return; }
      await criarTime({ id, nome, sigla: campoSigla.value, donoEmail: dono, plano: planoInicial, modalidade: form.elements["modalidade"].value });
      toast("Time criado!", "ok");
      aoCriar(id);
    }catch(err){
      console.error(err);
      toast("Não foi possível criar o time: " + (err.code === "permission-denied" ? "sem permissão (a criação de times está fechada)." : err.message), "err");
      btn.disabled = false;
    }
  });
}

export function renderLanding(root, ctx){
  const { user, ehSuper, aviso } = ctx;
  const contato = CONTATO_WHATSAPP
    ? `<a class="btn btn-gold" href="https://wa.me/${CONTATO_WHATSAPP}?text=${encodeURIComponent("Olá! Quero usar o app " + APP_NOME + " no meu time.")}" target="_blank" rel="noopener">Falar no WhatsApp</a>`
    : "";

  root.innerHTML = `
    <div class="landing">
      <div class="landing-hero">
        <div class="eyebrow">Futebol de várzea</div>
        <h1>${escapeHtml(APP_NOME)}</h1>
        <p>Elenco, jogos, escalação, ranking e financeiro do seu time num link só.</p>
        ${aviso ? `<div class="landing-aviso">${escapeHtml(aviso)}</div>` : ""}
      </div>

      <div class="card card-pad">
        <div class="card-title">Já tenho um time</div>
        <div class="card-sub">Digite o código do seu time (o que vem depois de <code>?time=</code> no link).</div>
        <form id="form-entrar-time" class="landing-linha">
          <input type="text" id="codigo-time" placeholder="codigo-do-time" autocomplete="off" aria-label="Código do time">
          <button type="submit" class="btn btn-primary">Entrar</button>
        </form>
      </div>

      <div class="card card-pad" id="landing-conta"></div>
      <div class="card card-pad" id="landing-criar" style="display:none;"></div>
      ${contato ? `<div class="landing-contato"><span>Quer o app no seu time?</span> ${contato}</div>` : ""}
      <p style="text-align:center; font-size:12px; opacity:.75;"><a href="#privacidade">Política de Privacidade</a> · <a href="#termos">Termos de Uso</a></p>
    </div>`;

  $("#form-entrar-time", root).addEventListener("submit", (e) => {
    e.preventDefault();
    const id = slugify($("#codigo-time", root).value);
    if (!idValido(id)) return toast("Código inválido.", "err");
    irParaTime(id);
  });

  const conta = $("#landing-conta", root);
  if (!user){
    conta.innerHTML = `
      <div class="card-title">Sou dirigente</div>
      <div class="card-sub">Entre com sua conta Google para ver seus times ou criar um novo.</div>
      <button class="btn btn-gold" id="landing-login">Entrar com Google</button>`;
    $("#landing-login", root).addEventListener("click", async () => {
      try{ await loginWithGoogle(); }catch(err){ toast("Não foi possível entrar. Tente novamente.", "err"); }
    });
  } else {
    conta.innerHTML = `
      <div class="card-title">Olá, ${escapeHtml(user.displayName || user.email)}</div>
      <div class="card-sub" id="meus-times-sub">Procurando seus times…</div>
      <div id="meus-times"></div>
      <div class="form-actions" style="justify-content:flex-start; flex-wrap:wrap; gap:8px;">
        ${ehSuper ? `<a class="btn btn-ghost btn-sm" href="#admin">Painel do dono</a>` : ""}
        <button class="btn btn-ghost btn-sm" id="landing-sair">Sair da conta</button>
      </div>`;
    $("#landing-sair", root).addEventListener("click", () => logout());
    meusTimes(user.email).then(ids => {
      const sub = $("#meus-times-sub", root); if (!sub) return;
      sub.textContent = ids.length ? "Seus times:" : "Você ainda não tem um time vinculado a esta conta.";
      $("#meus-times", root).innerHTML = ids.map(id => `<button class="btn btn-ghost" data-ir="${escapeHtml(id)}" style="margin:0 8px 8px 0;">${escapeHtml(id)}</button>`).join("");
      $$("[data-ir]", root).forEach(b => b.addEventListener("click", () => irParaTime(b.dataset.ir)));
    });

    plataformaAberta().then(aberta => {
      if (!ehSuper && !aberta) return;
      const box = $("#landing-criar", root); if (!box) return;
      box.style.display = "";
      box.innerHTML = `<div class="card-title">Criar um time novo</div>
        <div class="card-sub">${ehSuper ? "Você é dono da plataforma: pode criar o time e escolher quem administra." : "Você começa com teste grátis e libera todas as funções."}</div>
        ${formCriarTimeHtml({ ehSuper, email: user.email })}`;
      ligarFormCriarTime(box, { ehSuper, aoCriar: (id) => irParaTime(id, "#configuracoes") });
    });
  }
}
