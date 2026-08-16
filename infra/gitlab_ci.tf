locals {
  gitlab_deploy_enabled = var.gitlab_namespace_id != null && var.gitlab_project_id != null
}

resource "google_service_account" "gitlab_deployer" {
  count = local.gitlab_deploy_enabled ? 1 : 0

  account_id   = "${local.name}-deployer"
  display_name = "Brickr ${var.environment} GitLab deployer"
}

resource "google_iam_workload_identity_pool" "gitlab" {
  count = local.gitlab_deploy_enabled ? 1 : 0

  workload_identity_pool_id = "${local.name}-gitlab"
  display_name              = "Brickr ${var.environment} GitLab"
  description               = "Keyless authentication for the Brickr GitLab deployment pipeline"

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "gitlab" {
  count = local.gitlab_deploy_enabled ? 1 : 0

  workload_identity_pool_id          = google_iam_workload_identity_pool.gitlab[0].workload_identity_pool_id
  workload_identity_pool_provider_id = "gitlab"
  display_name                       = "GitLab.com"

  attribute_mapping = {
    "google.subject"         = "assertion.sub"
    "attribute.namespace_id" = "assertion.namespace_id"
    "attribute.project_id"   = "assertion.project_id"
    "attribute.ref_path"     = "assertion.ref_path"
  }

  # GitLab.com is a shared issuer. Trust only this immutable group/project ID
  # and only a branch pipeline running for main.
  attribute_condition = "assertion.namespace_id == '${var.gitlab_namespace_id}' && assertion.project_id == '${var.gitlab_project_id}' && assertion.ref_path == 'refs/heads/main'"

  oidc {
    issuer_uri        = "https://gitlab.com"
    allowed_audiences = ["https://gitlab.com"]
  }
}

resource "google_service_account_iam_member" "gitlab_workload_identity_user" {
  count = local.gitlab_deploy_enabled ? 1 : 0

  service_account_id = google_service_account.gitlab_deployer[0].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.gitlab[0].name}/attribute.project_id/${var.gitlab_project_id}"
}

resource "google_project_iam_member" "gitlab_run_developer" {
  count = local.gitlab_deploy_enabled ? 1 : 0

  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.gitlab_deployer[0].email}"
}

resource "google_service_account_iam_member" "gitlab_backend_user" {
  count = local.gitlab_deploy_enabled ? 1 : 0

  service_account_id = google_service_account.backend.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.gitlab_deployer[0].email}"
}

resource "google_service_account_iam_member" "gitlab_frontend_user" {
  count = local.gitlab_deploy_enabled ? 1 : 0

  service_account_id = google_service_account.frontend.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.gitlab_deployer[0].email}"
}

resource "google_artifact_registry_repository_iam_member" "gitlab_image_writer" {
  count = local.gitlab_deploy_enabled ? 1 : 0

  location   = google_artifact_registry_repository.app.location
  repository = google_artifact_registry_repository.app.repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.gitlab_deployer[0].email}"
}
