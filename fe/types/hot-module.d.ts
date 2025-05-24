// Declaraciones para Hot Module Replacement
declare global {
  interface Module {
    hot?: {
      accept(): void;
      accept(dependency: string, callback?: () => void): void;
      accept(dependencies: string[], callback?: () => void): void;
      decline(): void;
      decline(dependency: string): void;
      decline(dependencies: string[]): void;
      dispose(callback: (data: any) => void): void;
      addDisposeHandler(callback: (data: any) => void): void;
      removeDisposeHandler(callback: (data: any) => void): void;
      invalidate(): void;
      check(autoApply?: boolean): Promise<string[] | null>;
      apply(options?: any): Promise<string[] | null>;
      status(): string;
      addStatusHandler(callback: (status: string) => void): void;
      removeStatusHandler(callback: (status: string) => void): void;
    };
  }
}

export {};
