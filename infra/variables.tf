variable "project_id" {
  description = "Google Cloud project ID dedicated to the staging environment."
  type        = string
}

variable "region" {
  description = "Region in which regional resources are created."
  type        = string
  default     = "asia-northeast1"
}

variable "environment" {
  description = "Environment name used in resource names and labels."
  type        = string
  default     = "staging"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,14}$", var.environment))
    error_message = "environment must be 2-15 lowercase letters, digits, or hyphens."
  }
}

variable "domain_name" {
  description = "DNS name for staging. Point this name at the load_balancer_ip output."
  type        = string
}

variable "dns_managed_zone" {
  description = "Existing Cloud DNS managed zone name. When null, create the A record outside Terraform."
  type        = string
  default     = null
}

variable "deploy_services" {
  description = "Create Cloud Run and load-balancer resources after both container images have been pushed."
  type        = bool
  default     = false
}

variable "gitlab_namespace_id" {
  description = "Numeric GitLab namespace ID allowed to authenticate through Workload Identity Federation."
  type        = string
  default     = null
}

variable "gitlab_project_id" {
  description = "Numeric GitLab project ID allowed to deploy the staging environment from main."
  type        = string
  default     = null

  validation {
    condition = (
      (var.gitlab_namespace_id == null && var.gitlab_project_id == null) ||
      (var.gitlab_namespace_id != null && var.gitlab_project_id != null)
    )
    error_message = "gitlab_namespace_id and gitlab_project_id must either both be set or both be null."
  }
}

variable "backend_image" {
  description = "Fully qualified backend image. Defaults to the staging tag in the managed Artifact Registry repository."
  type        = string
  default     = null
}

variable "frontend_image" {
  description = "Fully qualified frontend image. Defaults to the staging tag in the managed Artifact Registry repository."
  type        = string
  default     = null
}

variable "database_name" {
  description = "Application database name."
  type        = string
  default     = "brickr"
}

variable "database_user" {
  description = "Application database user."
  type        = string
  default     = "brickr"
}

variable "database_tier" {
  description = "Cloud SQL machine tier. db-f1-micro is the smallest shared-core staging option."
  type        = string
  default     = "db-f1-micro"
}

variable "database_deletion_protection" {
  description = "Protect the Cloud SQL instance from accidental Terraform deletion."
  type        = bool
  default     = true
}

variable "backend_min_instances" {
  description = "Minimum warm backend instances. Staging scales to zero when unused."
  type        = number
  default     = 0
}

variable "backend_max_instances" {
  description = "Maximum backend instances. Keep at 1 until background room post generation is moved to a queue."
  type        = number
  default     = 1
}

variable "frontend_min_instances" {
  description = "Minimum warm frontend instances. Staging scales to zero when unused."
  type        = number
  default     = 0
}

variable "frontend_max_instances" {
  description = "Maximum frontend instances. Keep at 1 for the fixed two-container staging topology."
  type        = number
  default     = 1
}

variable "admin_email" {
  description = "Email for the first staging administrator. Leave empty to skip bootstrap."
  type        = string
  default     = ""
}

variable "admin_password" {
  description = "Optional password for the first staging administrator. When null, Terraform generates one."
  type        = string
  default     = null
  sensitive   = true

  validation {
    condition     = var.admin_password == null || length(var.admin_password) >= 12
    error_message = "admin_password must contain at least 12 characters."
  }
}

variable "admin_handle" {
  description = "Handle for the first staging administrator."
  type        = string
  default     = "admin"
}

variable "admin_display_name" {
  description = "Display name for the first staging administrator."
  type        = string
  default     = "Staging Admin"
}

variable "openai_api_key" {
  description = "Optional OpenAI API key."
  type        = string
  default     = null
  sensitive   = true
}

variable "anthropic_api_key" {
  description = "Optional Anthropic API key."
  type        = string
  default     = null
  sensitive   = true
}

variable "gemini_api_key" {
  description = "Optional Gemini API key."
  type        = string
  default     = null
  sensitive   = true
}

variable "use_mock_llm" {
  description = "Use deterministic mock LLM responses in staging."
  type        = bool
  default     = true
}

variable "log_level" {
  description = "Backend log level."
  type        = string
  default     = "info"
}

variable "session_ttl_ms" {
  description = "Login session lifetime in milliseconds."
  type        = number
  default     = 604800000
}

variable "labels" {
  description = "Additional labels applied to supported resources."
  type        = map(string)
  default     = {}
}
