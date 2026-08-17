declare module 'node:fs/promises' {
  export function readFile(path: string, encoding: string): Promise<string>
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  export function writeFile(path: string, data: string, encoding?: string): Promise<void>
  export function rename(oldPath: string, newPath: string): Promise<void>
}

declare module 'node:path' {
  export function dirname(path: string): string
  export function join(...parts: string[]): string
}

declare module 'node:os' {
  export function homedir(): string
}

declare const process: {
  env: Record<string, string | undefined>
}
