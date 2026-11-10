import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import en from '../locales/en.json';
import fr from '../locales/fr.json';

type Tree = { [key: string]: string | Tree };

const PLURAL = /_(zero|one|two|few|many|other)$/;

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') acc[key] = v;
    else Object.assign(acc, flatten(v, key));
    return acc;
  }, {});
}

const locales = { en: flatten(en as Tree), fr: flatten(fr as Tree) };
const baseKeys = (keys: string[]) => new Set(keys.map((k) => k.replace(PLURAL, '')));

describe('translation files', () => {
  it('have the same keys (plural forms compared by base key)', () => {
    const enKeys = baseKeys(Object.keys(locales.en));
    const frKeys = baseKeys(Object.keys(locales.fr));
    expect([...enKeys].filter((k) => !frKeys.has(k))).toEqual([]);
    expect([...frKeys].filter((k) => !enKeys.has(k))).toEqual([]);
  });

  it.each(['en', 'fr'] as const)('%s has every plural category its language needs', (lang) => {
    const needed = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
    const pluralBases = new Set(
      Object.keys(locales[lang])
        .filter((k) => PLURAL.test(k))
        .map((k) => k.replace(PLURAL, '')),
    );
    for (const base of pluralBases) {
      for (const category of needed) {
        expect(locales[lang]).toHaveProperty([`${base}_${category}`]);
      }
    }
  });

  it.each(['en', 'fr'] as const)('%s has no empty strings and keeps interpolation variables', (lang) => {
    for (const [key, value] of Object.entries(locales[lang])) {
      expect(value.trim()).not.toBe('');
      const otherLang = lang === 'en' ? 'fr' : 'en';
      const counterpart = locales[otherLang][key] ?? locales[otherLang][key.replace(PLURAL, '_other')];
      if (counterpart) {
        const vars = (s: string) => (s.match(/{{\s*\w+\s*}}/g) ?? []).sort();
        expect({ key, vars: vars(value) }).toEqual({ key, vars: vars(counterpart) });
      }
    }
  });

  it('every t() key used in the source exists in English', () => {
    const root = join(__dirname, '..', '..', '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory() && !['node_modules', '__tests__'].includes(entry.name)) walk(p);
        else if (/\.tsx?$/.test(entry.name)) files.push(p);
      }
    };
    walk(join(root, 'src'));
    const used = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1] as string);
    }
    const known = baseKeys(Object.keys(locales.en));
    expect([...used].filter((k) => !known.has(k) && !(k in locales.en))).toEqual([]);
    expect(used.size).toBeGreaterThan(10);
  });
});
