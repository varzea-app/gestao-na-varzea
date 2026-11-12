import { $, $$, escapeHtml, toast, confirmAction, formatDate, dataISOLocal } from "../utils.js";
import { emailNormalizado } from "../auth.js";
import {
  TEAM, PRESETS_CORES, atualizarTime, lerEquipe, salvarEquipe, linkDoTime, sairDoTime,
  redimensionarImagem, escudoPadrao, cssDoTema
} from "../tenant.js";
import { PLANOS, planoVigente, diasRestantes } from "../planos.js";
import { popularDemonstracao, limparDadosDoTime } from "../demo.js";
import { COLECOES_BACKUP, NOMES_COLECOES, gerarBackup, baixarJson, lerArquivoBackup, importarBackup } from "../backup.js";

// ============================================================================
// Configurações do time — nome, sigla, escudo, cores, equipe e link.
// Quem edita: equipe do time (e o dono da plataforma).
// ============================================================================

// Resultado da última importação. A tela é redesenhada sozinha enquanto os dados
// chegam, então o resumo fica guardado aqui para não sumir.
let ultimaImportacao = null;

function resumoDaImportacao(r){
  const linhas = COLECOES_BACKUP.filter(n => n in r.arquivo).map(n => {
    const ok = r.agora[n] === r.arquivo[n];
    return `<tr><td>${escapeHtml(NOMES_COLECOES[n])}</td><td style="text-align:right;">${r.arquivo[n]}</td><td style="text-align:right;">${r.agora[n] ?? "erro"}</td><td>${ok ? "ok" : "confira"}</td></tr>`;
  }).join("");
  return `<div class="card-sub" style="margin-bottom:6px;"><strong>Importação concluída:</strong> ${r.n} registros gravados. Compare as contagens:</div>
    <div class="table-wrap"><table><thead><tr><th>Coleção</th><th style="text-align:right;">No arquivo</th><th style="text-align:right;">Neste time agora</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>`;
}

