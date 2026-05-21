export const CORRECTNESS_VERIFIER_VERSION = "correctness/v0";

export type CorrectnessTaskType = "writing" | "code" | "data" | "regulated";

export interface WritingCorrectnessConfig {
  sources_provided?: boolean;
}

export interface CodeCorrectnessConfig {
  require_test_command?: boolean;
  require_build_command?: boolean;
  require_lint_command?: boolean;
}

export interface DataCorrectnessConfig {
  require_schema_constraints?: boolean;
  require_math_constraints?: boolean;
}

export interface RegulatedCorrectnessConfig {
  require_citation?: boolean;
  require_uncertainty_gate?: boolean;
}

export interface CorrectnessConfig {
  writing?: WritingCorrectnessConfig;
  code?: CodeCorrectnessConfig;
  data?: DataCorrectnessConfig;
  regulated?: RegulatedCorrectnessConfig;
}

export interface CorrectnessContract {
  id: string;
  description: string;
  deterministic: true;
  mode: "placeholder";
  configured: boolean;
}

export interface CorrectnessViolation {
  contract_id: string;
  code: string;
  message: string;
  evidence?: string;
}

export interface CorrectnessMetrics {
  mode: "noop";
  contracts_checked: number;
  violation_count: number;
}

export interface CorrectnessInput {
  task_type: CorrectnessTaskType;
  input: string;
  output: string;
  config?: CorrectnessConfig;
}

export interface CorrectnessResult {
  ok: boolean;
  task_type: CorrectnessTaskType;
  verifier_version: string;
  contracts: CorrectnessContract[];
  violations: CorrectnessViolation[];
  metrics: CorrectnessMetrics;
}

function buildWritingContracts(config: CorrectnessConfig | undefined): CorrectnessContract[] {
  const sourcesProvided = config?.writing?.sources_provided === true;
  return [
    {
      id: "writing.claim_source_support_required_when_sources_provided",
      description: "Claim/source support required when sources are provided.",
      deterministic: true,
      mode: "placeholder",
      configured: sourcesProvided
    }
  ];
}

function buildCodeContracts(config: CorrectnessConfig | undefined): CorrectnessContract[] {
  const codeConfig = config?.code;
  return [
    {
      id: "code.tests_command_required_when_configured",
      description: "Test command required when configured.",
      deterministic: true,
      mode: "placeholder",
      configured: codeConfig?.require_test_command === true
    },
    {
      id: "code.build_command_required_when_configured",
      description: "Build command required when configured.",
      deterministic: true,
      mode: "placeholder",
      configured: codeConfig?.require_build_command === true
    },
    {
      id: "code.lint_command_required_when_configured",
      description: "Lint command required when configured.",
      deterministic: true,
      mode: "placeholder",
      configured: codeConfig?.require_lint_command === true
    }
  ];
}

function buildDataContracts(config: CorrectnessConfig | undefined): CorrectnessContract[] {
  const dataConfig = config?.data;
  return [
    {
      id: "data.schema_constraints_required_when_configured",
      description: "Schema constraints required when configured.",
      deterministic: true,
      mode: "placeholder",
      configured: dataConfig?.require_schema_constraints === true
    },
    {
      id: "data.math_constraints_required_when_configured",
      description: "Math constraints required when configured.",
      deterministic: true,
      mode: "placeholder",
      configured: dataConfig?.require_math_constraints === true
    }
  ];
}

function buildRegulatedContracts(
  config: CorrectnessConfig | undefined
): CorrectnessContract[] {
  const regulatedConfig = config?.regulated;
  return [
    {
      id: "regulated.citation_required_when_configured",
      description: "Citation required when configured.",
      deterministic: true,
      mode: "placeholder",
      configured: regulatedConfig?.require_citation === true
    },
    {
      id: "regulated.uncertainty_gate_required_when_configured",
      description: "Uncertainty gate required when configured.",
      deterministic: true,
      mode: "placeholder",
      configured: regulatedConfig?.require_uncertainty_gate === true
    }
  ];
}

function buildContracts(
  task_type: CorrectnessTaskType,
  config: CorrectnessConfig | undefined
): CorrectnessContract[] {
  if (task_type === "writing") {
    return buildWritingContracts(config);
  }
  if (task_type === "code") {
    return buildCodeContracts(config);
  }
  if (task_type === "data") {
    return buildDataContracts(config);
  }
  return buildRegulatedContracts(config);
}

export function listCorrectnessContracts(
  task_type: CorrectnessTaskType,
  config?: CorrectnessConfig
): CorrectnessContract[] {
  return buildContracts(task_type, config).map((contract) => ({ ...contract }));
}

export function verifyCorrectness(input: CorrectnessInput): CorrectnessResult {
  const contracts = listCorrectnessContracts(input.task_type, input.config);
  const violations: CorrectnessViolation[] = [];

  return {
    ok: true,
    task_type: input.task_type,
    verifier_version: CORRECTNESS_VERIFIER_VERSION,
    contracts,
    violations,
    metrics: {
      mode: "noop",
      contracts_checked: contracts.length,
      violation_count: violations.length
    }
  };
}
