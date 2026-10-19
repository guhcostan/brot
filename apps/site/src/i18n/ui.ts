import type { AvatarColor, AvatarMood, AvatarShape, BotStatus } from '@brot/ui';

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

export type FeatureIcon = 'model' | 'computer' | 'apps' | 'memory' | 'approval' | 'phone';

export interface TeamBot {
  name: string;
  role: string;
  job: string;
  shape: AvatarShape;
  color: AvatarColor;
  status: BotStatus;
  mood: AvatarMood;
  statusLabel: string;
}

export interface Dict {
  meta: { title: string; description: string };
  nav: { label: string; team: string; how: string; deploy: string; source: string; github: string; language: string; skip: string };
  hero: { eyebrow: string; title: string; lead: string; download: string; cloud: string; note: string; avatars: string };
  team: { title: string; lead: string; bots: TeamBot[] };
  how: { title: string; lead: string; features: Array<{ icon: FeatureIcon; title: string; body: string }> };
  chat: {
    title: string;
    lead: string;
    srSummary: string;
    bots: string;
    search: string;
    pinned: string;
    header: string;
    user: string;
    userTime: string;
    reply: string;
    replyTime: string;
    toolSummary: string;
    approvalKind: string;
    approvalTitle: string;
    approvalMeta: string;
    allowOnce: string;
    allowAlways: string;
    deny: string;
    composer: string;
    computer: string;
    computerCaption: string;
    takeOver: string;
    tabs: [string, string, string];
    screen: string[];
    memory: string[];
  };
  deploy: {
    title: string;
    lead: string;
    self: { name: string; tag: string; body: string; points: string[]; cta: string };
    cloud: { name: string; tag: string; body: string; points: string[]; cta: string };
  };
  waitlist: { title: string; body: string; cta: string };
  source: { title: string; body: string; license: string; cta: string; codeLabel: string };
  footer: { tagline: string; license: string; status: string };
}

