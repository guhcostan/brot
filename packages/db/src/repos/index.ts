import type { Db } from '../client';
import { createApprovalRepo } from './approvals';
import { createBotRepo } from './bots';
import { createComputerRepo } from './computers';
import { createDeviceRepo } from './devices';
import { createEventRepo } from './events';
import { createMemoryRepo } from './memories';
import { createMessageRepo } from './messages';
import { createPolicyRepo } from './policies';
import { createRoomRepo } from './rooms';
import { createRoutineRepo } from './routines';
import { createRunRepo } from './runs';
import { createSkillRepo } from './skills';
import { createTaskRepo } from './tasks';
import { createThreadRepo } from './threads';
import { createThreadSessionRepo } from './thread-sessions';

export function createRepos(db: Db) {
  return {
    bots: createBotRepo(db),
    threads: createThreadRepo(db),
    messages: createMessageRepo(db),
    runs: createRunRepo(db),
    approvals: createApprovalRepo(db),
    policies: createPolicyRepo(db),
    memories: createMemoryRepo(db),
    skills: createSkillRepo(db),
    computers: createComputerRepo(db),
    routines: createRoutineRepo(db),
    devices: createDeviceRepo(db),
    events: createEventRepo(db),
    rooms: createRoomRepo(db),
    threadSessions: createThreadSessionRepo(db),
    tasks: createTaskRepo(db),
  };
}

export type Repos = ReturnType<typeof createRepos>;

export type { CreateApprovalInput } from './approvals';
export type { CreateMessageInput } from './messages';
export type { CreateDeviceInput } from './devices';
export type { RoutineScheduleUpdate } from './routines';
export type { RunPatch } from './runs';
export type { TaskFilter } from './tasks';
