output "artifact_registry_repository" {
  description = "Docker repository to which staging images must be pushed."
  value       = local.repository_url
}

output "backend_image" {
  description = "Backend image reference used by Cloud Run."
  value       = local.backend_image
}

output "frontend_image" {
  description = "Frontend image reference used by Cloud Run."
  value       = local.frontend_image
}

output "database_instance_connection_name" {
  description = "Cloud SQL instance connection name for diagnostics and proxy access."
  value       = google_sql_database_instance.app.connection_name
}

output "load_balancer_ip" {
  description = "Create an A record for domain_name with this address when dns_managed_zone is null."
  value       = var.deploy_services ? google_compute_global_address.app[0].address : null
}

output "application_url" {
  description = "Staging application URL. The managed certificate becomes active after DNS propagation."
  value       = var.deploy_services ? local.application_origin : null
}

output "backend_service_uri" {
  description = "Cloud Run backend URI for operational diagnostics; public traffic should use application_url."
  value       = var.deploy_services ? google_cloud_run_v2_service.backend[0].uri : null
}

output "gitlab_workload_identity_provider" {
  description = "Provider resource name used by the GitLab deployment job."
  value       = local.gitlab_deploy_enabled ? google_iam_workload_identity_pool_provider.gitlab[0].name : null
}

output "gitlab_deployer_service_account" {
  description = "Service account impersonated by the GitLab deployment job."
  value       = local.gitlab_deploy_enabled ? google_service_account.gitlab_deployer[0].email : null
}

output "cloud_build_service_account" {
  description = "User-managed service account used to execute Cloud Build."
  value       = local.gitlab_deploy_enabled ? google_service_account.cloud_build[0].email : null
}

output "admin_password" {
  description = "Generated or supplied initial administrator password. Retrieve with terraform output -raw admin_password."
  value       = local.admin_password
  sensitive   = true
}
