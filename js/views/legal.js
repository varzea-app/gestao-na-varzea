import { $, escapeHtml, toast } from "../utils.js";
import { db, emailNormalizado, logout } from "../auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { TEAM } from "../tenant.js";
import { APP_NOME, SUPER_ADMINS, CONTATO_WHATSAPP } from "../firebase-config.js";

// ============================================================================
// Política de Privacidade, Termos de Uso e aceite da equipe (LGPD).
// Texto-base (rascunho): peça a um advogado para revisar antes de cobrar pelo app.
// Troque a versão ao mudar os textos: a equipe será chamada a aceitar de novo.
// ============================================================================

export const VERSAO_TERMOS = "2026-11-14";
const ATUALIZADO_EM = "14 de novembro de 2026";
// Contato para pedidos de titulares (acesso, correção, exclusão). Troque se quiser outro e-mail.
const EMAIL_PRIVACIDADE = SUPER_ADMINS[0] || "";

const contato = () => {
  const partes = [];
  if (EMAIL_PRIVACIDADE) partes.push(`<a href="mailto:${escapeHtml(EMAIL_PRIVACIDADE)}">${escapeHtml(EMAIL_PRIVACIDADE)}</a>`);
  if (CONTATO_WHATSAPP) partes.push(`<a href="https://wa.me/${CONTATO_WHATSAPP}" target="_blank" rel="noopener">WhatsApp</a>`);
  return partes.join(" ou ") || "o contato informado na tela inicial";
};

function pagina(root, eyebrow, titulo, corpo){
  root.innerHTML = `
    <div class="topbar">
      <div>
        <div class="eyebrow">${escapeHtml(eyebrow)}</div>
        <h1>${escapeHtml(titulo)}</h1>
      </div>
    </div>
    <div class="card card-pad" style="max-width:820px; line-height:1.6; font-size:14.5px;">
      <p class="card-sub" style="margin-top:0;">Última atualização: ${ATUALIZADO_EM}</p>
      ${corpo}
      <p style="margin-top:20px;"><a class="btn btn-ghost btn-sm" href="${TEAM.existe ? "#dashboard" : "#"}" onclick="history.length > 1 ? (history.back(), false) : true">&larr; Voltar</a></p>
    </div>`;
}

const h = (t) => `<h3 style="margin:22px 0 6px; font-size:16px;">${t}</h3>`;

