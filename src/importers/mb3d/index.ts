import { hex, Mb3dParseError, RecordReader, RECORDS } from './reader';
import { decodeMb3dText } from './text';
import type { FormulaParameterSet, FormulaSlot, JsonValue, LegacyRecord, NeutralMb3dPreset, ParseOptions } from './types';
export { Mb3dParseError } from './reader';
export { decodeMb3dText, TEXT_ALPHABET } from './text';
export type { NeutralMb3dPreset, ParseOptions } from './types';
export const SOURCE_COMMIT = '26de069672c385e4c75e20b8a6cdfb21b3e86c82';
const INTERNAL_NAMES = ['Integer Power','Real Power','Quaternion','Tricorn','Amazing Box','Bulbox','Folding Int Pow','test','testIFS','Aexion C'];
const OPTION_TYPES = ['DOUBLE','SINGLE','INTEGER','DOUBLEANGLE','SINGLEANGLE','3DOUBLEANGLES','3SINGLEANGLES','BOXSCALE','FOLDING','DSQUARE','NOVARIABLE','FOLDING16','6SINGLEANGLES','DRECIPRO','2DOUBLES','DSQRRECI','2SINGLES','4SINGLES','3SCALESANGLES','SCALESROT','2INTEGER','SRECI2','DRECI2'];
const rec = (v: JsonValue | undefined): LegacyRecord => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const num = (v: JsonValue | undefined, fallback = 0) => typeof v === 'number' ? v : fallback;
const list = (v: JsonValue | undefined): JsonValue[] => Array.isArray(v) ? v : [];
const pick = (r: LegacyRecord, keys: string[]) => Object.fromEntries(keys.filter(k => k in r).map(k => [k,r[k]!]));
const color = (v: JsonValue | undefined): JsonValue => typeof v === 'number' ? {packed:v, rgb8:[v & 255,v >>> 8 & 255,v >>> 16 & 255],highByte:v >>> 24 & 255,highByteMeaning:'legacy specular/transparency or mode metadata; not standardized alpha'} : v ?? null;

function modernLightAmplitude(value: JsonValue | undefined, mandId: number): JsonValue {
  if (typeof value !== 'number') return value ?? null;
  if (mandId < 20) return value;
  const signed = (n: number) => n & 128 ? (n & 255)-256 : n & 255;
  return signed(value) * 10 ** (Math.max(-25, Math.min(25, signed(value>>>8))) - 1);
}
function ansi(v: JsonValue | undefined, encoding: string) {
  const values = list(v).map(x => num(x));
  const end = values.indexOf(0);
  return new TextDecoder(encoding).decode(new Uint8Array(end < 0 ? values : values.slice(0,end)));
}
function authors(bytes: Uint8Array, mandId: number): string[] {
  if (mandId < 41) return [];
  return [382,396].map(offset => {
    let text = '';
    for (let i=0;i<16;i++) {
      const bit = i*7, p = offset + (bit>>>3), shift = bit & 7;
      const c = ((bytes[p]! | (bytes[p+1] ?? 0)<<8) >>> shift) & 127;
      if (!c) break;
      text += String.fromCharCode(c);
    }
    return text;
  });
}
function selectHeader(mandId: number): {name:string; size:number} {
  if (mandId < 4) return {name:'TMandHeaderOld',size:200};
  if (mandId < 7) return {name:'TMandHeader4',size:272};
  if (mandId === 7) return {name:'TMandHeader8',size:580};
  if (mandId < 17) return {name:'TMandHeader8',size:704};
  if (mandId < 20) return {name:'TMandHeader9',size:704};
  return {name:'TMandHeader10',size:840};
}
function readHeader(reader: RecordReader, name: string, mandId: number) {
  if (mandId !== 7) return reader.record(name);
  const h: LegacyRecord = {};
  for (const f of RECORDS[name]!.fields.filter(f => f.name !== 'Light')) h[f.name!] = reader.field(f,f.offset!);
  h.Light = reader.record('TLightingParas7',432);
  return h;
}

