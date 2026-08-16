locals {
  required_apis = toset(concat([
    "artifactregistry.googleapis.com",
    # Keep the already-enabled API managed during the migration away from
    # Cloud Build. Enabling an unused API has no runtime cost.
    "cloudbuild.googleapis.com",
    "compute.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "sqladmin.googleapis.com",
    "sts.googleapis.com",
  ], var.dns_managed_zone == null ? [] : ["dns.googleapis.com"]))
}

resource "google_project_service" "required" {
  for_each = local.required_apis

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
