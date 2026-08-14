/**
 * Omits `key` entirely when `value` is falsy, matching every DB row mapper's
 * convention of leaving an unset optional field off the object rather than
 * assigning it null/undefined.
 */
export function optionalField<K extends string, V>(
  key: K,
  value: V | null | undefined,
): { [P in K]: V } | Record<string, never> {
  return value ? ({ [key]: value } as { [P in K]: V }) : {};
}
