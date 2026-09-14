import { randomBytes, randomUUID } from 'node:crypto';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Root agents are A, B, C…; children alternate digits and lowercase letters by depth: A → A1 → A1a → A1a1. */
export function childName(parentId: string, index: number, depth: number): string {
  if (depth % 2 === 1) return `${parentId}${index}`;
  return `${parentId}${'abcdefghijklmnopqrstuvwxyz'[(index - 1) % 26]}`;
}

export function rootName(i: number): string {
  return LETTERS[i % 26] + (i >= 26 ? String(Math.floor(i / 26)) : '');
}

export const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`;
export const newSecret = () => randomBytes(24).toString('base64url');
export const uuid = () => randomUUID();
