export class DeploymentProfileError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class DeploymentProfileManifestError extends DeploymentProfileError {
  constructor(message: string) {
    super("deployment_profile_manifest_invalid", message);
  }
}

export class DeploymentProfileAlreadyRegisteredError extends DeploymentProfileError {
  constructor(profileId: string) {
    super("deployment_profile_already_registered", `Deployment profile ${profileId} is already registered`);
  }
}

export class DeploymentProfileNotFoundError extends DeploymentProfileError {
  constructor() {
    super("deployment_profile_not_found", "Deployment profile not found");
  }
}

export interface DeploymentConfigIssue {
  field: string;
  code: "required" | "unknown" | "type" | "format" | "range" | "choice";
}

export class DeploymentProfileConfigError extends DeploymentProfileError {
  constructor(public readonly issues: DeploymentConfigIssue[]) {
    super("deployment_profile_config_invalid", "Deployment profile configuration is invalid");
  }
}

export class DeploymentProfileCapabilityError extends DeploymentProfileError {
  constructor(message: string) {
    super("deployment_profile_capability_invalid", message);
  }
}

export class DeploymentProfileInstantiationError extends DeploymentProfileError {
  constructor() {
    super("deployment_profile_instantiation_failed", "Deployment profile could not be instantiated");
  }
}

export class DeploymentProfileClosedError extends DeploymentProfileError {
  constructor() {
    super("deployment_profile_closed", "Deployment profile instance is closed");
  }
}

export class DeploymentProfileOperationError extends DeploymentProfileError {
  constructor(public readonly operation: string) {
    super("deployment_profile_operation_failed", `Deployment profile operation ${operation} failed`);
  }
}

export class DeploymentGenerationConflictError extends DeploymentProfileError {
  constructor() {
    super("deployment_generation_conflict", "Deployment generation is stale or inconsistent");
  }
}

export class DeploymentMigrationPlanError extends DeploymentProfileError {
  constructor(message: string) {
    super("deployment_migration_plan_invalid", message);
  }
}

export class DeploymentMigrationExecutionError extends DeploymentProfileError {
  constructor(public readonly migrationId: string) {
    super("deployment_migration_failed", `Deployment migration ${migrationId} failed`);
  }
}

export class DeploymentDriverConflictError extends DeploymentProfileError {
  constructor(code = "deployment_driver_conflict") {
    super(code, "Deployment driver rejected a conflicting operation");
  }
}
