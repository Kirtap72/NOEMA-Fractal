/**
 * English, human labels for the change list the artist sees ("Light 1: intensity 0.88 → 2.5" instead of "lights.0.intensity").
 * The names of real settings come from the capability manifest (`name.en`), the single source of truth; the rest is a small, tested rule table
 * for the parts of a scene that are not settings (camera position, light fields, gradient stops, formula steps).
 * Never shows tool names or JSON; an unknown path is shown with its dots turned into " › " rather than hidden.
 */
import manifest from '../../capabilities/manifest.json';

export interface ChangeLine { path: string; from: unknown; to: unknown }
export interface ChangeText { label: string; from: string; to: string }

const settingName = new Map<string, string>((manifest.settings as { id: string; name: { en: string } }[]).map((s) => [s.id, s.name.en]));
const AXIS = ['X', 'Y', 'Z'];
const ENUM: Record<string, string> = {
  iterations: 'iterations', orbit_trap: 'orbit trap', slope: 'slope', cavity: 'cavities', radius: 'radius',
  repeat: 'repeat', mirror: 'mirror', directional: 'directional light', point: 'point light', spot: 'spotlight', none: 'none', hard: 'hard', soft: 'soft', color: 'colour', material: 'material',
  multiply: 'multiply', replace: 'replace',
};
const LIGHT_FIELD: Record<string, string> = { enabled: 'on/off', type: 'type', color: 'colour', intensity: 'intensity', direction: 'direction', position: 'position', cone_degrees: 'cone angle', cone_softness: 'edge softness', shadows: 'shadows', shadow_softness: 'shadow softness', name: 'name' };
const STOP_FIELD: Record<string, string> = { color: 'colour', position: 'position', transition: 'transition width', softness: 'softness', 'material.name': 'material', 'material.active': 'material stop on/off', 'material.metallic': 'metal', 'material.roughness': 'roughness', 'material.reflectivity': 'reflectivity', 'material.textureScale': 'texture scale', 'material.maps': 'picture maps', 'material.source': 'source', 'material.notBlended': 'not blended', kind: 'type' };
const CAMERA_FIELD: Record<string, string> = { fov_degrees: 'Field of view (degrees)', up: 'Camera up direction', projection: 'Projection', ortho_height: 'Orthographic height', lens: 'Lens', dof: 'Depth of field' };

const num = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
/** A value as the artist would say it. */
export function formatValue(v: unknown): string {
  if (v === undefined || v === null) return '–';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'number') return Number.isFinite(v) ? num(v) : '–';
  if (typeof v === 'string') return ENUM[v] ?? (v.length > 60 ? v.slice(0, 60) + '…' : v);
  if (Array.isArray(v)) return v.length <= 4 && v.every((x) => typeof x === 'number') ? `(${v.map((x) => num(x as number)).join('; ')})` : v.length <= 6 ? v.map(formatValue).join(', ') : `${v.length} values`;
  if (typeof v === 'object') { const o = v as Record<string, unknown>; return typeof o.channel === 'string' ? String(o.channel) : Object.keys(o).length ? `{${Object.keys(o).slice(0, 4).join(', ')}}` : '–'; }
  return String(v);
}

/** The label of one changed value. Elements of a list that was summarised as a whole (for example the maps of a stop) get a short label too. */
export function describeChange(e: ChangeLine): ChangeText {
  const p = e.path, from = formatValue(e.from), to = formatValue(e.to);
  const out = (label: string): ChangeText => ({ label, from, to });
  let m: RegExpExecArray | null;
  if ((m = /^camera\.(position|target)\.(\d)$/.exec(p))) return out(`Camera: ${m[1] === 'position' ? 'position' : 'target'} ${AXIS[Number(m[2])] ?? m[2]}`);
  if ((m = /^camera\.(position|target)$/.exec(p))) return out(`Camera: ${m[1] === 'position' ? 'position' : 'target'}`);
  if ((m = /^camera\.([a-z_]+)/.exec(p)) && CAMERA_FIELD[m[1]!]) return out(CAMERA_FIELD[m[1]!]!);
  if ((m = /^color\.gradient\.stops\.(\d+)\.(.+)$/.exec(p))) { const f = STOP_FIELD[m[2]!] ?? m[2]!.replace(/\./g, ' › '); return out(`Gradient stop ${Number(m[1]) + 1}: ${f}`); }
  if (p === 'color.gradient.name') return out('Gradient name');
  if (settingName.has(p)) return out(settingName.get(p)!);
  if ((m = /^color\.(measure|cycles|offset|wrap)$/.exec(p))) return out({ measure: 'Colour measure', cycles: 'Colour repeats', offset: 'Colour offset', wrap: 'Colour wrapping' }[m[1] as 'measure']);
  if ((m = /^material\.(metallic|roughness|reflectivity|baseColor|emissionStrength|transmission)$/.exec(p))) return out('Surface material: ' + ({ metallic: 'metal', roughness: 'roughness', reflectivity: 'reflectivity', baseColor: 'base tone', emissionStrength: 'emission', transmission: 'transparency' } as Record<string, string>)[m[1]!]);
  if ((m = /^lights\.(\d+)\.(.+)$/.exec(p))) return out(`Light ${Number(m[1]) + 1}: ${LIGHT_FIELD[m[2]!.split('.')[0]!] ?? m[2]!.replace(/\./g, ' › ')}${/\.\d$/.test(m[2]!) ? ' ' + (AXIS[Number(m[2]!.slice(-1))] ?? '') : ''}`);
  if ((m = /^lights\.(\d+)$/.exec(p))) return out(`Light ${Number(m[1]) + 1}`);
  if ((m = /^ambient\.(color|intensity)$/.exec(p))) return out('Ambient light: ' + (m[1] === 'color' ? 'colour' : 'strength'));
  if ((m = /^chain\.steps\.(\d+)\.parameters\.(.+)$/.exec(p))) return out(`Formula step ${Number(m[1]) + 1}: ${m[2]}`);
  if ((m = /^chain\.steps\.(\d+)\.(iterations|formula|name)$/.exec(p))) return out(`Formula step ${Number(m[1]) + 1}: ${({ iterations: 'iteration count', formula: 'formula', name: 'name' } as Record<string, string>)[m[2]!]}`);
  if (p === 'chain.rounds') return out('Formula chain: number of rounds');
  if ((m = /^render\.(.+)$/.exec(p))) return out('Render: ' + m[1]!.replace(/\./g, ' › ').replace(/_/g, ' '));
  return out(p.replace(/\./g, ' › ').replace(/_/g, ' '));
}

/** "Label: before → after" for a list (what the panels print). */
export const changeSentence = (e: ChangeLine): string => { const t = describeChange(e); return `${t.label}: ${t.from} → ${t.to}`; };