const en: Dict = {
  meta: {
    title: 'Brot · A team of AI bots that works for you',
    description:
      'Open-source AI bots in a chat app. Each one has a job, any model, its own sandboxed computer, your apps, and memory you can read. Self-host it or use Brot Cloud.',
  },
  nav: {
    label: 'Main',
    team: 'Team',
    how: 'How it works',
    deploy: 'Self-host or Cloud',
    source: 'Open source',
    github: 'GitHub',
    language: 'Language',
    skip: 'Skip to content',
  },
  hero: {
    eyebrow: 'Open source · AGPL-3.0',
    title: 'A team of AI bots that never clocks out.',
    lead: 'Give each bot a job, a model and its own computer. They work in a chat you already know, and ask before anything they can’t undo.',
    download: 'Download',
    cloud: 'Start on Brot Cloud',
    note: 'Free to self-host. Bring your own model keys.',
    avatars: 'Seven Brot bots, each a different shape and color',
  },
  team: {
    title: 'Meet a team',
    lead: 'Each bot has a name, a job and a way of working. Start from a role, or write your own.',
    bots: [
      { name: 'Capy', role: 'Chief of staff', job: 'Sorts your inbox, keeps the calendar honest, and writes the morning brief.', shape: 'cloud', color: 'teal', status: 'idle', mood: 'idle', statusLabel: 'Idle' },
      { name: 'Onça', role: 'Bug fixer', job: 'Reproduces the issue in its own sandbox and opens a pull request with the fix.', shape: 'triangle', color: 'orange', status: 'working', mood: 'thinking', statusLabel: 'Working · running tests' },
      { name: 'Tuca', role: 'Sales follow-up', job: 'Drafts follow-ups from your CRM and waits for your OK before anything is sent.', shape: 'circle', color: 'violet', status: 'waiting', mood: 'approval', statusLabel: 'Waiting for you' },
      { name: 'Jabu', role: 'Support triage', job: 'Labels new tickets, answers the common ones, and hands you the rest.', shape: 'blob', color: 'blue', status: 'ok', mood: 'idle', statusLabel: 'Done · 14 tickets sorted' },
      { name: 'Iara', role: 'Researcher', job: 'Reads widely, cites every source, and says what it couldn’t verify.', shape: 'drop', color: 'pink', status: 'idle', mood: 'idle', statusLabel: 'Idle' },
      { name: 'Bento', role: 'Bookkeeper', job: 'Matches receipts to transactions and flags what doesn’t add up.', shape: 'tilted', color: 'amber', status: 'sleeping', mood: 'sleeping', statusLabel: 'Sleeping · next run 07:00' },
    ],
  },
  how: {
    title: 'How it works',
    lead: 'Every bot has one job. Here’s what it gets to do it well.',
    features: [
      { icon: 'model', title: 'Any model', body: 'Bots run on the DeepSeek Harness, so you pick the provider: a subscription, an API key, or a local model.' },
      { icon: 'computer', title: 'Its own computer', body: 'Each bot works in a sandboxed computer. Watch the screen live and take over whenever you want.' },
      { icon: 'apps', title: 'Your apps', body: 'Connect email, calendar, code and CRM. Secrets stay in the vault; the model only ever sees a reference.' },
      { icon: 'memory', title: 'Memory you can read', body: 'Everything a bot remembers is visible, editable and exportable. No black box.' },
      { icon: 'approval', title: 'You approve what matters', body: 'Payments, posts, sends and deletions pause until you say yes. Allow once, always, or not at all.' },
      { icon: 'phone', title: 'From your phone', body: 'Scan a QR code to pair your phone. Approve, reply and watch your bots from anywhere.' },
    ],
  },
  chat: {
    title: 'It’s just a chat',
    lead: 'Talk to a bot like a coworker. See each step it takes, and decide on the ones that matter.',
    srSummary:
      'Example: you ask Tuca to follow up with three leads from a demo. Tuca searches the CRM, drafts three emails, and asks for approval before sending them.',
    bots: 'Bots',
    search: 'Search',
    pinned: 'Pinned',
    header: 'Sales follow-up',
    user: 'Follow up with the three leads from Tuesday’s demo.',
    userTime: '09:12',
    reply: 'Found them in the CRM. I drafted a short note for each, with the recording link and a time to talk next week.',
    replyTime: '09:13',
    toolSummary: 'leads where demo = Tuesday',
    approvalKind: 'Send',
    approvalTitle: 'Send 3 follow-up emails?',
    approvalMeta: 'gmail.send · to Ana, Rafael, Lucía',
    allowOnce: 'Allow once',
    allowAlways: 'Allow always',
    deny: 'Deny',
    composer: 'Message Tuca',
    computer: 'Computer',
    computerCaption: 'Live · sandbox',
    takeOver: 'Take over',
    tabs: ['Memory', 'Skills', 'Apps'],
    screen: ['To: ana@example.com', 'Subject: Great to meet you Tuesday', 'Hi Ana, thanks for joining the demo…'],
    memory: ['Ana prefers mornings', 'Rafael asked about SSO', 'Write to Lucía in Spanish'],
  },
  deploy: {
    title: 'Yours, or hosted',
    lead: 'The same Brot either way. Nothing is held back from self-hosting.',
    self: {
      name: 'Self-host',
      tag: 'Free',
      body: 'Run it on your laptop or your own server. Your data stays on your machines.',
      points: ['Desktop app or docker compose', 'Bring your own model keys', 'Every feature included'],
      cta: 'Download',
    },
    cloud: {
      name: 'Brot Cloud',
      tag: 'Coming soon',
      body: 'We keep the oven hot. Always-on bots that don’t stop when your laptop sleeps.',
      points: ['A managed computer per bot', 'Backups, team seats and support', 'Phone push without opening ports'],
      cta: 'Join the waitlist',
    },
  },
  waitlist: {
    title: 'Brot Cloud isn’t open yet',
    body: 'Watch the repository on GitHub and you’ll hear when it opens. Until then, self-hosting has every feature.',
    cta: 'Watch on GitHub',
  },
  source: {
    title: 'Open source, all the way down',
    body: 'Read every line, run it anywhere, change what you like. Brot is AGPL-3.0, so hosted forks share their changes too.',
    license: 'AGPL-3.0',
    cta: 'View on GitHub',
    codeLabel: 'Run Brot from source',
  },
  footer: {
    tagline: 'Born in Brazil, built for everyone.',
    license: 'Licensed under AGPL-3.0',
    status: 'Brot is in early development.',
  },
};

