declare module 'arabic-persian-reshaper' {
  export const ArabicShaper: { convertArabic(text: string): string };
  export const PersianShaper: { convertArabic(text: string): string };
}
declare module 'bidi-js' {
  const bidiFactory: () => {
    getEmbeddingLevels(text: string, dir: 'ltr' | 'rtl'): { levels: Uint8Array; paragraphs: Array<{ start: number; end: number; level: number }> };
    getReorderSegments(text: string, embeddingLevels: any, start?: number, end?: number): Array<[number, number]>;
  };
  export default bidiFactory;
}
