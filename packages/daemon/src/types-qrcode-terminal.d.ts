// qrcode-terminal の型定義 (DefinitelyTyped に @types が無い)。
// 必要な関数だけ宣言する。
declare module "qrcode-terminal" {
  interface Options {
    small?: boolean;
  }
  function generate(text: string, opts?: Options, cb?: (output: string) => void): void;
  function generate(text: string, cb: (output: string) => void): void;
  const _default: { generate: typeof generate };
  export default _default;
  export { generate };
}
