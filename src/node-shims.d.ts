declare module 'node:fs/promises' {
  export function readFile(path: string, encoding: string): Promise<string>
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  export function writeFile(path: string, data: string, encoding?: string): Promise<void>
  export function rename(oldPath: string, newPath: string): Promise<void>
  export function chmod(path: string, mode: number): Promise<void>
  export function readdir(path: string): Promise<string[]>
  /** 存储台账要的是真实字节数与真实修改时间；密钥文件加固要的是 mode。 */
  export function stat(path: string): Promise<{ mode: number; size: number; mtimeMs: number; isDirectory(): boolean; isFile(): boolean }>
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
