import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawBrand = JSON.parse(readFileSync(path.join(packageRoot, 'branding.json'), 'utf-8'));

export const BRAND = Object.freeze({
  productName: rawBrand.productName || 'Hermit',
  productNameShort: rawBrand.productNameShort || rawBrand.productName || 'Hermit',
  stylizedName: rawBrand.stylizedName || rawBrand.productName || 'openHermit',
  cliCommand: rawBrand.cliCommand || 'openhermit',
  npmPackage: rawBrand.npmPackage || '@yancyyu/openhermit',
  runtimeBridgeName: rawBrand.runtimeBridgeName || 'hermit-bridge',
  authAccountLabel: rawBrand.authAccountLabel || `${rawBrand.stylizedName || 'openHermit'} 账号`,
  authProviderName: rawBrand.authProviderName || rawBrand.stylizedName || 'openHermit',
  defaultLocalHomeName: rawBrand.defaultLocalHomeName || '.hermit',
  githubRepo: rawBrand.githubRepo || 'yancyuu/Hermit',
  publicDocsUrl: rawBrand.publicDocsUrl || 'https://yancyuu.github.io/Hermit/',
});

export function brandLogPrefix() {
  return `[${BRAND.stylizedName}]`;
}

export function brandCommand(args = '') {
  return [BRAND.cliCommand, args].filter(Boolean).join(' ');
}