/** Decodes the stored preset, not a render-equivalent engine scene. All input bytes survive. */
export function parseMb3dPreset(input: Uint8Array | string, options: ParseOptions = {}): NeutralMb3dPreset {
  const limit = options.maxInputBytes ?? 4 * 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 4) throw new Mb3dParseError('LIMIT','Invalid input limit');
  if (input.length > limit) throw new Mb3dParseError('LIMIT', `Preset exceeds ${limit} bytes/characters`);
  if (options.fileName && /\.m3i$/i.test(options.fileName)) throw new Mb3dParseError('CONTAINER', 'M3I image containers require a separate reader');
  const text = typeof input === 'string' ? decodeMb3dText(input) : null;
  const bytes = text?.bytes ?? input as Uint8Array;
  const reader = new RecordReader(bytes);
  reader.require(0,4);
  const mandId = reader.view.getInt32(0,true);
  if (mandId < 0 || mandId > 250) throw new Mb3dParseError('VERSION','Invalid MandId (expected 0..250)',0);
  const header = selectHeader(mandId);
  reader.require(0,header.size);
  const h = readHeader(reader,header.name,mandId);
  const warnings: string[] = [];
  const transforms: string[] = [];
  if (num(h.Width) < 1 || num(h.Height) < 1 || num(h.Width) >= 32768 || num(h.Height) >= 32768)
    warnings.push('Image dimensions fall outside MB3D text loader limits; no image is allocated.');
  const encoding = options.ansiEncoding ?? 'windows-1252';
  let addonOffset = header.size;
  if (text) {
    if (text.textVersion < 16) addonOffset = 705; // 704-byte header encoded in whole 3-byte groups
    else addonOffset = 840;
    if (text.textVersion < 16 && header.size !== 704 || text.textVersion >= 16 && header.size !== 840)
      throw new Mb3dParseError('TEXT_LAYOUT','Text transport version and MandId imply different header layouts');
  }
  let addon: LegacyRecord | null = null;
  let consumed = addonOffset;
  const slots: FormulaSlot[] = [];
  const parameters: FormulaParameterSet[] = [];
  if (mandId > 44) {
    warnings.push('Future MandId: known header prefix is tentative; formula addon offset is not assumed. Entire payload retained.');
  } else if (mandId >= 16 && (!text || text.textVersion > 14)) {
    reader.require(addonOffset,8);
    const addonVersion = bytes[addonOffset]!;
    const modern = addonVersion >= 16 && addonVersion <= 99;
    let count = 6;
    if (modern && text) {
      count = num(reader.field({kind:'u8',size:1},addonOffset+4));
      if (count > 6) throw new Mb3dParseError('FORMULA_COUNT','Text iFCount exceeds six slots',addonOffset+4);
      reader.require(addonOffset,8+188*count);
      // The final triplet may contain 1-2 extra source bytes, not semantic formula data.
      if (bytes.length - addonOffset > 1137) warnings.push('Extra bytes after text formula records are retained.');
    } else reader.require(addonOffset,modern ? 1136 : 1016);
    if (modern) {
      addon = {};
      for (const f of RECORDS.THeaderCustomAddon!.fields.filter(f => f.name !== 'Formulas')) addon[f.name!] = reader.field(f,addonOffset+f.offset!);
      addon.Formulas = Array.from({length:count},(_,i) => reader.record('THAformula',addonOffset+8+i*188));
      consumed = addonOffset+8+188*count;
    } else {
      addon = reader.record('THeaderCustomAddonOld',addonOffset);
      consumed = addonOffset+1016;
      warnings.push('Old addon has no option-type/count fields; parameter values retained with null types.');
    }
    for(let i=0;i<count;i++) {
      const f = modern ? rec(list(addon.Formulas)[i]) : {};
      const id = modern ? num(f.iFnr) : num(list(addon.iFormula)[i]);
      const storedName = ansi(modern ? f.CustomFname : list(addon.CustomFname)[i],encoding);
      const iterations = modern ? num(f.iItCount) : num(list(addon.iItCounts)[i]);
      const declared = modern ? num(f.iOptionCount) : null;
      if (declared !== null && (declared < 0 || declared > 16)) warnings.push(`Slot ${i}: out-of-range option count ${declared} retained.`);
      const interpolated = modern && (num(addon.bOptions1) & 3) === 1;
      const weight = interpolated ? reader.field({kind:'f32',size:4},addonOffset+8+i*188) : null;
      slots.push({slot:i,legacyId:id,storedName,name:id>=0 && id<INTERNAL_NAMES.length ? INTERNAL_NAMES[id]! : storedName || null,
        active:(interpolated ? typeof weight==='number' && weight>0 : iterations>0) && id>=0,
        iterations:interpolated?null:iterations,storedIterationWord:iterations,iterationEncoding:interpolated?'float32-weight':'int32-count',weight,parameterSet:i});
      const values = list(modern ? f.dOptionValue : list(addon.dOptionValues)[i]);
      const typeCodes = list(f.byOptionType);
      parameters.push({slot:i,declaredCount:declared,parameters:values.map((value,j) => {
        const type = modern ? num(typeCodes[j]) : null;
        const offset = modern ? addonOffset+8+i*188+60+j*8 : addonOffset+248+i*128+j*8;
        return {index:j,declared:declared===null ? null : j<declared,typeCode:type,
          typeName:type===null ? null : OPTION_TYPES[type] ?? null,value,rawHex:hex(bytes.subarray(offset,offset+8))};
      })});
    }
  } else {
    warnings.push('Pre-addon preset: stored legacy formula selector and inline hybrid parameters need compatibility reconstruction.');
    transforms.push('Convert4to7paras/ConvertHeaderFromOldParas and legacy inline hybrid reconstruction');
  }
  transforms.push('CheckHybridOptions: clamp schedule after metadata resolution');
  if (mandId < 44) transforms.push(`Header version ${mandId} to 44: FileHandling.UpdateFormulaOptionAbove20 (camera/defaults/scheduling)`);
  if (mandId < 20) transforms.push('UpdateFormulaOptionTo20 and ConvertLight8to9');
  transforms.push('UpdateLightParasAbove3: independent lighting version migrations');
  transforms.push('Ini1CFfromHAddon: resolve external .m3f metadata, missing defaults/types and formula aliases; missing formulas may be disabled');
  if (mandId < 42 && addon) transforms.push('Legacy repeat/split schedule and DE-combination formula reordering, before current scheduling');
  const l = rec(h.Light);
  const lights = list(l.Lights).map((value,i): JsonValue => {
    const r = rec(value), flags = num(r.Loption), mode = flags & 3;
    return {index:i,enabled:mode===0 || mode===2,mode:mode===2?'light-map':flags & 4?'positional':'directional',
      rawOption:flags,rawFunction:r.LFunction ?? null,color:color(r.Lcolor),
      amplitude: modernLightAmplitude(r.Lamp, mandId), rawAmplitude:r.Lamp ?? null,lightMapId:r.LightMapNr ?? null,
      coordinates:[r.LXpos ?? r.LXangle ?? null,r.LYpos ?? r.LYangle ?? null,r.LZpos ?? null],
      coordinateEncoding:'LX/LY radians for modern directional lights; D7 XYZ for positional; legacy angles use pi/16384',
      additionalByte:r.AdditionalByteEx ?? null,freeByte:r.FreeByte ?? null};
  });
  const options1 = addon?.bOptions1, modeCode = typeof options1 === 'number' ? options1 & 3 : null;
  const schedule1 = num(addon?.bHybOpt1), schedule2 = num(addon?.bHybOpt2);
  const bg = l.BGbmp && num(list(l.BGbmp)[0])!==255 ? ansi(l.BGbmp,encoding) : null;
  const modern = mandId >= 20;
  const selectedHeader = ['MandId','Width','Height','Iterations','MinimumIterations','iOptions','bNewOptions','bColorOnIt','dXmid','dYmid','dZmid','dZstart','dZend','dXWrot','dYWrot','dZWrot','dXrot','dYrot','dZrot','dZoom','dFOVy','bPlanarOptic','bImageScale','hVGrads','bIsJulia','dJx','dJy','dJz','dJw','Light','sM3dVersion'];
  const knownFlags = ['iOptions','bNewOptions','bColorOnIt','RStop','mZstepDiv','sDEstop','sRaystepLimiter','bVaryDEstopOnFOV','sFmixPow','sDEcombS','iMaxItsF2'];
  const pp = ['bCalcDOFtype','sDOFZsharp','sDOFZsharp2','sDOFclipR','sDOFaperture','bNormalsOnDE','bStepsafterDEStop','bCalculateHardShadow','bHScalculated','bCalc1HSsoft','bCalcAmbShadowAutomatic','sAmbShadowThreshold','SSAORcount','AODEdithering','sDEAOmaxL','bSSAO24BorderMirrorSize','SRamount','SRreflectioncount','bCalcSRautomatic','sTRIndex','sTRscattering','sTransmissionAbsorption','MCDepth','MCoptions','MCcontrast','MCdiffReflects','MCSoftShadowRadius','bMCSaturation','bCutOption','dCutX','dCutY','dCutZ','bCalc3D','bSliceCalc','TilingOptions','HSmaxLengthMultiplier','bDFogIt','bVolLightNr'];
  const used = new Set([...selectedHeader,...knownFlags,...pp]);
  return {
    format:'mb3d-neutral',version:1,
    source:{kind:text?'mb3d-text':'m3p-binary',fileName:options.fileName ?? null,mandId,headerType:header.name,
      headerBytes:header.size,textVersion:text?.textVersion ?? null,title:text?.title ?? null,programVersion:h.sM3dVersion ?? null,
      encoding,authoritativeSourceCommit:SOURCE_COMMIT,originalInput:typeof input==='string'?{text:input}:{hex:hex(input)},
      decodedPayloadHex:hex(bytes),authors:authors(bytes,mandId)},
    formulaChain:{available:addon!==null,mode:modeCode===null?null:['alternating','interpolated','de-combination','ifs'][modeCode]!,
      modeCode,slots,activeSlotOrder:slots.filter(s=>s.active).map(s=>s.slot),globalMaximumIterations:h.Iterations ?? null,
      minimumIterations:h.MinimumIterations ?? null,julia:{enabled:num(h.bIsJulia)!==0,constant:[h.dJx ?? null,h.dJy ?? null,h.dJz ?? null,h.dJw ?? null],rawFlag:h.bIsJulia ?? null},
      scheduling:{encoding:'zero-based packed indices; stored values before load-time corrections',end1:schedule1&7,repeat1:schedule1>>>4&7,
        start2:schedule2&7,end2:schedule2>>>4&7,repeat2:schedule2>>>8&7,rawFirst:addon?.bHybOpt1 ?? null,rawSecond:addon?.bHybOpt2 ?? null,
        legacyRepeatFrom:h.byRepeatFrom ?? (mandId<42 ? h.bVolLightNr ?? null : null)},
      legacyInline:mandId<16?{selectorCode:num(h.iOptions)&(mandId<8?15:31),selectorNamespace:mandId<8?'pre-8':'8-15',
        storedFormulaName:h.CustomFname?ansi(h.CustomFname,encoding):null,
        fields:pick(h,['dPow','dZmul','dMinR','sBBmulBulb','sBBRbulb','dCustomOption1','iHformula','iHcount','dHPow','dHZmul','dHMinR'])}:null,
      options:{...pick(h,knownFlags),...pick(addon ?? {},['bHCAversion','bOptions1','bOptions2','bOptions3','iFCount','iCustomCount'])}},
    formulaParameters:parameters,
    cameraView:{width:h.Width ?? null,height:h.Height ?? null,fractalCenter:[h.dXmid ?? null,h.dYmid ?? null,h.dZmid ?? null],
      depthRange:[h.dZstart ?? null,h.dZend ?? null],zoom:h.dZoom ?? null,fovYDegrees:h.dFOVy ?? null,
      basisEncoding:mandId<17?'legacy-euler':mandId >= 44 && (num(h.bNewOptions)&1)?'quaternion-in-matrix-record':'scaled-matrix',
      storedBasis:h.hVGrads ?? [h.dXrot ?? null,h.dYrot ?? null,h.dZrot ?? null],
      rotation4D:[h.dXWrot ?? null,h.dYWrot ?? null,h.dZWrot ?? null],projectionCode:h.bPlanarOptic ?? null,
      stereo:pick(h,['bStereoMode','StereoScreenWidth','StereoScreenDistance','StereoMinDistance']),
      note:'MB3D view parameters are retained in their original convention; fractalCenter is not engine camera.position.'},
    coloringMaterial:{surfaceStops:list(l.LCols).map(v=>{const c=rec(v);return {position:c.Position ?? null,diffuse:color(c.ColorDif),specular:color(c.ColorSpe)};}),
      interiorStops:list(l.ICols).map(v=>{const c=rec(v);return {position:c.Position ?? null,color:color(c.Color)};}),
      ambient:[l.AmbCol ?? null,l.AmbCol2 ?? null],depthColors:[l.DepthCol ?? null,l.DepthCol2 ?? null],legacyColors:l.Cols ?? null,
      roughnessByte:l.RoughnessFactor ?? null,colorMapLowByte:l.bColorMap ?? null,
      controls:pick(l,['VarColZpos','TBpos','TBoptions','FineColAdj1','FineColAdj2','TBfineColAdjust','AdditionalOptions']),
      orbitColor:pick(h,['byColor2Option','bColorOnIt','sColorMul','bNormalsOnDE'])},
    lighting:{sources:lights,layout:modern?'TLightingParas9':header.name==='TMandHeader4'||header.name==='TMandHeaderOld'?'TLightingParas':mandId===7?'TLightingParas7':'TLightingParas8',
      version:num(l.TBoptions)>>>20&7,extendedVersion:rec(list(l.Lights)[0]).AdditionalByteEx ?? null,
      fog:pick(l,['DynFogCol2','DynFogR','DynFogG','DynFogB','DepthCol','DepthCol2','PicOffsetX','PicOffsetY','PicOffsetZ'])},
    postprocess:pick(h,pp),
    references:{backgroundFilename:bg,backgroundKind:num(list(l.BGbmp)[0])===255?'procedural-seed':'filename',backgroundFilenameBytes:l.BGbmp ?? null,
      diffuseMapId:modern?num(l.bColorMap)+(num(rec(list(l.Lights)[1]).AdditionalByteEx)<<8):null,
      lightMapIds:lights.map(v=>rec(v).lightMapId ?? null),
      formulaFiles:slots.filter(s=>s.legacyId>19 && s.storedName).map(s=>s.storedName+'.m3f'),
      resolution:'Map filenames/directories are not embedded: use IniDirs[9] and numbered map lookup; background uses IniDirs[6], [9], [2]. Formula-specific map indices require option metadata. No referenced file is opened.'},
    legacyRecords:{header:h,formulaAddon:addon},
    unsupportedLegacyFields:{header:Object.fromEntries(Object.entries(h).filter(([k])=>!used.has(k))),
      pointerOrAuthorRegion:hex(bytes.subarray(382,410)),uninterpretedTailHex:hex(bytes.subarray(consumed)),
      headerFlagWords:pick(h,['iOptions','bNewOptions']),lightFlagWords:pick(l,['TBoptions','AdditionalOptions']),
      note:'All records and all original bytes are retained, including unknown flags, inactive slots, reserved fields, special floats and future extensions.'},
    compatibility:{warnings,requiredLoadTransforms:transforms,nativeValidation:'not-verified'},
  };
}