export function renderPrivacidade(root){
  pagina(root, "Legal", "Política de Privacidade", `
    <p>Esta política explica como o <strong>${escapeHtml(APP_NOME)}</strong> ("plataforma") trata dados pessoais, em conformidade com a Lei Geral de Proteção de Dados (Lei 13.709/2018, LGPD).</p>

    ${h("1. Quem é responsável pelos dados")}
    <p><strong>Dados do time</strong> (atletas, jogos, avaliações, financeiro): o <strong>time</strong>, por meio de seus dirigentes (a "equipe"), decide quais dados cadastrar e para quê; é o <em>controlador</em> desses dados. A plataforma atua como <em>operador</em>: guarda e processa os dados por conta do time, para prestar o serviço.</p>
    <p><strong>Dados de acesso dos dirigentes</strong> (e-mail e nome da conta Google): a plataforma é a <em>controladora</em>.</p>

    ${h("2. Quais dados são tratados")}
    <ul>
      <li>Atletas: nome, nome completo, número da camisa, posição, situação no elenco (ativo, pagante, direito a voto) e observações.</li>
      <li>Dados com acesso restrito à equipe: telefone, CPF e data de nascimento (opcionais), guardados em área separada.</li>
      <li>Desempenho: escalações, gols, assistências, notas de avaliação e confirmação de presença.</li>
      <li>Financeiro do time: mensalidades, pagamentos e despesas, visíveis só para a equipe.</li>
      <li>Dirigentes: e-mail e nome da conta Google usada no login.</li>
      <li>No seu navegador: preferência de tema, último time acessado e uma cópia de cache dos dados do time, para o app abrir mais rápido.</li>
    </ul>
    <p>A plataforma não pede dados sensíveis (saúde, biometria, religião etc.). Pedimos que não sejam lançados nos campos de observação.</p>

    ${h("3. Para que usamos e em que base legal")}
    <ul>
      <li>Organizar o time (elenco, jogos, estatísticas, presença, financeiro): execução do serviço contratado pelo time e legítimo interesse de gestão do grupo esportivo.</li>
      <li>Login e segurança dos dirigentes: execução do serviço e prevenção a fraudes.</li>
      <li>Dados de menores de 18 anos: tratados com o consentimento específico de pelo menos um dos pais ou responsável, a ser obtido pelo time (art. 14 da LGPD).</li>
      <li>Telefone, CPF e data de nascimento: só se o atleta (ou o responsável) concordar com o cadastro.</li>
    </ul>
    <p>Não vendemos dados nem os usamos para publicidade.</p>

    ${h("4. Quem vê os dados")}
    <p>O time escolhe, em Configurações, se Dashboard, Ranking, Histórico e relatórios ficam <strong>públicos</strong> (qualquer pessoa com o link vê nomes, gols e notas) ou <strong>restritos à equipe</strong>. Financeiro, telefone, CPF e nascimento nunca aparecem nas telas públicas. Dados de menores devem ser mantidos na opção restrita, salvo autorização do responsável para exibição pública.</p>

    ${h("5. Com quem compartilhamos")}
    <p>Usamos a infraestrutura do Google (Firebase Authentication e Cloud Firestore) para login e armazenamento, e o GitHub Pages para hospedar o site. Esses provedores tratam dados em nosso nome e podem manter servidores fora do Brasil; por isso pode haver <strong>transferência internacional</strong> de dados, com as garantias previstas na LGPD (art. 33). Também podemos compartilhar dados por determinação legal ou judicial.</p>

    ${h("6. Por quanto tempo guardamos")}
    <p>Enquanto o time usar a plataforma. Quando o time é excluído, todos os seus dados são apagados. O time pode apagar ou anonimizar um atleta a qualquer momento. Cópias de backup baixadas pelo time ficam sob a responsabilidade dele.</p>

    ${h("7. Direitos do titular")}
    <p>Você pode pedir: confirmação de que tratamos seus dados, acesso, correção, anonimização, bloqueio ou eliminação de dados desnecessários, portabilidade, informação sobre compartilhamento e revogação do consentimento (art. 18 da LGPD). Como os dados dos atletas são cadastrados pelo time, peça primeiro aos dirigentes do seu time. Se não resolver, fale com ${contato()} que ajudamos a atender o pedido. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).</p>

    ${h("8. Segurança")}
    <p>Acesso de edição só para e-mails autorizados pelo time; dados sensíveis do cadastro e financeiro com leitura restrita à equipe; comunicação criptografada (HTTPS). Nenhum sistema é totalmente imune a falhas; em caso de incidente com risco relevante, avisaremos os times e a ANPD nos termos da lei.</p>

    ${h("9. Cookies e armazenamento local")}
    <p>Usamos o armazenamento do navegador apenas para o funcionamento do app (tema, último time, cache e sessão de login). Não usamos cookies de publicidade nem de rastreamento.</p>

    ${h("10. Encarregado e contato")}
    <p>Pedidos e dúvidas sobre privacidade: ${contato()}.</p>

    ${h("11. Mudanças")}
    <p>Podemos atualizar esta política. Mudanças relevantes serão avisadas à equipe no app, que poderá precisar aceitar o novo texto.</p>
  `);
}

