declare module "@iarna/toml" {
  export function parse(input: string): any;
  export function stringify(value: any): string;
}
