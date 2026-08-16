resource "random_password" "database" {
  length  = 32
  special = true
}

resource "random_password" "admin" {
  count = var.admin_password == null ? 1 : 0

  length  = 32
  special = false
}

resource "google_sql_database_instance" "app" {
  name             = local.name
  region           = var.region
  database_version = "POSTGRES_17"

  deletion_protection = var.database_deletion_protection

  settings {
    tier                  = var.database_tier
    edition               = "ENTERPRISE"
    availability_type     = "ZONAL"
    connector_enforcement = "REQUIRED"
    disk_type             = "PD_HDD"
    disk_size             = 10
    disk_autoresize       = false

    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = false
      point_in_time_recovery_enabled = false
    }

    maintenance_window {
      day          = 7
      hour         = 18
      update_track = "stable"
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_sql_database" "app" {
  name     = var.database_name
  instance = google_sql_database_instance.app.name
}

resource "google_sql_user" "app" {
  name     = var.database_user
  instance = google_sql_database_instance.app.name
  password = random_password.database.result
}
