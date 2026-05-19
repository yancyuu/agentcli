declare module 'node-pty' {
  export interface IPty {
    pid: number;
    write(data: string): void;
    resize(columns: number, rows: number): void;
    kill(signal?: string): void;
    onData: (listener: (data: string) => void) => void;
    onExit: (
      listener: ({ exitCode, signal }: { exitCode: number; signal?: number }) => void
    ) => void;
  }

  export interface ISpawnOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string>;
  }

  export function spawn(file: string, args: string[] | string, options: ISpawnOptions): IPty;
}
