export const LANGS: string[];

export function set_lang(lg: string): void;
export function get_lang(): string;
export function t(key: string, params?: Record<string, string | number>): string;
export function apply_i18n(): void;