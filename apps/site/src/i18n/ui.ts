import type { AvatarColor, AvatarSpecies } from '@brot/ui';

export const LOCALES = ['en', 'pt-BR', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_LABELS: Record<Locale, { short: string; name: string; og: string }> = {
  en: { short: 'EN', name: 'English', og: 'en_US' },
  'pt-BR': { short: 'PT', name: 'Português (Brasil)', og: 'pt_BR' },
  es: { short: 'ES', name: 'Español', og: 'es_ES' },
};

export const GITHUB_URL = 'https://github.com/guhcostan/brot';
export const RELEASES_URL = `${GITHUB_URL}/releases`;
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;
export const DEPLOY_URL = `${GITHUB_URL}/tree/main/deploy`;
export const CHANGELOG_URL = `${GITHUB_URL}/commits/main`;
export const ISSUES_URL = `${GITHUB_URL}/issues`;

export const PLATFORMS = ['macOS', 'Windows', 'Linux', 'iOS', 'Android'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** The demo cast. Names and faces are the same in every locale. */
export type CastId = 'capy' | 'onca' | 'tuca' | 'tamu' | 'lobo' | 'jabu' | 'bento' | 'arara';

export interface CastMember {
  name: string;
  species: AvatarSpecies;
  color: AvatarColor;
}

export const CAST: Record<CastId, CastMember> = {
  capy: { name: 'Capy', species: 'capivara', color: 'black' },
  onca: { name: 'Onça', species: 'onca', color: 'orange' },
  tuca: { name: 'Tuca', species: 'tucano', color: 'violet' },
  tamu: { name: 'Tamu', species: 'tamandua', color: 'teal' },
  lobo: { name: 'Lobo', species: 'lobo', color: 'gray' },
  jabu: { name: 'Jabu', species: 'jabuti', color: 'amber' },
  bento: { name: 'Bento', species: 'preguica', color: 'brown' },
  arara: { name: 'Arara', species: 'arara', color: 'blue' },
};

/** Words the live product mockup needs. Messages may @mention cast names. */
export interface DemoCopy {
  summary: string;
  workspace: string;
  search: string;
  roomsLabel: string;
  botsLabel: string;
  room: string;
  otherRooms: [string, string];
  roomMeta: string;
  roles: Record<CastId, string>;
  status: { idle: string; working: string; waiting: string; done: string; sleeping: string };
  you: string;
  messages: { user: string; capy: string; onca: string; tuca: string; sent: string };
  handoff: string;
  tool: { name: string; summary: string };
  approval: { kind: string; title: string; meta: string; allowOnce: string; allowAlways: string; deny: string; allowed: string };
  typing: string;
  composer: string;
  computer: { title: string; live: string; takeOver: string; steps: [string, string, string, string] };
  terminal: [string, string, string];
  tabs: [string, string, string];
}

export interface TakeoverCopy {
  label: string;
  bot: string;
  url: string;
  pageTitle: string;
  email: string;
  password: string;
  signIn: string;
  request: string;
  takeControl: string;
  giveBack: string;
  youHave: string;
  botWaits: string;
  back: string;
  snapshotTitle: string;
}

export interface Dict {
  meta: { title: string; description: string };
  nav: {
    label: string;
    product: string;
    computer: string;
    useCases: string;
    pricing: string;
    faq: string;
    github: string;
    language: string;
    skip: string;
    download: string;
  };
  hero: {
    chipNew: string;
    chipAvailable: string;
    meet: string;
    lead: string;
    download: string;
    otherPlatforms: string;
    platformNote: Record<Platform, string>;
    selfHost: string;
    note: string;
    avatar: string;
  };
  demo: DemoCopy;
  features: {
    title: string;
    lead: string;
    job: { title: string; body: string };
    computer: { title: string; body: string };
    rooms: { title: string; body: string; bubble: string };
    approvals: { title: string; body: string; card: string; meta: string; allow: string; deny: string };
    memory: { title: string; body: string; items: [string, string, string]; edit: string };
    models: { title: string; body: string; local: string };
    selfhost: { title: string; body: string };
  };
  works: { title: string; models: string; apps: string; note: string };
  computer: { eyebrow: string; title: string; lead: string; points: Array<{ title: string; body: string }>; demo: TakeoverCopy };
  useCases: { title: string; lead: string; items: Array<{ bot: CastId; title: string; body: string; tag: string }> };
  pricing: {
    title: string;
    lead: string;
    self: { name: string; price: string; per: string; body: string; points: string[]; cta: string; badge: string };
    cloudTitle: string;
    soon: string;
    plans: Array<{ name: string; for: string; points: string[] }>;
    note: string;
    waitlist: string;
  };
  faq: { title: string; lead: string; ask: string; items: Array<{ q: string; a: string }> };
  cta: { title: string; lead: string; download: string; selfHost: string; avatars: string };
  footer: { tagline: string; license: string; status: string; product: string; resources: string; source: string; changelog: string; selfHostGuide: string };
}

const en: Dict = {
  meta: {
    title: 'Brot · A team of AI bots, each with its own computer',
    description:
      'Open-source AI bots in a chat app. Each one has a job, any model, its own computer you can watch and take over, and memory you can read. Self-host it with docker compose or wait for Brot Cloud.',
  },
  nav: {
    label: 'Main',
    product: 'Product',
    computer: 'Computer',
    useCases: 'Use cases',
    pricing: 'Pricing',
    faq: 'FAQ',
    github: 'GitHub',
    language: 'Language',
    skip: 'Skip to content',
    download: 'Download',
  },
  hero: {
    chipNew: 'New',
    chipAvailable: 'Available on',
    meet: 'Meet',
    lead: 'A team of AI bots with real jobs and their own computers. They work in a chat, talk to each other, and ask you before anything they can’t undo.',
    download: 'Download for macOS',
    otherPlatforms: 'Other platforms',
    platformNote: { macOS: 'Desktop app', Windows: 'Desktop app', Linux: 'Desktop app or server', iOS: 'Remote control', Android: 'Remote control' },
    selfHost: 'Self-host',
    note: 'Free and open source. Bring your own model.',
    avatar: 'Capy, the capybara',
  },
  demo: {
    summary:
      'A live example of the Brot app. In the room acme-renewal you ask Capy to get the Acme renewal ready. Capy hands a bug to Onça and an email to Tuca. Onça fixes the bug on its own computer while you watch. Tuca drafts the email and asks for your approval before sending it.',
    workspace: 'Acme Studio',
    search: 'Search',
    roomsLabel: 'Rooms',
    botsLabel: 'Bots',
    room: 'acme-renewal',
    otherRooms: ['launch', 'weekly-content'],
    roomMeta: '4 bots · you',
    roles: {
      capy: 'Chief of staff',
      onca: 'Bug fixer',
      tuca: 'Sales follow-up',
      tamu: 'Researcher',
      lobo: 'Reviewer',
      jabu: 'Bookkeeper',
      bento: 'Watcher',
      arara: 'Writer',
    },
    status: { idle: 'Idle', working: 'Working', waiting: 'Waiting for you', done: 'Done', sleeping: 'Sleeping' },
    you: 'You',
    messages: {
      user: '@Capy get the Acme renewal ready by Friday.',
      capy: 'On it. @Onça, can you fix the CSV export bug Acme reported? @Tuca, draft the renewal email for Ana.',
      onca: 'Reproduced it on my computer and added a failing test. The fix is green, and the PR draft is ready for @Lobo.',
      tuca: 'Draft is ready for Ana, with the new pricing and a time to talk. Can I send it?',
      sent: 'Sent. I’ll tell you when Ana replies.',
    },
    handoff: 'Capy handed two tasks to Onça and Tuca',
    tool: { name: 'shell', summary: 'pnpm test export · 48 passed' },
    approval: {
      kind: 'Send',
      title: 'Send the renewal email to Ana?',
      meta: 'gmail.send · ana@acme.example',
      allowOnce: 'Allow once',
      allowAlways: 'Allow always',
      deny: 'Deny',
      allowed: 'Allowed once',
    },
    typing: 'is typing',
    composer: 'Message #acme-renewal',
    computer: {
      title: 'Onça’s computer',
      live: 'Live',
      takeOver: 'Take over',
      steps: ['Opening the issue', 'Reading the report', 'Running the tests', 'Opening a PR draft'],
    },
    terminal: ['$ pnpm test export', '✕ keeps the timezone in dates', '✓ 48 passed'],
    tabs: ['Computer', 'Memory', 'Cost'],
  },
  features: {
    title: 'What Brot does',
    lead: 'One app for a team of AI bots. Each one has a job, a computer, and a model you choose.',
    job: { title: 'Bots with a job', body: 'Start from a role or write your own. Each bot has a name, instructions, apps and a budget.' },
    computer: {
      title: 'Their own computer',
      body: 'Every bot works in its own sandboxed desktop. Watch the screen live and take over whenever you want.',
    },
    rooms: {
      title: 'Teams that talk',
      body: 'Put bots in a room. They @mention each other, hand off work, and stop at the limits you set.',
      bubble: '@Onça can you take the export bug?',
    },
    approvals: {
      title: 'You approve what matters',
      body: 'Payments, posts, sends and deletions wait for you. Allow once, always, or not at all.',
      card: 'Publish the release note?',
      meta: 'blog.publish · Arara',
      allow: 'Allow once',
      deny: 'Deny',
    },
    memory: {
      title: 'Memory you can read',
      body: 'Everything a bot remembers is visible, editable and exportable. No black box.',
      items: ['Ana prefers calls in the morning', 'Acme renews on the 24th', 'Write to Lucía in Spanish'],
      edit: 'Edit',
    },
    models: {
      title: 'Any model',
      body: 'Pick a provider per bot: a plan you already pay for, an API key, or a model on your own machine.',
      local: 'Local models',
    },
    selfhost: { title: 'Runs on your machine', body: 'One command on any server with Docker. Your data stays on your disks.' },
  },
  works: {
    title: 'Works with what you use',
    models: 'Models',
    apps: 'Apps, through MCP',
    note: 'Names belong to their owners. Brot isn’t affiliated with any of them.',
  },
  computer: {
    eyebrow: 'Computer use',
    title: 'Watch it work. Take the wheel.',
    lead: 'A bot’s computer is a real desktop with a browser. You see every click live, on your laptop or your phone.',
    points: [
      { title: 'It hands you the hard parts', body: 'Sign-ins, 2FA codes and CAPTCHAs go to you. The bot waits, and never tries to get around them.' },
      { title: 'Secrets stay with you', body: 'You type passwords during a takeover. The bot never sees them, and its model never does.' },
      { title: 'Its own network rules', body: 'Each computer only reaches the sites you allow. Everything else is blocked and logged.' },
    ],
    demo: {
      label:
        'Example: Tuca opens a CRM in its browser and reaches a sign-in page. Tuca asks you to take over. You take control, sign in, and give control back. Tuca takes a new snapshot of the page and continues.',
      bot: 'Tuca',
      url: 'crm.acme.example/login',
      pageTitle: 'Sign in to Acme CRM',
      email: 'Email',
      password: 'Password',
      signIn: 'Sign in',
      request: 'The CRM wants a sign-in. Can you take it from here?',
      takeControl: 'Take control',
      giveBack: 'Give control back',
      youHave: 'You have control',
      botWaits: 'Tuca is waiting',
      back: 'Control is back. Taking a new snapshot.',
      snapshotTitle: 'What Tuca sees',
    },
  },
  useCases: {
    title: 'Put a bot on it',
    lead: 'Jobs people hand to Brot today. Start with read-and-prepare work, then add approvals and routines.',
    items: [
      { bot: 'onca', title: 'Bug to PR draft', body: 'Clones the repo, reproduces the issue, writes a failing test and patches until it passes.', tag: 'Opening the PR needs you' },
      { bot: 'capy', title: 'Morning brief', body: 'What changed overnight and what needs a decision, each item with its source and next step.', tag: 'Routine · 08:00' },
      { bot: 'tuca', title: 'Sales follow-ups', body: 'Scores accounts against your ideal customer and drafts each email. Nothing goes out on its own.', tag: 'Sends need you' },
      { bot: 'tamu', title: 'Competitor watch', body: 'Snapshots pricing and changelog pages, and reports only what materially changed.', tag: 'Routine · weekly' },
      { bot: 'jabu', title: 'Expense reconciliation', body: 'Matches receipts to the ledger and flags policy exceptions, citing the policy.', tag: 'Read only' },
      { bot: 'lobo', title: 'Nightly audit', body: 'Runs lint, tests and a dependency audit every night and drafts the safe fixes.', tag: 'Routine · nightly' },
      { bot: 'bento', title: 'Status watcher', body: 'Checks a status page every 15 minutes and pings your phone only when it changes.', tag: 'Push to phone' },
      { bot: 'arara', title: 'Content team', body: 'Turns a changelog into a release note and a post, reviewed by another bot before you see it.', tag: 'Publishing needs you' },
    ],
  },
  pricing: {
    title: 'What it costs',
    lead: 'Self-hosting is free, with every feature. You pay your model provider directly, or run a local model.',
    self: {
      name: 'Self-host',
      price: '$0',
      per: 'forever',
      body: 'The desktop app or your own server. AGPL-3.0.',
      points: ['Unlimited bots and rooms', 'A sandboxed computer per bot', 'Phone pairing', 'Every feature, nothing held back'],
      cta: 'Download',
      badge: 'Available now',
    },
    cloudTitle: 'Brot Cloud',
    soon: 'Coming soon',
    plans: [
      { name: 'Free', for: 'Trying it out', points: ['1 bot, 1 computer', 'Limited compute minutes', 'Community support'] },
      { name: 'Baker', for: 'Solo founders', points: ['A few always-on bots', 'Routines and phone push', 'Email support'] },
      { name: 'Bakery', for: 'Teams of 2–20', points: ['Shared bots, apps and memory', 'Roles and audit log', 'Priority support'] },
      { name: 'Enterprise', for: 'Regulated teams', points: ['SSO, SCIM, region pinning', 'Dedicated computers', 'SLA and DPA'] },
    ],
    note: 'Cloud plans and prices aren’t final. Nothing is for sale yet.',
    waitlist: 'Watch on GitHub for news',
  },
  faq: {
    title: 'Questions',
    lead: 'Short answers about price, models, safety and your data.',
    ask: 'Ask on GitHub',
    items: [
      { q: 'Is Brot free?', a: 'Yes. Self-hosting is free and has every feature. You pay your model provider, or nothing at all with a local model. Brot Cloud will be a paid, hosted option for people who don’t want to run a server.' },
      { q: 'Is it open source?', a: 'Yes, under AGPL-3.0. You can read, run and change every line. If someone runs a modified Brot as a service, they have to share their changes too.' },
      { q: 'Which models can a bot use?', a: 'Each bot picks its own provider and model: OpenCode Go, DeepSeek, OpenAI, the Anthropic API, OpenRouter, any OpenAI-compatible endpoint, or a local model such as Ollama. We don’t route consumer subscriptions whose terms forbid it.' },
      { q: 'What is a bot’s computer?', a: 'A sandboxed Linux desktop with a browser, one per bot. Bots don’t share logins or files, and one stuck computer doesn’t stop the others. You can watch it live and take control at any time.' },
      { q: 'Will a bot do something without asking?', a: 'Not for anything that matters. Payments, purchases, posts, sends, deletions and permission changes pause for your approval. Delegating to another bot never widens what it’s allowed to do.' },
      { q: 'Can bots run up a huge bill talking to each other?', a: 'Rooms have limits on depth, hops and cost per chain, and every run shows what it spent. When a limit is reached, the team stops and tells you.' },
      { q: 'Where does my data go?', a: 'When you self-host, it stays on your machine or server. Secrets live in a vault, and bots only get references to them, never the values.' },
      { q: 'Can I use it from my phone?', a: 'Yes. Pair your phone with a QR code to approve actions, reply, and watch a bot’s screen from anywhere.' },
    ],
  },
  cta: {
    title: 'Meet your first bot',
    lead: 'Install the app, give Capy a job, and watch it work.',
    download: 'Download for macOS',
    selfHost: 'Self-host',
    avatars: 'A crowd of Brot bots, each a different Brazilian animal',
  },
  footer: {
    tagline: 'Born in Brazil, built for everyone.',
    license: 'AGPL-3.0',
    status: 'Brot is in early development.',
    product: 'Product',
    resources: 'Resources',
    source: 'Source code',
    changelog: 'Changelog',
    selfHostGuide: 'Self-host guide',
  },
};

const ptBR: Dict = {
  meta: {
    title: 'Brot · Um time de bots de IA, cada um com seu computador',
    description:
      'Bots de IA de código aberto em um app de chat. Cada um tem uma função, qualquer modelo, seu próprio computador que você assiste e assume, e uma memória que você pode ler. Hospede com docker compose ou aguarde o Brot Cloud.',
  },
  nav: {
    label: 'Principal',
    product: 'Produto',
    computer: 'Computador',
    useCases: 'Casos de uso',
    pricing: 'Preços',
    faq: 'Dúvidas',
    github: 'GitHub',
    language: 'Idioma',
    skip: 'Pular para o conteúdo',
    download: 'Baixar',
  },
  hero: {
    chipNew: 'Novo',
    chipAvailable: 'Disponível para',
    meet: 'Conheça o',
    lead: 'Um time de bots de IA com funções de verdade e computadores próprios. Eles trabalham num chat, conversam entre si e pedem sua aprovação antes de qualquer coisa sem volta.',
    download: 'Baixar para macOS',
    otherPlatforms: 'Outras plataformas',
    platformNote: { macOS: 'App desktop', Windows: 'App desktop', Linux: 'App desktop ou servidor', iOS: 'Controle remoto', Android: 'Controle remoto' },
    selfHost: 'Hospedar',
    note: 'Gratuito e de código aberto. Use o seu modelo.',
    avatar: 'Capy, a capivara',
  },
  demo: {
    summary:
      'Um exemplo ao vivo do app Brot. Na sala acme-renewal você pede à Capy que prepare a renovação da Acme. A Capy passa um bug para a Onça e um e-mail para o Tuca. A Onça corrige o bug no próprio computador enquanto você assiste. O Tuca escreve o e-mail e pede sua aprovação antes de enviar.',
    workspace: 'Acme Studio',
    search: 'Buscar',
    roomsLabel: 'Salas',
    botsLabel: 'Bots',
    room: 'acme-renewal',
    otherRooms: ['launch', 'conteudo-semanal'],
    roomMeta: '4 bots · você',
    roles: {
      capy: 'Chefe de gabinete',
      onca: 'Corrige bugs',
      tuca: 'Follow-up de vendas',
      tamu: 'Pesquisadora',
      lobo: 'Revisor',
      jabu: 'Contador',
      bento: 'Vigia',
      arara: 'Redatora',
    },
    status: { idle: 'Livre', working: 'Trabalhando', waiting: 'Esperando você', done: 'Pronto', sleeping: 'Dormindo' },
    you: 'Você',
    messages: {
      user: '@Capy deixa a renovação da Acme pronta até sexta.',
      capy: 'Pode deixar. @Onça, consegue corrigir o bug de exportação CSV que a Acme reportou? @Tuca, escreve o e-mail de renovação para a Ana.',
      onca: 'Reproduzi no meu computador e adicionei um teste que falha. A correção passou, e o rascunho do PR está pronto para o @Lobo.',
      tuca: 'O rascunho para a Ana está pronto, com os novos preços e um horário para conversar. Posso enviar?',
      sent: 'Enviado. Aviso quando a Ana responder.',
    },
    handoff: 'A Capy passou duas tarefas para a Onça e o Tuca',
    tool: { name: 'shell', summary: 'pnpm test export · 48 passaram' },
    approval: {
      kind: 'Enviar',
      title: 'Enviar o e-mail de renovação para a Ana?',
      meta: 'gmail.send · ana@acme.example',
      allowOnce: 'Permitir uma vez',
      allowAlways: 'Sempre permitir',
      deny: 'Negar',
      allowed: 'Permitido uma vez',
    },
    typing: 'está digitando',
    composer: 'Mensagem em #acme-renewal',
    computer: {
      title: 'Computador da Onça',
      live: 'Ao vivo',
      takeOver: 'Assumir',
      steps: ['Abrindo a issue', 'Lendo o relato', 'Rodando os testes', 'Abrindo o rascunho do PR'],
    },
    terminal: ['$ pnpm test export', '✕ mantém o fuso horário nas datas', '✓ 48 passaram'],
    tabs: ['Computador', 'Memória', 'Custo'],
  },
  features: {
    title: 'O que o Brot faz',
    lead: 'Um app para um time de bots de IA. Cada um tem uma função, um computador e o modelo que você escolher.',
    job: { title: 'Bots com uma função', body: 'Comece de um papel pronto ou escreva o seu. Cada bot tem nome, instruções, apps e orçamento.' },
    computer: {
      title: 'Um computador só dele',
      body: 'Cada bot trabalha num desktop isolado. Assista à tela ao vivo e assuma quando quiser.',
    },
    rooms: {
      title: 'Times que conversam',
      body: 'Coloque bots numa sala. Eles se mencionam, passam trabalho adiante e param nos limites que você define.',
      bubble: '@Onça pode pegar o bug da exportação?',
    },
    approvals: {
      title: 'Você aprova o que importa',
      body: 'Pagamentos, posts, envios e exclusões esperam por você. Permita uma vez, sempre, ou nunca.',
      card: 'Publicar a nota de versão?',
      meta: 'blog.publish · Arara',
      allow: 'Permitir uma vez',
      deny: 'Negar',
    },
    memory: {
      title: 'Memória que você lê',
      body: 'Tudo o que um bot lembra é visível, editável e exportável. Nada de caixa-preta.',
      items: ['A Ana prefere ligações de manhã', 'A Acme renova no dia 24', 'Escrever para a Lucía em espanhol'],
      edit: 'Editar',
    },
    models: {
      title: 'Qualquer modelo',
      body: 'Escolha o provedor de cada bot: um plano que você já paga, uma chave de API ou um modelo na sua máquina.',
      local: 'Modelos locais',
    },
    selfhost: { title: 'Roda na sua máquina', body: 'Um comando em qualquer servidor com Docker. Seus dados ficam nos seus discos.' },
  },
  works: {
    title: 'Funciona com o que você usa',
    models: 'Modelos',
    apps: 'Apps, via MCP',
    note: 'Os nomes pertencem aos seus donos. O Brot não é afiliado a eles.',
  },
  computer: {
    eyebrow: 'Uso do computador',
    title: 'Veja trabalhar. Assuma o controle.',
    lead: 'O computador de um bot é um desktop de verdade, com navegador. Você vê cada clique ao vivo, no notebook ou no celular.',
    points: [
      { title: 'Ele te passa as partes difíceis', body: 'Logins, códigos 2FA e CAPTCHAs ficam com você. O bot espera e nunca tenta contorná-los.' },
      { title: 'Segredos ficam com você', body: 'Você digita senhas durante o controle. O bot não as vê, nem o modelo dele.' },
      { title: 'Regras de rede próprias', body: 'Cada computador só acessa os sites que você permite. O resto é bloqueado e registrado.' },
    ],
    demo: {
      label:
        'Exemplo: o Tuca abre um CRM no navegador e chega a uma página de login. O Tuca pede que você assuma. Você assume, entra e devolve o controle. O Tuca tira um novo snapshot da página e continua.',
      bot: 'Tuca',
      url: 'crm.acme.example/login',
      pageTitle: 'Entrar no Acme CRM',
      email: 'E-mail',
      password: 'Senha',
      signIn: 'Entrar',
      request: 'O CRM pede login. Você pode assumir daqui?',
      takeControl: 'Assumir controle',
      giveBack: 'Devolver controle',
      youHave: 'Você está no controle',
      botWaits: 'Tuca está esperando',
      back: 'O controle voltou. Tirando um novo snapshot.',
      snapshotTitle: 'O que o Tuca vê',
    },
  },
  useCases: {
    title: 'Coloque um bot nisso',
    lead: 'Trabalhos que as pessoas já passam para o Brot. Comece lendo e preparando, depois adicione aprovações e rotinas.',
    items: [
      { bot: 'onca', title: 'Do bug ao PR', body: 'Clona o repositório, reproduz o problema, escreve um teste que falha e corrige até passar.', tag: 'Abrir o PR depende de você' },
      { bot: 'capy', title: 'Resumo da manhã', body: 'O que mudou durante a noite e o que precisa de decisão, cada item com fonte e próximo passo.', tag: 'Rotina · 08:00' },
      { bot: 'tuca', title: 'Follow-ups de vendas', body: 'Pontua contas contra o seu cliente ideal e escreve cada e-mail. Nada sai sozinho.', tag: 'Envios dependem de você' },
      { bot: 'tamu', title: 'Monitor de concorrentes', body: 'Guarda as páginas de preço e changelog e avisa só o que mudou de verdade.', tag: 'Rotina · semanal' },
      { bot: 'jabu', title: 'Conciliação de despesas', body: 'Cruza recibos com o razão e aponta exceções à política, citando a regra.', tag: 'Só leitura' },
      { bot: 'lobo', title: 'Auditoria noturna', body: 'Roda lint, testes e auditoria de dependências toda noite e prepara as correções seguras.', tag: 'Rotina · noturna' },
      { bot: 'bento', title: 'Vigia de status', body: 'Olha uma página de status a cada 15 minutos e só avisa no celular quando algo muda.', tag: 'Push no celular' },
      { bot: 'arara', title: 'Time de conteúdo', body: 'Transforma um changelog em nota de versão e post, revisados por outro bot antes de chegar a você.', tag: 'Publicar depende de você' },
    ],
  },
  pricing: {
    title: 'Quanto custa',
    lead: 'Hospedar por conta própria é grátis, com todos os recursos. Você paga direto o provedor do modelo, ou usa um modelo local.',
    self: {
      name: 'Hospedagem própria',
      price: 'R$ 0',
      per: 'para sempre',
      body: 'O app desktop ou o seu servidor. AGPL-3.0.',
      points: ['Bots e salas ilimitados', 'Um computador isolado por bot', 'Pareamento com o celular', 'Todos os recursos, sem nada guardado'],
      cta: 'Baixar',
      badge: 'Disponível agora',
    },
    cloudTitle: 'Brot Cloud',
    soon: 'Em breve',
    plans: [
      { name: 'Free', for: 'Para experimentar', points: ['1 bot, 1 computador', 'Minutos de computação limitados', 'Suporte da comunidade'] },
      { name: 'Baker', for: 'Fundadores solo', points: ['Alguns bots sempre ligados', 'Rotinas e push no celular', 'Suporte por e-mail'] },
      { name: 'Bakery', for: 'Times de 2 a 20', points: ['Bots, apps e memória compartilhados', 'Papéis e log de auditoria', 'Suporte prioritário'] },
      { name: 'Enterprise', for: 'Times regulados', points: ['SSO, SCIM, região fixa', 'Computadores dedicados', 'SLA e DPA'] },
    ],
    note: 'Planos e preços do Cloud ainda não são finais. Nada está à venda ainda.',
    waitlist: 'Acompanhe as novidades no GitHub',
  },
  faq: {
    title: 'Dúvidas',
    lead: 'Respostas curtas sobre preço, modelos, segurança e seus dados.',
    ask: 'Pergunte no GitHub',
    items: [
      { q: 'O Brot é grátis?', a: 'Sim. Hospedar por conta própria é grátis e tem todos os recursos. Você paga o provedor do modelo, ou nada com um modelo local. O Brot Cloud será uma opção paga e hospedada para quem não quer manter um servidor.' },
      { q: 'É código aberto?', a: 'Sim, sob AGPL-3.0. Você pode ler, rodar e mudar cada linha. Quem oferecer um Brot modificado como serviço também precisa compartilhar as mudanças.' },
      { q: 'Quais modelos um bot pode usar?', a: 'Cada bot escolhe o próprio provedor e modelo: OpenCode Go, DeepSeek, OpenAI, a API da Anthropic, OpenRouter, qualquer endpoint compatível com OpenAI ou um modelo local como o Ollama. Não usamos assinaturas de consumidor cujos termos proíbem isso.' },
      { q: 'O que é o computador de um bot?', a: 'Um desktop Linux isolado com navegador, um por bot. Bots não compartilham logins nem arquivos, e um computador travado não para os outros. Você assiste ao vivo e assume quando quiser.' },
      { q: 'Um bot faz algo sem perguntar?', a: 'Nada que importe. Pagamentos, compras, posts, envios, exclusões e mudanças de permissão esperam sua aprovação. Delegar para outro bot nunca amplia o que ele pode fazer.' },
      { q: 'Bots conversando entre si podem gerar uma conta enorme?', a: 'As salas têm limites de profundidade, saltos e custo por cadeia, e cada execução mostra quanto gastou. Quando um limite é atingido, o time para e te avisa.' },
      { q: 'Para onde vão meus dados?', a: 'Hospedando por conta própria, ficam na sua máquina ou servidor. Segredos ficam num cofre, e os bots só recebem referências, nunca os valores.' },
      { q: 'Dá para usar pelo celular?', a: 'Sim. Pareie o celular com um QR code para aprovar ações, responder e ver a tela de um bot de qualquer lugar.' },
    ],
  },
  cta: {
    title: 'Conheça seu primeiro bot',
    lead: 'Instale o app, dê uma função para a Capy e veja ela trabalhar.',
    download: 'Baixar para macOS',
    selfHost: 'Hospedar',
    avatars: 'Uma turma de bots do Brot, cada um um animal brasileiro',
  },
  footer: {
    tagline: 'Nascido no Brasil, feito para todo mundo.',
    license: 'AGPL-3.0',
    status: 'O Brot está em desenvolvimento inicial.',
    product: 'Produto',
    resources: 'Recursos',
    source: 'Código-fonte',
    changelog: 'Changelog',
    selfHostGuide: 'Guia de hospedagem',
  },
};

const es: Dict = {
  meta: {
    title: 'Brot · Un equipo de bots de IA, cada uno con su computadora',
    description:
      'Bots de IA de código abierto en una app de chat. Cada uno tiene un trabajo, cualquier modelo, su propia computadora que puedes ver y tomar, y una memoria que puedes leer. Alójalo con docker compose o espera Brot Cloud.',
  },
  nav: {
    label: 'Principal',
    product: 'Producto',
    computer: 'Computadora',
    useCases: 'Casos de uso',
    pricing: 'Precios',
    faq: 'Preguntas',
    github: 'GitHub',
    language: 'Idioma',
    skip: 'Saltar al contenido',
    download: 'Descargar',
  },
  hero: {
    chipNew: 'Nuevo',
    chipAvailable: 'Disponible en',
    meet: 'Conoce a',
    lead: 'Un equipo de bots de IA con trabajos reales y sus propias computadoras. Trabajan en un chat, hablan entre ellos y te preguntan antes de cualquier cosa que no se pueda deshacer.',
    download: 'Descargar para macOS',
    otherPlatforms: 'Otras plataformas',
    platformNote: { macOS: 'App de escritorio', Windows: 'App de escritorio', Linux: 'App de escritorio o servidor', iOS: 'Control remoto', Android: 'Control remoto' },
    selfHost: 'Autoalojar',
    note: 'Gratis y de código abierto. Usa tu propio modelo.',
    avatar: 'Capy, la capibara',
  },
  demo: {
    summary:
      'Un ejemplo en vivo de la app Brot. En la sala acme-renewal le pides a Capy que prepare la renovación de Acme. Capy le pasa un bug a Onça y un correo a Tuca. Onça corrige el bug en su propia computadora mientras miras. Tuca redacta el correo y pide tu aprobación antes de enviarlo.',
    workspace: 'Acme Studio',
    search: 'Buscar',
    roomsLabel: 'Salas',
    botsLabel: 'Bots',
    room: 'acme-renewal',
    otherRooms: ['launch', 'contenido-semanal'],
    roomMeta: '4 bots · tú',
    roles: {
      capy: 'Jefa de gabinete',
      onca: 'Arregla bugs',
      tuca: 'Seguimiento de ventas',
      tamu: 'Investigadora',
      lobo: 'Revisor',
      jabu: 'Contable',
      bento: 'Vigía',
      arara: 'Redactora',
    },
    status: { idle: 'Libre', working: 'Trabajando', waiting: 'Te espera', done: 'Listo', sleeping: 'Durmiendo' },
    you: 'Tú',
    messages: {
      user: '@Capy deja lista la renovación de Acme para el viernes.',
      capy: 'Hecho. @Onça, ¿puedes arreglar el bug de exportación CSV que reportó Acme? @Tuca, redacta el correo de renovación para Ana.',
      onca: 'Lo reproduje en mi computadora y agregué una prueba que falla. El arreglo pasa, y el borrador del PR está listo para @Lobo.',
      tuca: 'El borrador para Ana está listo, con los nuevos precios y una hora para hablar. ¿Lo envío?',
      sent: 'Enviado. Te aviso cuando Ana responda.',
    },
    handoff: 'Capy les pasó dos tareas a Onça y Tuca',
    tool: { name: 'shell', summary: 'pnpm test export · 48 pasaron' },
    approval: {
      kind: 'Enviar',
      title: '¿Enviar el correo de renovación a Ana?',
      meta: 'gmail.send · ana@acme.example',
      allowOnce: 'Permitir una vez',
      allowAlways: 'Permitir siempre',
      deny: 'Denegar',
      allowed: 'Permitido una vez',
    },
    typing: 'está escribiendo',
    composer: 'Mensaje en #acme-renewal',
    computer: {
      title: 'Computadora de Onça',
      live: 'En vivo',
      takeOver: 'Tomar control',
      steps: ['Abriendo el issue', 'Leyendo el reporte', 'Corriendo las pruebas', 'Abriendo un borrador de PR'],
    },
    terminal: ['$ pnpm test export', '✕ conserva la zona horaria en fechas', '✓ 48 pasaron'],
    tabs: ['Computadora', 'Memoria', 'Costo'],
  },
  features: {
    title: 'Qué hace Brot',
    lead: 'Una app para un equipo de bots de IA. Cada uno tiene un trabajo, una computadora y el modelo que elijas.',
    job: { title: 'Bots con un trabajo', body: 'Empieza desde un rol o escribe el tuyo. Cada bot tiene nombre, instrucciones, apps y presupuesto.' },
    computer: {
      title: 'Su propia computadora',
      body: 'Cada bot trabaja en su propio escritorio aislado. Mira la pantalla en vivo y toma el control cuando quieras.',
    },
    rooms: {
      title: 'Equipos que conversan',
      body: 'Pon bots en una sala. Se mencionan, se pasan el trabajo y se detienen en los límites que definas.',
      bubble: '@Onça ¿puedes tomar el bug de exportación?',
    },
    approvals: {
      title: 'Tú apruebas lo importante',
      body: 'Pagos, publicaciones, envíos y borrados te esperan. Permite una vez, siempre o nunca.',
      card: '¿Publicar la nota de versión?',
      meta: 'blog.publish · Arara',
      allow: 'Permitir una vez',
      deny: 'Denegar',
    },
    memory: {
      title: 'Memoria que puedes leer',
      body: 'Todo lo que un bot recuerda es visible, editable y exportable. Sin caja negra.',
      items: ['Ana prefiere llamadas por la mañana', 'Acme renueva el día 24', 'Escribirle a Lucía en español'],
      edit: 'Editar',
    },
    models: {
      title: 'Cualquier modelo',
      body: 'Elige un proveedor por bot: un plan que ya pagas, una clave de API o un modelo en tu propia máquina.',
      local: 'Modelos locales',
    },
    selfhost: { title: 'Corre en tu máquina', body: 'Un comando en cualquier servidor con Docker. Tus datos se quedan en tus discos.' },
  },
  works: {
    title: 'Funciona con lo que ya usas',
    models: 'Modelos',
    apps: 'Apps, vía MCP',
    note: 'Los nombres pertenecen a sus dueños. Brot no está afiliado a ellos.',
  },
  computer: {
    eyebrow: 'Uso de computadora',
    title: 'Míralo trabajar. Toma el volante.',
    lead: 'La computadora de un bot es un escritorio real con navegador. Ves cada clic en vivo, en tu laptop o tu teléfono.',
    points: [
      { title: 'Te pasa las partes difíciles', body: 'Inicios de sesión, códigos 2FA y CAPTCHAs van para ti. El bot espera y nunca intenta saltárselos.' },
      { title: 'Los secretos se quedan contigo', body: 'Escribes las contraseñas mientras tienes el control. El bot no las ve, ni su modelo.' },
      { title: 'Sus propias reglas de red', body: 'Cada computadora solo llega a los sitios que permites. Lo demás se bloquea y se registra.' },
    ],
    demo: {
      label:
        'Ejemplo: Tuca abre un CRM en su navegador y llega a una página de inicio de sesión. Tuca te pide que tomes el control. Lo tomas, inicias sesión y devuelves el control. Tuca toma un nuevo snapshot de la página y sigue.',
      bot: 'Tuca',
      url: 'crm.acme.example/login',
      pageTitle: 'Inicia sesión en Acme CRM',
      email: 'Correo',
      password: 'Contraseña',
      signIn: 'Entrar',
      request: 'El CRM pide iniciar sesión. ¿Puedes seguir tú?',
      takeControl: 'Tomar control',
      giveBack: 'Devolver control',
      youHave: 'Tienes el control',
      botWaits: 'Tuca está esperando',
      back: 'El control volvió. Tomando un nuevo snapshot.',
      snapshotTitle: 'Lo que ve Tuca',
    },
  },
  useCases: {
    title: 'Pon un bot en eso',
    lead: 'Trabajos que la gente ya le pasa a Brot. Empieza leyendo y preparando, luego agrega aprobaciones y rutinas.',
    items: [
      { bot: 'onca', title: 'Del bug al PR', body: 'Clona el repo, reproduce el problema, escribe una prueba que falla y corrige hasta que pasa.', tag: 'Abrir el PR depende de ti' },
      { bot: 'capy', title: 'Resumen matutino', body: 'Qué cambió durante la noche y qué necesita una decisión, cada punto con su fuente y siguiente paso.', tag: 'Rutina · 08:00' },
      { bot: 'tuca', title: 'Seguimiento de ventas', body: 'Puntúa cuentas contra tu cliente ideal y redacta cada correo. Nada sale solo.', tag: 'Los envíos dependen de ti' },
      { bot: 'tamu', title: 'Vigilar competidores', body: 'Guarda las páginas de precios y changelog y reporta solo lo que cambió de verdad.', tag: 'Rutina · semanal' },
      { bot: 'jabu', title: 'Conciliar gastos', body: 'Cruza recibos con el libro mayor y marca excepciones a la política, citando la regla.', tag: 'Solo lectura' },
      { bot: 'lobo', title: 'Auditoría nocturna', body: 'Corre lint, pruebas y auditoría de dependencias cada noche y prepara los arreglos seguros.', tag: 'Rutina · nocturna' },
      { bot: 'bento', title: 'Vigía de estado', body: 'Revisa una página de estado cada 15 minutos y solo avisa a tu teléfono cuando cambia.', tag: 'Aviso al teléfono' },
      { bot: 'arara', title: 'Equipo de contenido', body: 'Convierte un changelog en nota de versión y publicación, revisadas por otro bot antes de llegarte.', tag: 'Publicar depende de ti' },
    ],
  },
  pricing: {
    title: 'Cuánto cuesta',
    lead: 'Autoalojar es gratis, con todas las funciones. Le pagas directo a tu proveedor de modelos, o usas un modelo local.',
    self: {
      name: 'Autoalojado',
      price: '$0',
      per: 'para siempre',
      body: 'La app de escritorio o tu propio servidor. AGPL-3.0.',
      points: ['Bots y salas ilimitados', 'Una computadora aislada por bot', 'Emparejamiento con el teléfono', 'Todas las funciones, sin reservas'],
      cta: 'Descargar',
      badge: 'Disponible ya',
    },
    cloudTitle: 'Brot Cloud',
    soon: 'Próximamente',
    plans: [
      { name: 'Free', for: 'Para probar', points: ['1 bot, 1 computadora', 'Minutos de cómputo limitados', 'Soporte de la comunidad'] },
      { name: 'Baker', for: 'Fundadores solos', points: ['Algunos bots siempre encendidos', 'Rutinas y avisos al teléfono', 'Soporte por correo'] },
      { name: 'Bakery', for: 'Equipos de 2 a 20', points: ['Bots, apps y memoria compartidos', 'Roles y registro de auditoría', 'Soporte prioritario'] },
      { name: 'Enterprise', for: 'Equipos regulados', points: ['SSO, SCIM, región fija', 'Computadoras dedicadas', 'SLA y DPA'] },
    ],
    note: 'Los planes y precios de Cloud no son finales. Todavía no hay nada a la venta.',
    waitlist: 'Sigue las novedades en GitHub',
  },
  faq: {
    title: 'Preguntas',
    lead: 'Respuestas cortas sobre precio, modelos, seguridad y tus datos.',
    ask: 'Pregunta en GitHub',
    items: [
      { q: '¿Brot es gratis?', a: 'Sí. Autoalojarlo es gratis y tiene todas las funciones. Le pagas a tu proveedor de modelos, o nada con un modelo local. Brot Cloud será una opción alojada y de pago para quien no quiera mantener un servidor.' },
      { q: '¿Es de código abierto?', a: 'Sí, bajo AGPL-3.0. Puedes leer, correr y cambiar cada línea. Si alguien ofrece un Brot modificado como servicio, también tiene que compartir sus cambios.' },
      { q: '¿Qué modelos puede usar un bot?', a: 'Cada bot elige su propio proveedor y modelo: OpenCode Go, DeepSeek, OpenAI, la API de Anthropic, OpenRouter, cualquier endpoint compatible con OpenAI o un modelo local como Ollama. No usamos suscripciones de consumidor cuyos términos lo prohíben.' },
      { q: '¿Qué es la computadora de un bot?', a: 'Un escritorio Linux aislado con navegador, uno por bot. Los bots no comparten sesiones ni archivos, y una computadora trabada no detiene a las demás. Puedes verla en vivo y tomar el control cuando quieras.' },
      { q: '¿Un bot hará algo sin preguntar?', a: 'Nada que importe. Pagos, compras, publicaciones, envíos, borrados y cambios de permisos esperan tu aprobación. Delegar a otro bot nunca amplía lo que puede hacer.' },
      { q: '¿Los bots pueden gastar muchísimo hablando entre ellos?', a: 'Las salas tienen límites de profundidad, saltos y costo por cadena, y cada ejecución muestra lo que gastó. Al llegar a un límite, el equipo se detiene y te avisa.' },
      { q: '¿Adónde van mis datos?', a: 'Si lo autoalojas, se quedan en tu máquina o servidor. Los secretos viven en una bóveda, y los bots solo reciben referencias, nunca los valores.' },
      { q: '¿Puedo usarlo desde el teléfono?', a: 'Sí. Empareja tu teléfono con un código QR para aprobar acciones, responder y ver la pantalla de un bot desde cualquier lugar.' },
    ],
  },
  cta: {
    title: 'Conoce a tu primer bot',
    lead: 'Instala la app, dale un trabajo a Capy y mírala trabajar.',
    download: 'Descargar para macOS',
    selfHost: 'Autoalojar',
    avatars: 'Un grupo de bots de Brot, cada uno un animal brasileño',
  },
  footer: {
    tagline: 'Nacido en Brasil, hecho para todos.',
    license: 'AGPL-3.0',
    status: 'Brot está en desarrollo temprano.',
    product: 'Producto',
    resources: 'Recursos',
    source: 'Código fuente',
    changelog: 'Changelog',
    selfHostGuide: 'Guía para autoalojar',
  },
};

const DICTS: Record<Locale, Dict> = { en, 'pt-BR': ptBR, es };

export function isLocale(value: string | undefined): value is Locale {
  return (LOCALES as readonly string[]).includes(value ?? '');
}

export function dict(locale: string | undefined): Dict {
  return DICTS[isLocale(locale) ? locale : DEFAULT_LOCALE];
}

export function localePath(locale: Locale, hash = ''): string {
  const base = locale === DEFAULT_LOCALE ? '/' : `/${locale}/`;
  return `${base}${hash}`;
}