const ptBR: Dict = {
  meta: {
    title: 'Brot · Um time de bots de IA que trabalha para você',
    description:
      'Bots de IA de código aberto em um app de chat. Cada um tem uma função, qualquer modelo, seu próprio computador isolado, seus apps e uma memória que você pode ler. Hospede você mesmo ou use o Brot Cloud.',
  },
  nav: {
    label: 'Principal',
    team: 'Time',
    how: 'Como funciona',
    deploy: 'Próprio ou Cloud',
    source: 'Código aberto',
    github: 'GitHub',
    language: 'Idioma',
    skip: 'Pular para o conteúdo',
  },
  hero: {
    eyebrow: 'Código aberto · AGPL-3.0',
    title: 'Um time de bots de IA que nunca bate o ponto.',
    lead: 'Dê a cada bot uma função, um modelo e um computador só dele. Eles trabalham num chat que você já conhece e pedem sua permissão antes de qualquer coisa que não dá para desfazer.',
    download: 'Baixar',
    cloud: 'Começar no Brot Cloud',
    note: 'Grátis para hospedar você mesmo. Use suas próprias chaves de modelo.',
    avatars: 'Sete bots do Brot, cada um com forma e cor diferentes',
  },
  team: {
    title: 'Conheça um time',
    lead: 'Cada bot tem nome, função e um jeito de trabalhar. Comece a partir de um papel ou escreva o seu.',
    bots: [
      { name: 'Capy', role: 'Chefe de gabinete', job: 'Organiza sua caixa de entrada, mantém a agenda em dia e escreve o resumo da manhã.', shape: 'cloud', color: 'teal', status: 'idle', mood: 'idle', statusLabel: 'Disponível' },
      { name: 'Onça', role: 'Caçadora de bugs', job: 'Reproduz o problema no próprio sandbox e abre um pull request com a correção.', shape: 'triangle', color: 'orange', status: 'working', mood: 'thinking', statusLabel: 'Trabalhando · rodando testes' },
      { name: 'Tuca', role: 'Follow-up de vendas', job: 'Escreve follow-ups a partir do seu CRM e espera seu OK antes de enviar qualquer coisa.', shape: 'circle', color: 'violet', status: 'waiting', mood: 'approval', statusLabel: 'Esperando você' },
      { name: 'Jabu', role: 'Triagem de suporte', job: 'Classifica os chamados novos, responde os comuns e passa o resto para você.', shape: 'blob', color: 'blue', status: 'ok', mood: 'idle', statusLabel: 'Pronto · 14 chamados organizados' },
      { name: 'Iara', role: 'Pesquisadora', job: 'Lê de tudo, cita cada fonte e diz o que não conseguiu confirmar.', shape: 'drop', color: 'pink', status: 'idle', mood: 'idle', statusLabel: 'Disponível' },
      { name: 'Bento', role: 'Contador', job: 'Concilia recibos com transações e aponta o que não fecha.', shape: 'tilted', color: 'amber', status: 'sleeping', mood: 'sleeping', statusLabel: 'Dormindo · próxima execução 07:00' },
    ],
  },
  how: {
    title: 'Como funciona',
    lead: 'Cada bot tem uma função. Veja o que ele recebe para fazê-la bem.',
    features: [
      { icon: 'model', title: 'Qualquer modelo', body: 'Os bots rodam no DeepSeek Harness, então você escolhe o provedor: uma assinatura, uma chave de API ou um modelo local.' },
      { icon: 'computer', title: 'Um computador só dele', body: 'Cada bot trabalha num computador isolado. Veja a tela ao vivo e assuma o controle quando quiser.' },
      { icon: 'apps', title: 'Seus apps', body: 'Conecte e-mail, agenda, código e CRM. Os segredos ficam no cofre; o modelo só vê uma referência.' },
      { icon: 'memory', title: 'Memória que você lê', body: 'Tudo o que um bot lembra pode ser visto, editado e exportado. Nada de caixa-preta.' },
      { icon: 'approval', title: 'Você aprova o que importa', body: 'Pagamentos, posts, envios e exclusões esperam até você dizer sim. Permita uma vez, sempre ou nunca.' },
      { icon: 'phone', title: 'Pelo celular', body: 'Escaneie um QR code para parear o celular. Aprove, responda e acompanhe seus bots de qualquer lugar.' },
    ],
  },
  chat: {
    title: 'É só um chat',
    lead: 'Converse com um bot como com um colega. Veja cada passo que ele dá e decida os que importam.',
    srSummary:
      'Exemplo: você pede à Tuca para fazer follow-up com três leads de uma demo. A Tuca busca no CRM, escreve três e-mails e pede aprovação antes de enviá-los.',
    bots: 'Bots',
    search: 'Buscar',
    pinned: 'Fixados',
    header: 'Follow-up de vendas',
    user: 'Faça follow-up com os três leads da demo de terça.',
    userTime: '09:12',
    reply: 'Achei os três no CRM. Escrevi uma mensagem curta para cada um, com o link da gravação e um horário para conversar na semana que vem.',
    replyTime: '09:13',
    toolSummary: 'leads onde demo = terça',
    approvalKind: 'Envio',
    approvalTitle: 'Enviar 3 e-mails de follow-up?',
    approvalMeta: 'gmail.send · para Ana, Rafael, Lucía',
    allowOnce: 'Permitir uma vez',
    allowAlways: 'Sempre permitir',
    deny: 'Negar',
    composer: 'Mensagem para Tuca',
    computer: 'Computador',
    computerCaption: 'Ao vivo · sandbox',
    takeOver: 'Assumir',
    tabs: ['Memória', 'Skills', 'Apps'],
    screen: ['Para: ana@example.com', 'Assunto: Foi ótimo te conhecer na terça', 'Oi, Ana, obrigada por participar da demo…'],
    memory: ['Ana prefere manhãs', 'Rafael perguntou sobre SSO', 'Escrever para Lucía em espanhol'],
  },
  deploy: {
    title: 'Seu, ou hospedado',
    lead: 'O mesmo Brot nos dois casos. Nenhum recurso fica de fora de quem hospeda por conta própria.',
    self: {
      name: 'Hospedagem própria',
      tag: 'Grátis',
      body: 'Rode no seu notebook ou no seu servidor. Seus dados ficam nas suas máquinas.',
      points: ['App desktop ou docker compose', 'Suas próprias chaves de modelo', 'Todos os recursos incluídos'],
      cta: 'Baixar',
    },
    cloud: {
      name: 'Brot Cloud',
      tag: 'Em breve',
      body: 'A gente mantém o forno quente. Bots sempre ligados, que não param quando o notebook dorme.',
      points: ['Um computador gerenciado por bot', 'Backups, assentos de equipe e suporte', 'Notificações no celular sem abrir portas'],
      cta: 'Entrar na lista de espera',
    },
  },
  waitlist: {
    title: 'O Brot Cloud ainda não abriu',
    body: 'Acompanhe o repositório no GitHub para saber quando abrir. Até lá, a hospedagem própria tem todos os recursos.',
    cta: 'Acompanhar no GitHub',
  },
  source: {
    title: 'Código aberto de ponta a ponta',
    body: 'Leia cada linha, rode onde quiser, mude o que quiser. O Brot é AGPL-3.0, então forks hospedados também compartilham suas mudanças.',
    license: 'AGPL-3.0',
    cta: 'Ver no GitHub',
    codeLabel: 'Rodar o Brot a partir do código',
  },
  footer: {
    tagline: 'Nascido no Brasil, feito para todo mundo.',
    license: 'Licenciado sob AGPL-3.0',
    status: 'O Brot está em desenvolvimento inicial.',
  },
};

