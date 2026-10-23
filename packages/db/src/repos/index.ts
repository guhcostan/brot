import type { Db } from '../client';
import { createApprovalRepo } from './approvals';
import { createAttachmentRepo } from './attachments';
import { createBotRepo } from './bots';
import { createBrowserProfileRepo } from './browser-profiles';
import { createComputerRepo } from './computers';
import { createDeviceRepo } from './devices';
import { createEventRepo } from './events';
import { createMcpServerRepo } from './mcp-servers';
import { createMemoryRepo } from './memories';
import { createNotificationRepo } from './notifications';
import { createMessageRepo } from './messages';
import { createPolicyRepo } from './policies';
import { createBotPresetRepo } from './presets';
import { createRoomRepo } from './rooms';
import { createRoutineRepo } from './routines';
import { createRoutineRunRepo } from './routine-runs';
import { createRunRepo } from './runs';
import { createSettingsRepo } from './settings';
import { createSavedLoginRepo } from './saved-logins';
import { createSkillRepo } from './skills';
import { createTaskRepo } from './tasks';
import { createTeamRepo } from './teams';
import { createThreadRepo } from './threads';
import { createThreadSessionRepo } from './thread-sessions';

export function createRepos(db: Db) {
  return {
    bots: createBotRepo(db),
    browserProfiles: createBrowserProfileRepo(db),
    threads: createThreadRepo(db),
    messages: createMessageRepo(db),
    attachments: createAttachmentRepo(db),
    runs: createRunRepo(db),
    approvals: createApprovalRepo(db),
    policies: createPolicyRepo(db),
    botPresets: createBotPresetRepo(db),
    memories: createMemoryRepo(db),
    mcpServers: createMcpServerRepo(db),
    notifications: createNotificationRepo(db),
    skills: createSkillRepo(db),
    computers: createComputerRepo(db),
    routines: createRoutineRepo(db),
    routineRuns: createRoutineRunRepo(db),
    savedLogins: createSavedLoginRepo(db),
    devices: createDeviceRepo(db),
    events: createEventRepo(db),
    rooms: createRoomRepo(db),
    threadSessions: createThreadSessionRepo(db),
    settings: createSettingsRepo(db),
    tasks: createTaskRepo(db),
    teams: createTeamRepo(db),
  };
}

export type Repos = ReturnType<typeof createRepos>;

export type { CreateApprovalInput } from './approvals';
export type { CreateMessageInput, MessageSearchFilter, MessageSearchRow } from './messages';
export type { CreateDeviceInput } from './devices';
export type { RoutineScheduleUpdate } from './routines';
export type { CreateRoutineRunInput, RoutineRunFilter, RoutineRunPatch } from './routine-runs';
export type { RunPatch, RunUsageRange } from './runs';
export type { CreateAttachmentRecord, StoredAttachment } from './attachments';
export type { CreateNotificationInput, NotificationFilter } from './notifications';
export type { CreateSavedLoginOptions, SavedLoginSecretNames } from './saved-logins';
export type { TaskFilter } from './tasks';
export type { SettingsValueParser } from './settings';
