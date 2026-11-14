# Gestão de Time — app multi-time (white-label)

Um único app para vários times de futebol. Cada time tem o próprio endereço
(`.../?time=meu-time`), nome, escudo, cores, equipe, atletas, jogos e financeiro.
Os dados de cada time ficam separados em `times/{codigo-do-time}/...` no Firestore.

Planos (editáveis em `js/planos.js`): **Start**, **Pro**, **Craque** e **Teste grátis**
(30 dias com tudo liberado). Você, dono da plataforma, muda o plano e a validade de
cada time no **Painel do dono** (`#admin`).

> Este é um app **novo**, separado do app antigo do Bom D' Copus. O antigo continua
> funcionando como está. Use um **projeto Firebase novo** (passo 1) — as regras de
> segurança valem para o projeto inteiro, e publicar estas regras no projeto antigo
> tiraria o app antigo do ar.

## 1. Criar o projeto no Firebase (uma vez)

1. Em [console.firebase.google.com](https://console.firebase.google.com) crie um projeto novo (plano Spark, gratuito).
2. **Build → Authentication → Sign-in method**: ative o provedor **Google**.
3. **Build → Firestore Database → Criar banco de dados** em modo **produção**, região `southamerica-east1`.
4. **Configurações do projeto → Geral → Seus apps → `</>` (Web)**: registre um app web e copie o `firebaseConfig`.
5. Cole os valores em `js/firebase-config.js` (substitua os `COLE_AQUI`).
6. Ainda em `js/firebase-config.js`: confira `SUPER_ADMINS` (seu e-mail), `APP_NOME` e, se quiser, `CONTATO_WHATSAPP` (ex.: `"5511999999999"`).

## 2. Regras de segurança

Em **Firestore Database → Regras**, cole o conteúdo de `firestore.rules` e clique em **Publicar**.
Confira que o e-mail da lista `supers()` é o mesmo de `SUPER_ADMINS`.

As regras garantem, no servidor: leitura pública só do que alimenta as telas abertas
(dashboard, ranking, histórico); escrita só para a equipe do time e com plano vigente;
financeiro só para equipe e plano Craque/teste; presença pública só com plano Pro ou superior;
equipe do time não consegue mudar o próprio plano nem a validade.

## 3. Publicar no GitHub Pages

1. Crie um repositório novo (ex.: `gestao-de-time`) na sua conta do GitHub.
2. Envie todos os arquivos desta pasta (pode arrastar pelo site: **Add file → Upload files**).
3. **Settings → Pages → Source**: branch `main`, pasta `/ (root)` → Save.
4. Copie o endereço publicado (`https://SEU-USUARIO.github.io/gestao-de-time/`).
5. No Firebase: **Authentication → Settings → Authorized domains → Add domain** e adicione `SEU-USUARIO.github.io`.

## 4. Montar o time de demonstração (para gravar os vídeos)

1. Abra o endereço publicado e clique em **Entrar com Google** (com o e-mail de dono).
2. Em **Criar um time novo**, informe nome (ex.: "Unidos da Demo"), e-mail administrador (o seu) e crie.
3. O app abre em **Configurações**. Escolha um escudo, as cores e salve.
4. Em **Demonstração**, clique em **Preencher com dados de exemplo**: entram 17 atletas fictícios,
   adversários, campos, 10 jogos jogados com escalação, gols, assistências e notas, 2 jogos
   agendados, confirmações de presença e financeiro de 4 meses.
5. Para mostrar cada plano nos vídeos, vá em **Painel do dono** (`#admin`), troque o plano do
   time para Start / Pro / Craque e salve. O menu e as telas mudam de acordo com o plano.
6. Para refazer do zero: **Configurações → Apagar os dados deste time**, e preencha de novo.

## 5. Vender para um time

1. No **Painel do dono**, crie o time com o e-mail Google do dirigente.
2. Defina plano e validade (botões **+30 dias** e **Sem vencimento**).
3. Mande o link `https://.../?time=codigo-do-time`. O dirigente entra com o Google,
   ajusta nome, escudo e cores em **Configurações** e cadastra os próprios atletas.
   Outros e-mails da diretoria entram em **Configurações → Equipe**.
4. Torcedores e atletas abrem o mesmo link, sem login, só para consultar.

Se quiser que dirigentes criem o próprio time (teste grátis de 30 dias), crie no Firestore o
documento `plataforma/config` com o campo `autoCadastro = true`, ou use a opção no **Painel do dono**.

## Testar localmente

```bash
python3 -m http.server 8000
```
Abra `http://localhost:8000/?time=codigo-do-time`. (Os módulos ES não funcionam abrindo o `index.html` direto.)

## Estrutura

```
index.html              shell do app
manifest.json           manifesto padrão (cada time gera o próprio na hora)
firestore.rules         regras de segurança (publicar no console)
css/style.css           design system; as cores do time são injetadas em tempo de execução
js/firebase-config.js   chaves do Firebase, donos da plataforma, dias de teste, WhatsApp
js/planos.js            o que cada plano libera
js/tenant.js            time ativo, marca (nome/escudo/cores), equipe, planos
js/db.js                leitura/escrita em times/{codigo}/...
js/demo.js              dados fictícios de demonstração
js/app.js               rotas, login, controle de acesso por equipe e plano
js/views/*.js           uma tela por arquivo (landing, configuracoes e admin são novas)
```

## Modelo de dados

- `times/{codigo}`: `nome, sigla, escudo, corPrimaria, corDestaque, plano, validoAte, donoEmail`
- `times/{codigo}/privado/equipe`: `{ emails: [...] }`
- `times/{codigo}/{adversarios|campos|atletas|jogos|atletas_privado|financeiro|configuracoes|presencas}`: iguais ao app antigo
- `acessos/{email}`: `{ times: [...] }` (atalho "Seus times")
- `plataforma/config`: `{ autoCadastro }`

## Limites e cuidados

- Firestore gratuito: 50 mil leituras e 20 mil escritas por dia **por projeto**, somando todos os times. Acompanhe em **Usage** e ative alertas de orçamento antes de passar para o plano Blaze.
- O escudo é salvo no próprio documento do time (imagem reduzida a 256 px), sem Firebase Storage.
- O ícone de "adicionar à tela inicial" muda para o escudo no Android/Chrome; no iPhone o suporte é limitado.
- O e-mail do administrador de cada time fica no documento do time, que é de leitura pública (qualquer um com o link consegue ler).
- Cobrança é manual (Pix) por enquanto: você acompanha a validade no Painel do dono.
- Informe aos times que dados de atletas (nome, posição, CPF/nascimento opcionais) são tratados conforme a LGPD; CPF e nascimento ficam em coleção privada, nunca públicas.

---
© 2026 Lucas Nascimento. Todos os direitos reservados. Veja o arquivo `LICENSE`.
