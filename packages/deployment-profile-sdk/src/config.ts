import type {
  DeploymentConfigField,
  DeploymentConfigPrimitive,
  DeploymentProfileConfig,
  DeploymentProfileConfigSchema,
} from "./contracts.js";
import {
  DeploymentProfileConfigError,
  DeploymentProfileManifestError,
  type DeploymentConfigIssue,
} from "./errors.js";

const FIELD_NAME = /^[a-z][a-zA-Z0-9]{0,63}$/;
const OPAQUE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const SECRET_SUFFIXES = ["password", "passphrase", "accesstoken", "refreshtoken", "apikey", "privatekey", "clientsecret"];
const SCHEMA_KEYS = new Set(["fields"]);
const FIELD_KEYS: Record<DeploymentConfigField["type"], Set<string>> = {
  string: new Set(["type", "required", "default", "pattern"]),
  integer: new Set(["type", "required", "default", "minimum", "maximum"]),
  boolean: new Set(["type", "required", "default"]),
  enum: new Set(["type", "required", "default", "values"]),
  reference: new Set(["type", "required", "default"]),
};

function looksLikeCredentialMaterialField(name: string): boolean {
  const normalized = name.replace(/[-_]/g, "").toLowerCase();
  return SECRET_SUFFIXES.some((suffix) => normalized.endsWith(suffix) || normalized.endsWith(`${suffix}ref`));
}

function validateDefault(name: string, field: DeploymentConfigField): void {
  if (field.default === undefined) return;
  const result = validateValue(name, field, field.default);
  if (result) throw new DeploymentProfileManifestError(`Configuration default for ${name} is invalid`);
}

function validateValue(
  fieldName: string,
  field: DeploymentConfigField,
  value: DeploymentConfigPrimitive,
): DeploymentConfigIssue | undefined {
  if (field.type === "string") {
    if (typeof value !== "string") return { field: fieldName, code: "type" };
    if (field.pattern && !new RegExp(field.pattern, "u").test(value)) return { field: fieldName, code: "format" };
    return undefined;
  }
  if (field.type === "integer") {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) return { field: fieldName, code: "type" };
    if (field.minimum !== undefined && value < field.minimum) return { field: fieldName, code: "range" };
    if (field.maximum !== undefined && value > field.maximum) return { field: fieldName, code: "range" };
    return undefined;
  }
  if (field.type === "boolean") {
    return typeof value === "boolean" ? undefined : { field: fieldName, code: "type" };
  }
  if (field.type === "enum") {
    if (typeof value !== "string") return { field: fieldName, code: "type" };
    return field.values.includes(value) ? undefined : { field: fieldName, code: "choice" };
  }
  if (typeof value !== "string") return { field: fieldName, code: "type" };
  return OPAQUE_REFERENCE.test(value) ? undefined : { field: fieldName, code: "format" };
}

export function validateConfigSchema(schema: DeploymentProfileConfigSchema): void {
  if (
    !schema
    || typeof schema !== "object"
    || Array.isArray(schema)
    || Object.keys(schema).some((key) => !SCHEMA_KEYS.has(key))
    || !schema.fields
    || typeof schema.fields !== "object"
    || Array.isArray(schema.fields)
  ) {
    throw new DeploymentProfileManifestError("Deployment profile configuration schema is invalid");
  }
  for (const [name, field] of Object.entries(schema.fields)) {
    if (!FIELD_NAME.test(name)) throw new DeploymentProfileManifestError("Configuration field name is invalid");
    if (!field || typeof field !== "object" || Array.isArray(field) || !["string", "integer", "boolean", "enum", "reference"].includes(field.type)) {
      throw new DeploymentProfileManifestError(`Configuration field ${name} has an unsupported type`);
    }
    if (Object.keys(field).some((key) => !FIELD_KEYS[field.type].has(key))) {
      throw new DeploymentProfileManifestError(`Configuration field ${name} contains an unsupported property`);
    }
    if (field.required !== undefined && typeof field.required !== "boolean") {
      throw new DeploymentProfileManifestError(`Configuration field ${name} has an invalid required flag`);
    }
    if (looksLikeCredentialMaterialField(name) && field.type !== "reference") {
      throw new DeploymentProfileManifestError("Credential configuration fields must be opaque references");
    }
    if (
      field.type === "enum"
      && (
        !Array.isArray(field.values)
        || field.values.length === 0
        || field.values.some((value) => typeof value !== "string")
        || new Set(field.values).size !== field.values.length
      )
    ) {
      throw new DeploymentProfileManifestError(`Configuration field ${name} must have unique enum choices`);
    }
    if (field.type === "string" && field.pattern !== undefined && typeof field.pattern !== "string") {
      throw new DeploymentProfileManifestError(`Configuration field ${name} has an invalid pattern`);
    }
    if (field.type === "string" && field.pattern) {
      try {
        new RegExp(field.pattern, "u");
      } catch {
        throw new DeploymentProfileManifestError(`Configuration field ${name} has an invalid pattern`);
      }
    }
    if (field.type === "integer") {
      if (
        (field.minimum !== undefined && !Number.isSafeInteger(field.minimum))
        || (field.maximum !== undefined && !Number.isSafeInteger(field.maximum))
        || (field.minimum !== undefined && field.maximum !== undefined && field.minimum > field.maximum)
      ) {
        throw new DeploymentProfileManifestError(`Configuration field ${name} has an invalid range`);
      }
    }
    validateDefault(name, field);
  }
}

export function validateProfileConfig(
  schema: DeploymentProfileConfigSchema,
  input: Readonly<Record<string, unknown>>,
): DeploymentProfileConfig {
  const issues: DeploymentConfigIssue[] = [];
  const output: Record<string, DeploymentConfigPrimitive> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DeploymentProfileConfigError([{ field: "$", code: "type" }]);
  }

  for (const name of Object.keys(input)) {
    if (!Object.hasOwn(schema.fields, name)) issues.push({ field: "$unknown", code: "unknown" });
  }
  for (const [name, field] of Object.entries(schema.fields)) {
    const value = input[name];
    if (value === undefined) {
      if (field.default !== undefined) output[name] = field.default;
      else if (field.required) issues.push({ field: name, code: "required" });
      continue;
    }
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      issues.push({ field: name, code: "type" });
      continue;
    }
    const issue = validateValue(name, field, value);
    if (issue) issues.push(issue);
    else output[name] = value;
  }
  if (issues.length > 0) throw new DeploymentProfileConfigError(issues);
  return Object.freeze(output);
}
