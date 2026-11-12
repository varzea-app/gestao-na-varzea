// ============================================================================
// CONFIGURAÇÃO DO APP (uma vez só, para a plataforma inteira)
// ============================================================================
// Este arquivo é compartilhado por TODOS os times. O que muda de um time para
// outro (nome, escudo, cores, equipe, plano) fica salvo no Firestore, na
// coleção "times" — não aqui.
// ============================================================================

// ATENÇÃO: use um projeto Firebase NOVO para esta plataforma (veja o README).
// Não reaproveite o projeto do app antigo do Bom D' Copus: as regras de
// segurança são por projeto, e publicar as regras novas lá derrubaria o app antigo.
// Cole aqui o objeto que o Firebase mostra em Configurações do projeto → Seus apps.
export const firebaseConfig = {
  apiKey: "AIzaSyDgVsskGxFxGmMj9BiNmabr-h27EF1Rg0k",
  authDomain: "projetodavarzea-5179c.firebaseapp.com",
  projectId: "projetodavarzea-5179c",
  storageBucket: "projetodavarzea-5179c.firebasestorage.app",
  messagingSenderId: "1025580144298",
  appId: "1:1025580144298:web:0a2884d9e16a3f34b3a2d3",
};

// Nome do produto, mostrado na tela inicial (quando ainda não há um time
// escolhido) e no rodapé dos times. Troque pelo nome que você vai usar.
export const APP_NOME = "GESTÃO NA VÁRZEA";

// Donos da plataforma: podem criar times, mudar plano e validade e abrir o
// painel #admin. Precisa ser igual à lista "supers()" do firestore.rules.
export const SUPER_ADMINS = [
  "lucas.rf.nascimento@gmail.com"
];

// Dias de teste grátis de um time novo (o firestore.rules aceita até 31).
export const DIAS_DE_TESTE = 30;

// Número de WhatsApp (com DDI e DDD, só dígitos, ex.: "5511999999999") para o
// botão "Falar no WhatsApp" e o aviso de plano vencido. Deixe "" para ocultar.
export const CONTATO_WHATSAPP = "5511981503805";
