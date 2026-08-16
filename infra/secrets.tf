resource "google_secret_manager_secret" "database_url" {
  secret_id = local.database_secret_name

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "database_url" {
  secret = google_secret_manager_secret.database_url.id
  secret_data = format(
    "postgresql://%s:%s@localhost/%s?host=/cloudsql/%s&schema=public",
    var.database_user,
    urlencode(random_password.database.result),
    var.database_name,
    google_sql_database_instance.app.connection_name,
  )

  depends_on = [google_sql_database.app, google_sql_user.app]
}

resource "google_secret_manager_secret" "admin_password" {
  secret_id = "${local.name}-admin-password"

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "admin_password" {
  secret      = google_secret_manager_secret.admin_password.id
  secret_data = local.admin_password
}

resource "google_secret_manager_secret" "provider" {
  for_each = local.provider_secret_names

  secret_id = "${local.name}-${lower(replace(each.key, "_", "-"))}"

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "provider" {
  for_each = local.provider_secret_names

  secret      = google_secret_manager_secret.provider[each.key].id
  secret_data = local.provider_secret_values[each.key]
}
