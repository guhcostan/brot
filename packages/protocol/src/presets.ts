import { z } from 'zod';
import { IsoDateTime } from './entities';

/** The avatar shape the web sends: `species:color`, legacy shape names included. */
export const BotPresetAvatar = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/, 'expected a "species:color" avatar');

/** A reusable default for a new bot: its name, job, instructions and look. */
export const BotPreset = z.object({
  id: z.string(),
  name: z.string(),
  job: z.string(),
  instructions: z.string(),
  avatar: z.string().optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BotPreset = z.infer<typeof BotPreset>;

/** Creates a preset. `instructions` defaults to empty; the avatar must fit the bot avatar form. */
export const CreateBotPreset = z.object({
  name: z.string().min(1).max(120),
  job: z.string().min(1).max(120),
  instructions: z.string().max(20_000).default(''),
  avatar: BotPresetAvatar.optional(),
});
export type CreateBotPreset = z.infer<typeof CreateBotPreset>;
export type CreateBotPresetInput = z.input<typeof CreateBotPreset>;

/** Updates a preset; omitted fields stay as they are. */
export const UpdateBotPreset = z.object({
  name: z.string().min(1).max(120).optional(),
  job: z.string().min(1).max(120).optional(),
  instructions: z.string().max(20_000).optional(),
  avatar: BotPresetAvatar.optional(),
});
export type UpdateBotPreset = z.infer<typeof UpdateBotPreset>;

/** The optional body of `POST /api/presets/from-bot/:botId`: a preset name different from the bot's. */
export const CreatePresetFromBot = z.object({
  name: z.string().min(1).max(120).optional(),
});
export type CreatePresetFromBot = z.infer<typeof CreatePresetFromBot>;