/** File entry point: keep original encoded text bytes as well as the decoded text. */
export function parseMb3dFile(bytes: Uint8Array, options: ParseOptions = {}): NeutralMb3dPreset {
  const limit = options.maxInputBytes ?? 4 * 1024 * 1024;
  if (bytes.length > limit) throw new Mb3dParseError('LIMIT', `Preset exceeds ${limit} bytes`);
  const utf16 = bytes[0]===255 && bytes[1]===254 ? 'utf-16le' : bytes[0]===254 && bytes[1]===255 ? 'utf-16be' : null;
  const preview = new TextDecoder('utf-8').decode(bytes.subarray(0,512));
  if (!utf16 && !/Mandelbulb3Dv\d/i.test(preview) && !/\.txt$/i.test(options.fileName ?? '')) return parseMb3dPreset(bytes, options);
  let text: string;
  if (utf16) {
    try { text = new TextDecoder(utf16,{fatal:true}).decode(bytes); }
    catch { throw new Mb3dParseError('TEXT_ENCODING', 'Malformed UTF-16 text file'); }
  } else {
    try { text = new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
    catch { text = new TextDecoder(options.ansiEncoding ?? 'windows-1252').decode(bytes); }
  }
  const preset = parseMb3dPreset(text, options);
  preset.source.originalInput.hex = hex(bytes);
  return preset;
}
