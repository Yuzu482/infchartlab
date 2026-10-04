import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {decodeForPreview} from '../../dist/spc-preview.mjs';
const fixture=JSON.parse(readFileSync(new URL('./spc-preview.json',import.meta.url),'utf8'));
export const seed=fixture.seed, expected=fixture.expected;
export const bytes=Uint8Array.from(Buffer.from(fixture.base64,'base64'));
export function loadSpcPreview(){return {bytes:bytes.slice(),seed,expected};}
export {decodeForPreview};
