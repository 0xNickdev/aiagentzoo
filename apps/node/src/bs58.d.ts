declare module "bs58" {
  const bs58: { encode(b: Uint8Array): string; decode(s: string): Uint8Array };
  export default bs58;
}
