resource "google_cloud_run_v2_service" "backend" {
  count = var.deploy_services ? 1 : 0

  name                = "${local.name}-backend"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  deletion_protection = false

  lifecycle {
    # Application revisions are deployed by GitLab CI with immutable commit
    # tags. Terraform continues to own every other service setting.
    ignore_changes = [
      template[0].containers[0].image,
      # Cloud Run returns an API-defaulted service-level scaling block that is
      # separate from template scaling. Ignore that computed block; the
      # template min/max settings below remain Terraform-managed.
      scaling,
    ]
  }

  template {
    service_account = google_service_account.backend.email
    timeout         = "3600s"

    scaling {
      min_instance_count = var.backend_min_instances
      max_instance_count = var.backend_max_instances
    }

    volumes {
      name = "cloudsql"

      cloud_sql_instance {
        instances = [google_sql_database_instance.app.connection_name]
      }
    }

    containers {
      image = local.backend_image

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        cpu_idle = true
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name  = "HOST"
        value = "0.0.0.0"
      }
      env {
        name  = "LOG_LEVEL"
        value = var.log_level
      }
      env {
        name  = "CORS_ORIGIN"
        value = local.application_origin
      }
      env {
        name  = "SESSION_COOKIE_SECURE"
        value = "true"
      }
      env {
        name  = "SESSION_TTL_MS"
        value = tostring(var.session_ttl_ms)
      }
      env {
        name  = "USE_MOCK_LLM"
        value = tostring(var.use_mock_llm)
      }
      env {
        name  = "ADMIN_EMAIL"
        value = var.admin_email
      }
      env {
        name  = "ADMIN_HANDLE"
        value = var.admin_handle
      }
      env {
        name  = "ADMIN_DISPLAY_NAME"
        value = var.admin_display_name
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "ADMIN_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.admin_password.secret_id
            version = "latest"
          }
        }
      }

      dynamic "env" {
        for_each = local.provider_secret_names
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.provider[env.key].secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        initial_delay_seconds = 5
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 30

        tcp_socket {
          port = 3000
        }
      }

      liveness_probe {
        initial_delay_seconds = 10
        timeout_seconds       = 3
        period_seconds        = 30
        failure_threshold     = 3

        http_get {
          path = "/api/health"
          port = 3000
        }
      }
    }
  }

  depends_on = [
    google_project_service.required,
    google_project_iam_member.backend_cloudsql_client,
    google_secret_manager_secret_iam_member.backend_admin,
    google_secret_manager_secret_iam_member.backend_database,
    google_secret_manager_secret_iam_member.backend_provider,
    google_secret_manager_secret_version.database_url,
  ]
}

resource "google_cloud_run_v2_service" "frontend" {
  count = var.deploy_services ? 1 : 0

  name                = "${local.name}-frontend"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  deletion_protection = false

  lifecycle {
    # Application revisions are deployed by GitLab CI with immutable commit
    # tags. Terraform continues to own every other service setting.
    ignore_changes = [
      template[0].containers[0].image,
      # Cloud Run returns an API-defaulted service-level scaling block that is
      # separate from template scaling. Ignore that computed block; the
      # template min/max settings below remain Terraform-managed.
      scaling,
    ]
  }

  template {
    service_account = google_service_account.frontend.email

    scaling {
      min_instance_count = var.frontend_min_instances
      max_instance_count = var.frontend_max_instances
    }

    containers {
      image = local.frontend_image

      ports {
        container_port = 5173
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }

      # The staging load balancer serves the API on the same origin. This is
      # consumed at Vite startup by the current image; production images must
      # bake the same empty value into the frontend bundle.
      env {
        name  = "VITE_API_BASE_URL"
        value = ""
      }

      startup_probe {
        initial_delay_seconds = 2
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 12

        tcp_socket {
          port = 5173
        }
      }

      liveness_probe {
        initial_delay_seconds = 5
        timeout_seconds       = 3
        period_seconds        = 30
        failure_threshold     = 3

        http_get {
          path = "/"
          port = 5173
        }
      }
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_service_iam_member" "backend_public" {
  count = var.deploy_services ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.backend[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  count = var.deploy_services ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.frontend[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
