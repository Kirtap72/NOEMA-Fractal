/** Whether a name or link has been checked against its real source by a person. */
export type VerificationStatus = "verified" | "unverified";

export interface Credit {
  name: string;
  role?: string;
  status: VerificationStatus;
}

export interface Source {
  /** A web link (http or https). Either url or reference must be given. */
  url?: string;
  /** A literature reference or other text, for sources without a link. */
  reference?: string;
  status: VerificationStatus;
}

export interface Parameter {
  name: string;
  label?: string;
  default: number;
  min: number;
  max: number;
}

export interface Variable {
  name: string;
  type: "float" | "vec3" | "vec4";
  init: string;
}

export type Step = { kind: "assign"; target: string; op: "=" | "+=" | "-=" | "*=" | "/="; expr: string } | { kind: "break_if"; expr: string };

export interface Formula {
  /** Format 3: a fixed engine kernel for maps needing persistent state or numeric DE. */
  kernel?: import('./kernels').KernelId;
  id: string;
  name: string;
  description?: string;
  /** Optional discovery metadata; never affects formula execution or scene serialization. */
  catalog?: FormulaCatalog;
  credits: Credit[];
  sources: Source[];
  addedBy: string;
  /** Short note on the legal status of the mathematics (see LICENSING.md). */
  mathStatus: string;
  /** True only when a person has checked every credit and source. */
  reviewed: boolean;
  parameters: Parameter[];
  iterations: number;
  variables: Variable[];
  steps: Step[];
  /** Left out for transforms: steps that only change the point and have no distance estimate of their own. */
  distance?: string;
  /** The vec3 or vec4 variable whose path is followed for the orbit trap colour measure. */
  orbitPoint?: string;
  /**
   * Variables whose value is passed on to the next step of a chain (for example
   * the point z and its derivative dr). Others start fresh in every step.
   */
  carry: string[];
  /** Suggested starting distance for the camera. */
  cameraDistance?: number;
  /** Where the formula comes from, when it is a reimplementation of a formula in another program (format 2). */
  provenance?: Provenance;
}

/** The program collections a formula may be reimplemented from (CLAUDE.md section 10). */
export const PROVENANCE_COLLECTIONS = ["M3Formulas", "EM_JIT_M3Formulas"] as const;
export type ProvenanceCollection = (typeof PROVENANCE_COLLECTIONS)[number];

/**
 * Provenance of a formula reimplemented from Mandelbulb 3D (format 2, CLAUDE.md section 10). Kept per formula, so that
 * every such formula can be changed or removed on its own.
 */
export interface Provenance {
  /** Stable built-in MB3D ID, a separate namespace from external formula filenames. */
  internalId?: number;
  origin: "mandelbulb3d";
  /** The original file name, for example "_BStellahedron_F_Sphere.m3f". */
  file: string;
  /** The author exactly as the source credits them. */
  creditedAuthor: string;
  /** Optional individual names when the source's author field credits several people. */
  creditedAuthors?: string[];
  collection: ProvenanceCollection;
  /** That this is an independent reimplementation of the mathematical formula, and what was read. */
  note: string;
  /** Conditions the collection states (for example the credit EM_JIT asks for). Required for EM_JIT_M3Formulas. */
  conditions?: string;
  /** True only after the project owner has compared the formula with Mandelbulb 3D using the same settings. */
  verifiedAgainstMb3d: boolean;
}

export const MAX_PARAMETERS = 16;

export const FORMULA_CATEGORIES = ["fractals", "ifs", "hypercomplex", "transforms", "spatial", "julia", "difs", "other"] as const;
export type FormulaCategory = (typeof FORMULA_CATEGORIES)[number];
export interface FormulaCatalog {
  category?: FormulaCategory;
  tags?: string[];
  dimension?: 3 | 4;
  family?: string;
}
