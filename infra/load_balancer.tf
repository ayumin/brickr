resource "google_compute_region_network_endpoint_group" "backend" {
  count = var.deploy_services ? 1 : 0

  name                  = "${local.name}-backend"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.backend[0].name
  }
}

resource "google_compute_region_network_endpoint_group" "frontend" {
  count = var.deploy_services ? 1 : 0

  name                  = "${local.name}-frontend"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.frontend[0].name
  }
}

resource "google_compute_backend_service" "backend" {
  count = var.deploy_services ? 1 : 0

  name                  = "${local.name}-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTP"

  backend {
    group = google_compute_region_network_endpoint_group.backend[0].id
  }
}

resource "google_compute_backend_service" "frontend" {
  count = var.deploy_services ? 1 : 0

  name                  = "${local.name}-frontend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTP"

  backend {
    group = google_compute_region_network_endpoint_group.frontend[0].id
  }
}

resource "google_compute_url_map" "app" {
  count = var.deploy_services ? 1 : 0

  name            = local.name
  default_service = google_compute_backend_service.frontend[0].id

  host_rule {
    hosts        = [var.domain_name]
    path_matcher = "brickr"
  }

  path_matcher {
    name            = "brickr"
    default_service = google_compute_backend_service.frontend[0].id

    path_rule {
      paths = [
        "/api",
        "/api/*",
        "/documentation",
        "/documentation/*",
      ]
      service = google_compute_backend_service.backend[0].id
    }
  }
}

resource "google_compute_managed_ssl_certificate" "app" {
  count = var.deploy_services ? 1 : 0

  name = local.name

  managed {
    domains = [var.domain_name]
  }
}

resource "google_compute_target_https_proxy" "app" {
  count = var.deploy_services ? 1 : 0

  name             = local.name
  url_map          = google_compute_url_map.app[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.app[0].id]
}

resource "google_compute_global_address" "app" {
  count = var.deploy_services ? 1 : 0

  name = local.name
}

resource "google_compute_global_forwarding_rule" "https" {
  count = var.deploy_services ? 1 : 0

  name                  = "${local.name}-https"
  ip_address            = google_compute_global_address.app[0].id
  port_range            = "443"
  target                = google_compute_target_https_proxy.app[0].id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

resource "google_compute_url_map" "http_redirect" {
  count = var.deploy_services ? 1 : 0

  name = "${local.name}-http-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  count = var.deploy_services ? 1 : 0

  name    = "${local.name}-http-redirect"
  url_map = google_compute_url_map.http_redirect[0].id
}

resource "google_compute_global_forwarding_rule" "http" {
  count = var.deploy_services ? 1 : 0

  name                  = "${local.name}-http"
  ip_address            = google_compute_global_address.app[0].id
  port_range            = "80"
  target                = google_compute_target_http_proxy.redirect[0].id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

resource "google_dns_record_set" "app" {
  count = var.deploy_services && var.dns_managed_zone != null ? 1 : 0

  name         = "${trimsuffix(var.domain_name, ".")}."
  managed_zone = var.dns_managed_zone
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.app[0].address]
}
