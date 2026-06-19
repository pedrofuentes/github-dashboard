export type ClassValue = string | false | null | undefined;

/**
 * Joins truthy class-name values into a single space-separated string.
 *
 * Designed for the common conditional pattern `cn('base', isActive && 'active')`,
 * where falsy branches (`false`, `null`, `undefined`, `''`) are dropped.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter((value): value is string => Boolean(value)).join(' ');
}
