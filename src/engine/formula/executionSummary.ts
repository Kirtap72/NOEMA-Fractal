/**
 * GROUP-EXECUTION-BRIDGE-01: a plain-data description of a grouped execution, read by the artist-facing editor and by the AI tools.
 * Everything comes from the engine's own tables (kernel roles) and rules (chainExecutionErrors); nothing here is guessed.
 */
import { bridgeExecutionSteps, isImportedHelperCapable } from './importedHelper';
import { KERNELS } from './kernels';
import { chainExecutionErrors } from './groupExecution';
import type { ChainExecution } from './groupExecution';
import type { ChainStep } from './chain';
import type { Formula } from './types';

export interface ExecutionStepInfo {
  index: number;
  formula: string;
  name: string;
  iterations: number;
  /** "counted" calls count towards the group's call limit and the bailout; a "helper" only moves the point and is never counted. */
  role: 'counted' | 'helper';
  /** True when the step is a data transform (for example converted from a JIT file) running as a helper. */
  imported: boolean;
}
export interface ExecutionGroupInfo {
  group: number;
  /** Which job the group has in this execution kind. */
  job: string;
  start: number;
  end: number;
  repeat: number;
  maxIterations: number;
  steps: ExecutionStepInfo[];
}
export interface ExecutionInfo {
  kind: ChainExecution['kind'];
  explanation: string;
  groups: ExecutionGroupInfo[];
  /** Empty when the engine accepts the execution as it stands. */
  errors: string[];
}

const KIND_TEXT: Record<ChainExecution['kind'], { text: string; jobs: string[] }> = {
  'mapped-field': {
    text: 'Group 1 moves the point (analytic distance model with w) and group 2 measures a dIFS field on the moved point. The distance is the minimum of the field divided by w from group 1.',
    jobs: ['moves the point', 'measures the dIFS field'],
  },
  'independent-field': {
    text: 'Two groups run separately from the same start point and are combined as max(analytic distance, inverted dIFS distance).',
    jobs: ['analytic distance', 'inverted dIFS distance'],
  },
  'bounded-sequence': {
    text: 'A single group with a prefix segment and a repeated segment, limited by a call ceiling; the distance is radius over w or the dIFS minimum.',
    jobs: ['hela sekvensen'],
  },
};

/** What the two groups do and how their distances are combined, for each operation of an independent-field execution. */
function independentText(operation: string, smooth?: number): { text: string; jobs: string[] } {
  const lead = 'Two groups run separately from the same start point (A = the first group, B = the second group) and are combined as ';
  switch (operation) {
    case 'min': return { text: lead + 'union: min(A, B). The surface is what lies nearest of the two shapes.', jobs: ['A: analytic distance', 'B: dIFS distance'] };
    case 'max': return { text: lead + 'intersection: max(A, B). The surface is only what both shapes share.', jobs: ['A: analytic distance', 'B: dIFS distance'] };
    case 'smooth-min': return { text: lead + 'soft union (second-degree seam, width ' + (smooth ?? 0.1) + '): like min(A, B) but with a rounded transition.', jobs: ['A: analytic distance', 'B: dIFS distance'] };
    case 'smooth-min-cubic': return { text: lead + 'soft union (third-degree seam, width ' + (smooth ?? 0.1) + '): like min(A, B) but with an extra smooth transition.', jobs: ['A: analytic distance', 'B: dIFS distance'] };
    default: return KIND_TEXT['independent-field'];
  }
}

export function describeExecution(steps: readonly (ChainStep & { formulaName?: string })[], execution: ChainExecution, rounds = 1): ExecutionInfo {
  const bridged = bridgeExecutionSteps(steps, execution);
  const roleOf = (s: ChainStep): 'counted' | 'helper' => (s.formula.kernel && KERNELS[s.formula.kernel]?.role ? 'helper' : 'counted');
  const text = execution.kind === 'independent-field' ? independentText(execution.operation, execution.smooth) : KIND_TEXT[execution.kind];
  return {
    kind: execution.kind,
    explanation: text.text,
    groups: execution.groups.map((g, k) => ({
      group: k, job: text.jobs[k] ?? text.jobs[0]!, start: g.start, end: g.end, repeat: g.repeat, maxIterations: g.maxIterations,
      steps: bridged.slice(g.start, g.end + 1).map((s, i) => ({
        index: g.start + i, formula: s.formula.id, name: s.formula.name, iterations: s.iterations, role: roleOf(s),
        imported: !steps[g.start + i]!.formula.kernel && isImportedHelperCapable(steps[g.start + i]!.formula as Formula),
      })),
    })),
    errors: chainExecutionErrors(steps, rounds, 'sequence', execution),
  };
}
