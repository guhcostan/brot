import { JsonSchemaObject, SecretRef } from '@brot/protocol';
import { z } from 'zod';

const SECRET_REF = /secret:\/\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}/g;

/** The JSON Schema a tool advertises for its arguments, generated from the zod schema that validates them. */
export function inputSchemaOf(schema: z.ZodType): JsonSchemaObject {
  const json: Record<string, unknown> = { ...z.toJSONSchema(schema, { io: 'input' }) };
  delete json.$schema;
  return JsonSchemaObject.parse(json);
}

export function invalidArguments(error: z.ZodError): string {
  const problems = error.issues.map((issue) => `${issue.path.join('.') || 'arguments'} ${issue.message}`);
  return `Invalid arguments: ${problems.join('; ')}`;
}

/** Every `secret://` reference in a string, each once, in order of first appearance. */
export function findSecretRefs(...texts: string[]): SecretRef[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of text.match(SECRET_REF) ?? []) found.add(match);
  }
  return [...found].map((ref) => SecretRef.parse(ref));
}

export function replaceSecretRefs(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(SECRET_REF, (ref) => (Object.hasOwn(values, ref) ? (values[ref] ?? ref) : ref));
}

/** Replaces every occurrence of each value, longest first, so no secret reaches the model in any output. */
export function redact(text: string, values: readonly string[]): string {
  let result = text;
  const longest = values.filter((value) => value.length > 0).sort((a, b) => b.length - a.length);
  for (const value of longest) result = result.split(value).join('[redacted]');
  return result;
}