const es: Dict = {
  meta: {
    title: 'Brot · Un equipo de bots de IA que trabaja para ti',
    description:
      'Bots de IA de código abierto en una app de chat. Cada uno tiene un trabajo, cualquier modelo, su propia computadora aislada, tus apps y una memoria que puedes leer. Alójalo tú mismo o usa Brot Cloud.',
  },
  nav: {
    label: 'Principal',
    team: 'Equipo',
    how: 'Cómo funciona',
    deploy: 'Propio o Cloud',
    source: 'Código abierto',
    github: 'GitHub',
    language: 'Idioma',
    skip: 'Saltar al contenido',
  },
  hero: {
    eyebrow: 'Código abierto · AGPL-3.0',
    title: 'Un equipo de bots de IA que nunca se va a casa.',
    lead: 'Dale a cada bot un trabajo, un modelo y su propia computadora. Trabajan en un chat que ya conoces y te preguntan antes de hacer algo que no se puede deshacer.',
    download: 'Descargar',
    cloud: 'Empezar en Brot Cloud',
    note: 'Gratis si lo alojas tú. Usa tus propias claves de modelo.',
    avatars: 'Siete bots de Brot, cada uno con una forma y un color distintos',
  },
  team: {
    title: 'Conoce a un equipo',
    lead: 'Cada bot tiene un nombre, un trabajo y una forma de hacerlo. Empieza desde un rol o escribe el tuyo.',
    bots: [
      { name: 'Capy', role: 'Jefa de gabinete', job: 'Ordena tu bandeja de entrada, mantiene la agenda al día y escribe el resumen de la mañana.', shape: 'cloud', color: 'teal', status: 'idle', mood: 'idle', statusLabel: 'Disponible' },
      { name: 'Onça', role: 'Cazadora de bugs', job: 'Reproduce el problema en su propio sandbox y abre un pull request con la corrección.', shape: 'triangle', color: 'orange', status: 'working', mood: 'thinking', statusLabel: 'Trabajando · corriendo pruebas' },
      { name: 'Tuca', role: 'Seguimiento de ventas', job: 'Redacta seguimientos desde tu CRM y espera tu OK antes de enviar nada.', shape: 'circle', color: 'violet', status: 'waiting', mood: 'approval', statusLabel: 'Esperándote' },
      { name: 'Jabu', role: 'Triaje de soporte', job: 'Etiqueta los tickets nuevos, responde los comunes y te pasa el resto.', shape: 'blob', color: 'blue', status: 'ok', mood: 'idle', statusLabel: 'Listo · 14 tickets ordenados' },
      { name: 'Iara', role: 'Investigadora', job: 'Lee mucho, cita cada fuente y dice lo que no pudo verificar.', shape: 'drop', color: 'pink', status: 'idle', mood: 'idle', statusLabel: 'Disponible' },
      { name: 'Bento', role: 'Contable', job: 'Concilia recibos con transacciones y señala lo que no cuadra.', shape: 'tilted', color: 'amber', status: 'sleeping', mood: 'sleeping', statusLabel: 'Durmiendo · próxima ejecución 07:00' },
    ],
  },
  how: {
    title: 'Cómo funciona',
    lead: 'Cada bot tiene un trabajo. Esto es lo que recibe para hacerlo bien.',
    features: [
      { icon: 'model', title: 'Cualquier modelo', body: 'Los bots corren sobre DeepSeek Harness, así que tú eliges el proveedor: una suscripción, una clave de API o un modelo local.' },
      { icon: 'computer', title: 'Su propia computadora', body: 'Cada bot trabaja en una computadora aislada. Mira la pantalla en vivo y toma el control cuando quieras.' },
      { icon: 'apps', title: 'Tus apps', body: 'Conecta correo, calendario, código y CRM. Los secretos se quedan en la bóveda; el modelo solo ve una referencia.' },
      { icon: 'memory', title: 'Memoria que puedes leer', body: 'Todo lo que un bot recuerda se puede ver, editar y exportar. Sin cajas negras.' },
      { icon: 'approval', title: 'Tú apruebas lo importante', body: 'Pagos, publicaciones, envíos y borrados esperan hasta que digas que sí. Permite una vez, siempre o nunca.' },
      { icon: 'phone', title: 'Desde tu teléfono', body: 'Escanea un código QR para vincular tu teléfono. Aprueba, responde y sigue a tus bots desde donde estés.' },
    ],
  },
  chat: {
    title: 'Es solo un chat',
    lead: 'Habla con un bot como con un compañero. Mira cada paso que da y decide los que importan.',
    srSummary:
      'Ejemplo: le pides a Tuca que haga seguimiento a tres leads de una demo. Tuca busca en el CRM, redacta tres correos y pide aprobación antes de enviarlos.',
    bots: 'Bots',
    search: 'Buscar',
    pinned: 'Fijados',
    header: 'Seguimiento de ventas',
    user: 'Haz seguimiento a los tres leads de la demo del martes.',
    userTime: '09:12',
    reply: 'Los encontré en el CRM. Redacté una nota corta para cada uno, con el enlace a la grabación y un horario para hablar la semana que viene.',
    replyTime: '09:13',
    toolSummary: 'leads donde demo = martes',
    approvalKind: 'Envío',
    approvalTitle: '¿Enviar 3 correos de seguimiento?',
    approvalMeta: 'gmail.send · a Ana, Rafael, Lucía',
    allowOnce: 'Permitir una vez',
    allowAlways: 'Permitir siempre',
    deny: 'Denegar',
    composer: 'Mensaje para Tuca',
    computer: 'Computadora',
    computerCaption: 'En vivo · sandbox',
    takeOver: 'Tomar el control',
    tabs: ['Memoria', 'Skills', 'Apps'],
    screen: ['Para: ana@example.com', 'Asunto: Un gusto conocerte el martes', 'Hola, Ana, gracias por venir a la demo…'],
    memory: ['Ana prefiere las mañanas', 'Rafael preguntó por SSO', 'Escribirle a Lucía en español'],
  },
  deploy: {
    title: 'Tuyo, o alojado',
    lead: 'El mismo Brot en ambos casos. Nada se le niega a quien lo aloja por su cuenta.',
    self: {
      name: 'Alojamiento propio',
      tag: 'Gratis',
      body: 'Córrelo en tu portátil o en tu propio servidor. Tus datos se quedan en tus máquinas.',
      points: ['App de escritorio o docker compose', 'Tus propias claves de modelo', 'Todas las funciones incluidas'],
      cta: 'Descargar',
    },
    cloud: {
      name: 'Brot Cloud',
      tag: 'Próximamente',
      body: 'Nosotros mantenemos el horno encendido. Bots siempre activos, que no se detienen cuando tu portátil duerme.',
      points: ['Una computadora gestionada por bot', 'Copias de seguridad, puestos de equipo y soporte', 'Notificaciones en el teléfono sin abrir puertos'],
      cta: 'Unirme a la lista de espera',
    },
  },
  waitlist: {
    title: 'Brot Cloud todavía no está abierto',
    body: 'Sigue el repositorio en GitHub y te enterarás cuando abra. Mientras tanto, el alojamiento propio tiene todas las funciones.',
    cta: 'Seguir en GitHub',
  },
  source: {
    title: 'Código abierto de principio a fin',
    body: 'Lee cada línea, córrelo donde quieras, cambia lo que quieras. Brot es AGPL-3.0, así que los forks alojados también comparten sus cambios.',
    license: 'AGPL-3.0',
    cta: 'Ver en GitHub',
    codeLabel: 'Correr Brot desde el código',
  },
  footer: {
    tagline: 'Nacido en Brasil, hecho para todos.',
    license: 'Licencia AGPL-3.0',
    status: 'Brot está en desarrollo temprano.',
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
