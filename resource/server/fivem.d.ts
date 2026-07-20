/** Minimal ambient declarations for the FiveM Node server runtime. */
declare function GetConvar(name: string, defaultValue: string): string;
declare function RegisterCommand(
  name: string,
  handler: (source: number, args: string[]) => void,
  restricted: boolean,
): void;

declare namespace globalThis {
  /** FiveM export registration: exports('name', fn) */
  var exports: ((name: string, fn: (...args: never[]) => unknown) => void) | undefined;
}