export function renderTermos(root){
  pagina(root, "Legal", "Termos de Uso", `
    <p>Ao usar o <strong>${escapeHtml(APP_NOME)}</strong>, você concorda com estes termos e com a <a href="#privacidade">Política de Privacidade</a>.</p>

    ${h("1. O serviço")}
    <p>Ferramenta online para times amadores gerirem elenco, jogos, estatísticas, presença e finanças. Cada time tem seu espaço próprio; só a equipe (e-mails autorizados) edita os dados.</p>

    ${h("2. Responsabilidades da equipe do time")}
    <ul>
      <li>Cadastrar apenas dados necessários e verdadeiros, e manter os e-mails da equipe atualizados.</li>
      <li>Ter autorização dos atletas para cadastrar seus dados; para <strong>menores de 18 anos</strong>, autorização de pelo menos um dos pais ou responsável.</li>
      <li>Escolher a visibilidade das telas (pública ou restrita) de forma coerente com essas autorizações, e atender pedidos dos titulares (correção, exclusão, anonimização).</li>
      <li>Não lançar dados sensíveis nem conteúdo ofensivo, discriminatório ou ilegal, e não usar notas e relatórios para expor ou humilhar pessoas.</li>
      <li>Guardar com segurança backups baixados e o acesso da conta Google.</li>
    </ul>

    ${h("3. Responsabilidades da plataforma")}
    <p>Manter o serviço, tratar os dados do time apenas para prestá-lo, aplicar medidas de segurança razoáveis e apagar os dados quando o time for excluído. Não garantimos funcionamento ininterrupto: o serviço depende de terceiros (Google, GitHub) e de cotas de uso gratuitas, e pode ficar indisponível ou limitado.</p>

    ${h("4. Planos, teste e contribuições")}
    <p>Times novos podem ter período de teste. Funções e prazos variam conforme o plano. Contribuições voluntárias ajudam a manter o app e não geram vínculo, exclusividade ou garantia de nível de serviço, salvo acordo por escrito.</p>

    ${h("5. Uso proibido")}
    <p>Tentar acessar dados de outros times, burlar limites ou regras de segurança, sobrecarregar o serviço, ou usá-lo para fins ilegais. Podemos suspender times que descumprirem estes termos.</p>

    ${h("6. Encerramento")}
    <p>O time pode pedir a exclusão a qualquer momento, e baixar um backup antes. Podemos encerrar o serviço mediante aviso razoável.</p>

    ${h("7. Limitação de responsabilidade")}
    <p>O app é fornecido "como está". Na medida permitida por lei, não respondemos por perdas indiretas, por decisões tomadas com base em estatísticas e notas, nem por dados lançados incorretamente pela equipe.</p>

    ${h("8. Lei e foro")}
    <p>Lei brasileira. Fica eleito o foro do domicílio do consumidor, quando aplicável, ou o da comarca de São Paulo/SP.</p>

    ${h("9. Contato")}
    <p>${contato()}.</p>
  `);
}

// ----------------------------------------------------------------------------
// Aceite da equipe: na 1ª vez que um dirigente entra (e quando a versão dos
// textos muda), pede o "li e aceito" e a declaração sobre autorização dos
// atletas. Guardado em times/{id}/privado/aceite-{email}. Se a leitura/gravação
// falhar (ex.: regras ainda não publicadas), não bloqueia o uso.
// ----------------------------------------------------------------------------
export async function garantirAceite(user){
  if (!user || !TEAM.id || document.getElementById("aceite-overlay")) return;
  const ref = doc(db, "times", TEAM.id, "privado", "aceite-" + emailNormalizado(user.email));
  try{
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data().versao === VERSAO_TERMOS) return;
  }catch(err){ return; }

  const base = location.pathname;
  const wrap = document.createElement("div");
  wrap.id = "aceite-overlay";
  wrap.className = "modal-overlay";
  wrap.style.zIndex = "300";
  wrap.innerHTML = `
    <div class="modal" style="max-width:520px;">
      <div class="modal-head"><h3>Privacidade e termos</h3></div>
      <div class="modal-body">
        <p style="margin-top:0;">Para administrar <strong>${escapeHtml(TEAM.nome)}</strong>, leia e aceite:</p>
        <p><a href="${escapeHtml(base)}#privacidade" target="_blank" rel="noopener">Política de Privacidade</a> · <a href="${escapeHtml(base)}#termos" target="_blank" rel="noopener">Termos de Uso</a></p>
        <label style="display:flex; gap:10px; align-items:flex-start; font-size:14px; cursor:pointer;">
          <input type="checkbox" id="aceite-chk" style="margin-top:4px; width:16px; height:16px;">
          <span>Li e aceito a Política de Privacidade e os Termos de Uso. Declaro que tenho autorização dos atletas (ou dos responsáveis, no caso de menores de 18 anos) para cadastrar os dados deles no app.</span>
        </label>
        <div class="form-actions" style="justify-content:space-between;">
          <button type="button" class="btn btn-ghost btn-sm" id="aceite-sair">Sair</button>
          <button type="button" class="btn btn-primary" id="aceite-ok" disabled>Aceitar e continuar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const chk = $("#aceite-chk", wrap), ok = $("#aceite-ok", wrap);
  chk.addEventListener("change", () => { ok.disabled = !chk.checked; });
  $("#aceite-sair", wrap).addEventListener("click", () => { wrap.remove(); logout(); });
  ok.addEventListener("click", async () => {
    ok.disabled = true;
    try{
      await setDoc(ref, { versao: VERSAO_TERMOS, em: serverTimestamp() });
      wrap.remove();
    }catch(err){
      console.error(err);
      toast("Não consegui registrar o aceite agora. Tente de novo.", "err");
      ok.disabled = false;
    }
  });
}
