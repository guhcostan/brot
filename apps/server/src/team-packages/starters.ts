import { TeamPackage } from '@brot/protocol';

/** One built-in team a new workspace can install with one click. */
export interface StarterTeam {
  /** Stable id used by `POST /api/team-packages/starters/:id/install`. */
  id: string;
  name: string;
  description: string;
  /**
   * The deterministic package definition. Its `exportedAt` is a fixed stamp: the install route serves it through
   * `starterTeamPackage`, which fills in the current time. The content is valid on its own so tests can parse it.
   */
  package: TeamPackage;
}

/** The `exportedAt` stored in the built-in definitions; `starterTeamPackage` replaces it when serving. */
export const STARTER_EXPORTED_AT = '2026-01-01T00:00:00.000Z';

/** The summary `GET /api/team-packages/starters` returns, without the package body. */
export interface StarterTeamSummary {
  id: string;
  name: string;
  description: string;
  teamCount: number;
  botCount: number;
  roomCount: number;
  routineCount: number;
  skillCount: number;
}

/**
 * The built-in starter teams. Every host-specific choice (engine, model, computer, browser, budgets) is left to
 * the importer's server defaults, so these packages install the same way on every deployment.
 */
export const STARTER_TEAMS: readonly StarterTeam[] = [
  {
    id: 'dev-team',
    name: 'Dev team',
    description: 'A chief of staff, an engineer and a reviewer who ship together and check the repository every weekday.',
    package: TeamPackage.parse({
        format: 'brot.team',
        version: 1,
        exportedAt: STARTER_EXPORTED_AT,
        teams: [
          {
            key: 'engineering',
            name: 'Engineering',
            instructions:
              'Ship small, reviewable changes. Keep the Build room updated on what is in flight, and ask before any risky change.',
            chief: 'capy',
          },
        ],
        bots: [
          {
            key: 'capy',
            name: 'Capy',
            job: 'Chief of Staff',
            instructions:
              'You coordinate the Engineering team. Break work into small tasks, assign the engineer, ask the reviewer to check the result, and keep the Build room tidy with short status updates.',
            avatar: 'capybara:olive',
            team: 'engineering',
          },
          {
            key: 'onca',
            name: 'Onça',
            job: 'Engineer',
            instructions:
              'You implement changes end to end. Read the surrounding code first, keep the diff focused, run the relevant tests, and report what changed and what is still uncertain.',
            avatar: 'jaguar:amber',
            team: 'engineering',
          },
          {
            key: 'lobo',
            name: 'Lobo',
            job: 'Reviewer',
            instructions:
              'You review changes for correctness, edge cases and missing tests. Point out concrete risks, suggest a smaller diff when possible, and approve only when the change is ready to merge.',
            avatar: 'wolf:slate',
            team: 'engineering',
          },
        ],
        rooms: [
          {
            title: 'Build room',
            lead: 'capy',
            members: ['capy', 'onca', 'lobo'],
            responder: 'lead',
          },
        ],
        routines: [
          {
            bot: 'onca',
            name: 'Daily repo check',
            instruction:
              'Check the repository for failing checks, open review requests and unmerged changes. Post a short summary to the Build room with what needs attention today.',
            cron: '0 9 * * 1-5',
            enabled: false,
          },
        ],
        skills: [
          {
            name: 'Unified diff',
            description: 'How the engineering bots present changes: one focused unified diff, with the reasoning up front.',
            body: [
              '# Unified diff',
              '',
              '1. Say what the change does in one sentence.',
              '2. Show a single unified diff with three lines of context.',
              '3. List the commands you ran and their result.',
              '4. Name the remaining risk or test you could not run.',
              '',
              'Keep unrelated formatting out of the diff.',
            ].join('\n'),
          },
        ],
      }),
  },
  {
    id: 'content-studio',
    name: 'Content studio',
    description: 'An editor, a researcher and a social writer who turn ideas into reviewed posts.',
    package: TeamPackage.parse({
        format: 'brot.team',
        version: 1,
        exportedAt: STARTER_EXPORTED_AT,
        teams: [
          {
            key: 'content',
            name: 'Content',
            instructions:
              'Stay in the Editorial room. Research before writing, keep drafts in the room so the editor can review them, and never publish without approval.',
            chief: 'arara',
          },
        ],
        bots: [
          {
            key: 'arara',
            name: 'Arara',
            job: 'Editor',
            instructions:
              'You run the Content team. Assign research, shape drafts, give specific edit notes, and only approve a piece when the argument and the language are clear.',
            avatar: 'macaw:teal',
            team: 'content',
          },
          {
            key: 'mico',
            name: 'Mico',
            job: 'Researcher',
            instructions:
              'You research topics before anyone writes. Find primary sources, note the dates and links, and summarize the strongest counter-argument to each claim.',
            avatar: 'monkey:orange',
            team: 'content',
          },
          {
            key: 'boto',
            name: 'Boto',
            job: 'Social',
            instructions:
              'You write short social posts and threads from approved drafts. Lead with a concrete hook, keep the tone plain, and show the editor the final copy before posting.',
            avatar: 'river-dolphin:blue',
            team: 'content',
          },
        ],
        rooms: [
          {
            title: 'Editorial room',
            lead: 'arara',
            members: ['arara', 'mico', 'boto'],
            responder: 'mention',
          },
        ],
        routines: [
          {
            bot: 'arara',
            name: 'Weekly content review',
            instruction:
              'Review this week’s drafts and published posts. List what worked, what to improve, and one idea for next week; post it in the Editorial room.',
            cron: '0 10 * * 1',
            enabled: false,
          },
        ],
        skills: [
          {
            name: 'Hook checklist',
            description: 'The questions the studio answers before any piece goes out.',
            body: [
              '# Hook checklist',
              '',
              '- Who is this for, and what do they get in the first sentence?',
              '- What is the one claim, and what evidence supports it?',
              '- What would a skeptical reader object to?',
              '- Is the call to action concrete and honest?',
              '- Read it once out loud; cut anything you would not say.',
            ].join('\n'),
          },
        ],
      }),
  },
  {
    id: 'ops-desk',
    name: 'Ops desk',
    description: 'Support triage and finance working a shared queue with a morning brief.',
    package: TeamPackage.parse({
        format: 'brot.team',
        version: 1,
        exportedAt: STARTER_EXPORTED_AT,
        teams: [
          {
            key: 'operations',
            name: 'Operations',
            instructions:
              'Work the queue in the Ops room. Triage first, answer with the customer’s facts, and escalate money questions to Finance before acting.',
            chief: 'tamu',
          },
        ],
        bots: [
          {
            key: 'tamu',
            name: 'Tamu',
            job: 'Support triage',
            instructions:
              'You triage incoming support requests. Classify urgency, gather the account facts, answer what you can, and hand refund or billing decisions to Jabuti in Finance.',
            avatar: 'toucan:green',
            team: 'operations',
          },
          {
            key: 'jabuti',
            name: 'Jabuti',
            job: 'Finance',
            instructions:
              'You handle billing and refund questions. Check the policy and the order details, explain the outcome plainly, and ask for approval before any payment or refund is issued.',
            avatar: 'jabuti:amber',
            team: 'operations',
          },
        ],
        rooms: [
          {
            title: 'Ops room',
            lead: 'tamu',
            members: ['tamu', 'jabuti'],
            responder: 'lead',
          },
        ],
        routines: [
          {
            bot: 'tamu',
            name: 'Morning brief',
            instruction:
              'Summarize yesterday’s support queue: what came in, what is still open, and what needs a decision today. Post the brief to the Ops room.',
            cron: '0 8 * * 1-5',
            enabled: false,
          },
        ],
        skills: [
          {
            name: 'Refund triage',
            description: 'How the ops desk decides between answering, escalating and refunding.',
            body: [
              '# Refund triage',
              '',
              '1. Confirm the order id and the account.',
              '2. Check the refund window and the stated policy.',
              '3. If the case is inside policy, propose the refund and route it for approval.',
              '4. If it is outside policy, explain why and offer the closest alternative.',
              '5. Never promise a payment you cannot approve.',
            ].join('\n'),
          },
        ],
      }),
  },
];

/** The starter with this id, if any. */
export function starterTeamById(id: string): StarterTeam | undefined {
  return STARTER_TEAMS.find((starter) => starter.id === id);
}

/** The package as served: the same content with `exportedAt` set to the install time. */
export function starterTeamPackage(starter: StarterTeam, now: Date = new Date()): TeamPackage {
  return { ...starter.package, exportedAt: now.toISOString() };
}

/** The static summary the list route returns. */
export function starterTeamSummary(starter: StarterTeam): StarterTeamSummary {
  const pkg = starter.package;
  return {
    id: starter.id,
    name: starter.name,
    description: starter.description,
    teamCount: pkg.teams.length,
    botCount: pkg.bots.length,
    roomCount: pkg.rooms.length,
    routineCount: pkg.routines.length,
    skillCount: pkg.skills.length,
  };
}