export function renderConfiguracoes(root, state){
  const user = state.usuario;
  const ehSuper = !!state.ehSuper;

  // Rascunho: só vai para o banco quando clicar em "Salvar".
  const rascunho = {
    nome: TEAM.nome, sigla: TEAM.sigla, escudo: TEAM.escudoEnviado,
    corPrimaria: TEAM.corPrimaria, corDestaque: TEAM.corDestaque,
  };

  const dias = diasRestantes();
  const textoPlano = !planoVigente()
    ? `<strong style="color:var(--danger);">Vencido</strong> em ${formatDate(dataISOLocal(TEAM.validoAte))} — o time fica só em consulta até renovar.`
    : dias === null ? "Sem data de vencimento."
    : dias > 3000 ? "Sem data de vencimento."
    : `Vale até ${formatDate(dataISOLocal(TEAM.validoAte))} (${dias} dia${dias === 1 ? "" : "s"}).`;

  root.innerHTML = `
    <div class="topbar">
      <div>
        <div class="eyebrow">Gestão</div>
        <h1>Configurações do time</h1>
      </div>
    </div>

    <div class="card card-pad">
      <div class="card-title">Identidade do time</div>
      <div class="card-sub">Nome, escudo e cores aparecem no app inteiro, nas imagens e nas mensagens para compartilhar.</div>
      <div class="cfg-grid">
        <div>
          <div class="form-grid">
            <div class="field span-2"><label>Nome do time</label><input type="text" id="cfg-nome" maxlength="40" value="${escapeHtml(rascunho.nome)}"></div>
            <div class="field"><label>Sigla (até 3 letras)</label><input type="text" id="cfg-sigla" maxlength="3" value="${escapeHtml(rascunho.sigla)}"></div>
            <div class="field"><label>Escudo (PNG ou JPG)</label>
              <input type="file" id="cfg-escudo" accept="image/*">
            </div>
          </div>
          <div class="card-sub" style="margin:14px 0 6px;">Paleta de cores</div>
          <div class="cfg-presets">
            ${PRESETS_CORES.map((c, i) => `<button type="button" class="cor-preset" data-preset="${i}" title="${escapeHtml(c.nome)}">
              <span style="background:${c.primaria};"></span><span style="background:${c.destaque};"></span>${escapeHtml(c.nome)}</button>`).join("")}
          </div>
          <div class="form-grid" style="margin-top:10px;">
            <div class="field"><label>Cor principal (menu, súmula)</label><input type="color" id="cfg-cor1" value="${rascunho.corPrimaria}"></div>
            <div class="field"><label>Cor de destaque (botões, títulos)</label><input type="color" id="cfg-cor2" value="${rascunho.corDestaque}"></div>
          </div>
        </div>
        <div>
          <div class="card-sub" style="margin-bottom:6px;">Prévia</div>
          <div class="cfg-preview" id="cfg-preview"></div>
          <button type="button" class="btn btn-ghost btn-sm" id="cfg-remover-escudo" style="margin-top:8px;">Usar escudo padrão</button>
        </div>
      </div>
      <div class="form-actions"><button class="btn btn-primary" id="cfg-salvar">Salvar identidade</button></div>
    </div>

    <div class="card card-pad">
      <div class="card-title">Equipe</div>
      <div class="card-sub">Quem entra com estes e-mails Google pode cadastrar jogos, atletas e financeiro. Os demais só consultam.</div>
      <div id="cfg-equipe">Carregando…</div>
      <form id="cfg-form-equipe" class="landing-linha" style="margin-top:10px;">
        <input type="email" id="cfg-novo-email" placeholder="email@gmail.com" aria-label="E-mail Google">
        <button type="submit" class="btn btn-ghost">Adicionar</button>
      </form>
    </div>

    <div class="card card-pad">
      <div class="card-title">Link do time</div>
      <div class="card-sub">Mande este link para os atletas e torcedores: eles veem o dashboard, o ranking e o histórico sem precisar de login.</div>
      <div class="landing-linha">
        <input type="text" id="cfg-link" readonly value="${escapeHtml(linkDoTime())}">
        <button class="btn btn-ghost" id="cfg-copiar">Copiar</button>
        <a class="btn btn-gold" id="cfg-whats" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${TEAM.nome} no app: ${linkDoTime()}`)}">WhatsApp</a>
      </div>
    </div>

    <div class="card card-pad">
      <div class="card-title">Plano</div>
      <div class="card-sub"><strong>${escapeHtml((PLANOS[TEAM.plano] || PLANOS.start).nome)}</strong> — ${textoPlano}</div>
      ${ehSuper ? `<a class="btn btn-ghost btn-sm" href="#admin">Mudar plano no painel do dono</a>` : ""}
    </div>


    <div class="card card-pad">
      <div class="card-title">Backup dos dados</div>
      <div class="card-sub">Baixa um arquivo com todos os dados do time (atletas, jogos, financeiro, presenças). Guarde em lugar seguro: ele contém dados pessoais.</div>
      <div class="form-actions" style="justify-content:flex-start;"><button class="btn btn-ghost" id="cfg-backup">Baixar backup</button></div>
    </div>

    ${ehSuper ? `
    <div class="card card-pad">
      <div class="card-title">Importar backup (só o dono da plataforma vê)</div>
      <div class="card-sub">Traz para este time os dados de um arquivo de backup, por exemplo o do app antigo do Bom D' Copus. Os registros mantêm o mesmo código: importar o mesmo arquivo de novo só atualiza, não duplica.</div>
      <div class="field"><label>Arquivo de backup (.json)</label><input type="file" id="cfg-arquivo-backup" accept=".json,application/json"></div>
      <div id="cfg-backup-previa" style="margin-top:12px;"></div>
    </div>` : ""}

    ${ehSuper ? `
    <div class="card card-pad">
      <div class="card-title">Demonstração (só o dono da plataforma vê)</div>
      <div class="card-sub">Preenche o time com atletas, adversários, jogos, notas e financeiro de exemplo, todos fictícios, para gravar vídeos e mostrar o app cheio.</div>
      <div class="form-actions" style="justify-content:flex-start; gap:8px; flex-wrap:wrap;">
        <button class="btn btn-gold" id="cfg-demo">Preencher com dados de exemplo</button>
        <button class="btn btn-danger" id="cfg-limpar">Apagar os dados deste time</button>
      </div>
    </div>` : ""}

    <div class="form-actions" style="justify-content:flex-start;"><button class="btn btn-ghost btn-sm" id="cfg-sair-time">Trocar de time</button></div>
  `;

  if (ultimaImportacao && ultimaImportacao.timeId === TEAM.id){
    const alvo = $("#cfg-backup-previa", root);
    if (alvo) alvo.innerHTML = resumoDaImportacao(ultimaImportacao);
  }

  // ---------------- Prévia ao vivo ----------------
  function desenharPrevia(){
    const escudo = rascunho.escudo || escudoPadrao(rascunho.sigla, rascunho.corPrimaria, rascunho.corDestaque);
    $("#cfg-preview", root).innerHTML = `
      <style>${cssDoTema(rascunho.corPrimaria, rascunho.corDestaque).replace(/:root/g, "#cfg-preview").replace(/html\[data-theme="dark"\]/g, "html[data-theme=dark] #cfg-preview")}</style>
      <div class="cfg-preview-brand">
        <img src="${escudo}" alt="">
        <div><div class="brand-name">${escapeHtml((rascunho.nome || "Meu Time").toUpperCase())}</div><div class="brand-sub">Gestão do time</div></div>
      </div>
      <div class="cfg-preview-body"><span class="btn btn-gold btn-sm">Botão de destaque</span></div>`;
  }
  desenharPrevia();

  $("#cfg-nome", root).addEventListener("input", (e) => { rascunho.nome = e.target.value; desenharPrevia(); });
  $("#cfg-sigla", root).addEventListener("input", (e) => { rascunho.sigla = e.target.value.toUpperCase(); desenharPrevia(); });
  $("#cfg-cor1", root).addEventListener("input", (e) => { rascunho.corPrimaria = e.target.value; desenharPrevia(); });
  $("#cfg-cor2", root).addEventListener("input", (e) => { rascunho.corDestaque = e.target.value; desenharPrevia(); });
  $$("[data-preset]", root).forEach(b => b.addEventListener("click", () => {
    const c = PRESETS_CORES[Number(b.dataset.preset)];
    rascunho.corPrimaria = c.primaria; rascunho.corDestaque = c.destaque;
    $("#cfg-cor1", root).value = c.primaria; $("#cfg-cor2", root).value = c.destaque;
    desenharPrevia();
  }));
  $("#cfg-escudo", root).addEventListener("change", async (e) => {
    const arq = e.target.files[0]; if (!arq) return;
    try{ rascunho.escudo = await redimensionarImagem(arq, 256); desenharPrevia(); }
    catch(err){ toast(err.message, "err"); }
  });
  $("#cfg-remover-escudo", root).addEventListener("click", () => { rascunho.escudo = ""; $("#cfg-escudo", root).value = ""; desenharPrevia(); });

  $("#cfg-salvar", root).addEventListener("click", async (e) => {
    const nome = rascunho.nome.trim();
    if (!nome) return toast("Informe o nome do time.", "err");
    e.target.disabled = true;
    try{
      await atualizarTime({
        nome, sigla: rascunho.sigla.trim().toUpperCase(), escudo: rascunho.escudo,
        corPrimaria: rascunho.corPrimaria, corDestaque: rascunho.corDestaque,
      });
      toast("Identidade salva.", "ok");
    }catch(err){
      console.error(err);
      toast(err.code === "permission-denied" ? "Sem permissão para salvar (plano vencido ou conta fora da equipe)." : "Erro ao salvar: " + err.message, "err");
    }
    e.target.disabled = false;
  });

  // ---------------- Equipe ----------------
  let emails = [];
  const meuEmail = emailNormalizado(user?.email);
  function desenharEquipe(){
    $("#cfg-equipe", root).innerHTML = emails.length ? emails.map(em => `
      <div class="cfg-email"><span>${escapeHtml(em)}${em === meuEmail ? " (você)" : ""}</span>
      ${em === meuEmail && !ehSuper ? "" : `<button class="btn btn-ghost btn-sm" data-rem="${escapeHtml(em)}">Remover</button>`}</div>`).join("")
      : `<div class="card-sub">Ninguém na equipe ainda.</div>`;
    $$("[data-rem]", root).forEach(b => b.addEventListener("click", async () => {
      if (!(await confirmAction(`Remover ${b.dataset.rem} da equipe?`))) return;
      try{ emails = await salvarEquipe(emails.filter(x => x !== b.dataset.rem)); desenharEquipe(); toast("Removido.", "ok"); }
      catch(err){ toast("Erro: " + err.message, "err"); }
    }));
  }
  lerEquipe().then(l => { emails = l.map(emailNormalizado); desenharEquipe(); })
    .catch(() => { $("#cfg-equipe", root).textContent = "Não foi possível carregar a equipe."; });
  $("#cfg-form-equipe", root).addEventListener("submit", async (e) => {
    e.preventDefault();
    const novo = emailNormalizado($("#cfg-novo-email", root).value);
    if (!novo.includes("@")) return toast("Informe um e-mail válido.", "err");
    if (emails.includes(novo)) return toast("Esse e-mail já está na equipe.", "err");
    try{ emails = await salvarEquipe([...emails, novo]); $("#cfg-novo-email", root).value = ""; desenharEquipe(); toast("Adicionado.", "ok"); }
    catch(err){ toast("Erro: " + err.message, "err"); }
  });

  // ---------------- Link ----------------
  $("#cfg-copiar", root).addEventListener("click", async () => {
    try{ await navigator.clipboard.writeText(linkDoTime()); toast("Link copiado.", "ok"); }
    catch(err){ $("#cfg-link", root).select(); toast("Selecione e copie o link.", "ok"); }
  });
  $("#cfg-sair-time", root).addEventListener("click", sairDoTime);


  // ---------------- Backup ----------------
  $("#cfg-backup", root).addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Gerando…";
    const { backup, falhas } = await gerarBackup();
    if (falhas.length) toast("Não consegui ler: " + falhas.map(f => NOMES_COLECOES[f]).join(", "), "err");
    else { baixarJson(backup, `backup-${TEAM.id}-${dataISOLocal()}.json`); toast("Backup baixado.", "ok"); }
    e.target.disabled = false; e.target.textContent = "Baixar backup";
  });

  $("#cfg-arquivo-backup", root)?.addEventListener("change", async (e) => {
    const previa = $("#cfg-backup-previa", root);
    const arquivo = e.target.files[0];
    if (!arquivo){ previa.innerHTML = ""; return; }
    let lido;
    try{ lido = await lerArquivoBackup(arquivo); }
    catch(err){ previa.innerHTML = `<div class="landing-aviso" style="margin:0;">${escapeHtml(err.message)}</div>`; return; }
    const linhas = COLECOES_BACKUP.filter(n => n in lido.contagens).map(n =>
      `<tr><td>${escapeHtml(NOMES_COLECOES[n])}</td><td style="text-align:right;">${lido.contagens[n]}</td><td style="text-align:right;" data-agora="${n}">—</td></tr>`).join("");
    previa.innerHTML = `
      <div class="card-sub" style="margin-bottom:6px;">Origem: ${escapeHtml(lido.dados.origem || "?")} · gerado em ${escapeHtml(String(lido.dados.geradoEm || "?").slice(0, 10))}</div>
      <div class="table-wrap"><table><thead><tr><th>Coleção</th><th style="text-align:right;">No arquivo</th><th style="text-align:right;">Neste time agora</th></tr></thead><tbody>${linhas}</tbody></table></div>
      <div class="form-actions" style="justify-content:flex-start;"><button class="btn btn-primary" id="cfg-importar">Importar para este time</button></div>`;
    const atualizarAgora = async () => {
      const { contagens } = await gerarBackup();
      $$("[data-agora]", previa).forEach(td => { td.textContent = contagens[td.dataset.agora] ?? "erro"; });
    };
    atualizarAgora();
    $("#cfg-importar", previa).addEventListener("click", async (ev) => {
      if (state.atletas.length || state.jogos.length){
        if (!(await confirmAction("Este time já tem dados. Os registros do arquivo vão ser gravados por cima dos que têm o mesmo código e somados aos demais. Continuar?"))) return;
      }
      ev.target.disabled = true; ev.target.textContent = "Importando…";
      try{
        const n = await importarBackup(lido.dados);
        toast(`Importação concluída: ${n} registros.`, "ok");
        const { contagens: agora } = await gerarBackup();
        ultimaImportacao = { timeId: TEAM.id, n, arquivo: lido.contagens, agora };
        const alvo = $("#cfg-backup-previa", root);
        if (alvo) alvo.innerHTML = resumoDaImportacao(ultimaImportacao);
      }catch(err){
        console.error(err);
        toast("Erro na importação: " + err.message, "err");
      }
      if (ev.target.isConnected){ ev.target.disabled = false; ev.target.textContent = "Importar para este time"; }
    });
  });

  // ---------------- Demonstração (dono) ----------------
  $("#cfg-demo", root)?.addEventListener("click", async (e) => {
    if (state.atletas.length || state.jogos.length){
      if (!(await confirmAction("Este time já tem dados. Os dados de exemplo serão somados aos existentes. Continuar?"))) return;
    }
    e.target.disabled = true; e.target.textContent = "Preenchendo…";
    try{ const n = await popularDemonstracao(); toast(`Pronto! ${n} registros de exemplo criados.`, "ok"); }
    catch(err){ console.error(err); toast("Erro ao preencher: " + err.message, "err"); }
    e.target.disabled = false; e.target.textContent = "Preencher com dados de exemplo";
  });
  $("#cfg-limpar", root)?.addEventListener("click", async (e) => {
    if (!(await confirmAction("Apagar TODOS os atletas, jogos, adversários, campos e lançamentos deste time? Não dá para desfazer."))) return;
    e.target.disabled = true;
    try{ await limparDadosDoTime(state); toast("Dados apagados.", "ok"); }
    catch(err){ console.error(err); toast("Erro ao apagar: " + err.message, "err"); }
    e.target.disabled = false;
  });
}
