locals {
  name = "brickr-${var.environment}"

  labels = merge({
    application = "brickr"
    environment = var.environment
    managed_by  = "terraform"
  }, var.labels)

  repository_url       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}"
  backend_image        = coalesce(var.backend_image, "${local.repository_url}/backend:staging")
  frontend_image       = coalesce(var.frontend_image, "${local.repository_url}/frontend:staging")
  application_origin   = "https://${var.domain_name}"
  database_secret_name = "${local.name}-database-url"
  admin_password       = var.admin_password != null ? var.admin_password : random_password.admin[0].result

  provider_secret_names = nonsensitive(toset(compact([
    var.openai_api_key == null || var.openai_api_key == "" ? "" : "OPENAI_API_KEY",
    var.anthropic_api_key == null || var.anthropic_api_key == "" ? "" : "ANTHROPIC_API_KEY",
    var.gemini_api_key == null || var.gemini_api_key == "" ? "" : "GEMINI_API_KEY",
  ])))
  provider_secret_values = {
    OPENAI_API_KEY    = var.openai_api_key == null ? "" : var.openai_api_key
    ANTHROPIC_API_KEY = var.anthropic_api_key == null ? "" : var.anthropic_api_key
    GEMINI_API_KEY    = var.gemini_api_key == null ? "" : var.gemini_api_key
  }
}
