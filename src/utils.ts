// src/utils.ts
export const globalState = globalThis as any;

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
