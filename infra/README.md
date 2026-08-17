# Brickr staging infrastructure (Google Cloud)

This directory provisions the Google Cloud resources required by the Brickr
staging environment:

- Artifact Registry repositories for the frontend and backend images
- Cloud Run services reachable only through an external HTTPS load balancer
- path routing from `/api/*` and `/documentation/*` to the backend
- a minimal, single-zone Cloud SQL for PostgreSQL 17 instance
- an encrypted Cloud SQL Auth Proxy connection mounted into the backend
- Secret Manager secrets for the database, initial admin, and optional LLM keys
- a Google-managed TLS certificate and optional Cloud DNS A record

The configuration runs at most one frontend instance and one backend instance,
for a maximum of two application container instances. Both scale to zero while
staging is unused. Simulation work currently runs in the backend process, so a
scale-down can interrupt in-flight generation; this data-loss tradeoff is
intentional for this test-only environment.

## Prerequisites

- Terraform 1.7 or newer
- a Google Cloud project with billing enabled
- credentials from Application Default Credentials or Workload Identity
- a staging DNS name whose zone you can update
- a GCS bucket for Terraform state (recommended)

The caller needs permission to enable APIs and manage Compute Engine, Cloud Run,
Cloud SQL, Artifact Registry, Secret Manager, IAM service accounts and policies,
and optionally Cloud DNS.

## Remote state

Copy `backend.tf.example` to `backend.tf`, replace the bucket, and initialize:

```shell
cp backend.tf.example backend.tf
terraform init
```

The state contains the generated database password and values supplied through
sensitive variables. Use a dedicated GCS bucket with uniform access, versioning,
encryption, and tightly restricted IAM. Do not commit `backend.tf`, state files,
plans, or `terraform.tfvars`. Commit `.terraform.lock.hcl` so CI and local runs
use the same provider versions.

## Deploy

1. Create local variables and keep `deploy_services = false`:

   ```shell
   cp terraform.tfvars.example terraform.tfvars
   terraform init
   terraform plan -out=staging.tfplan
   terraform apply staging.tfplan
   ```

2. For the initial bootstrap only, build and push `backend:staging` and
   `frontend:staging` directly to Artifact Registry from the repository root.
   The repository is created separately because Cloud Run rejects image
   references that have not been pushed yet. Both builds explicitly target
   `linux/amd64`, including when the submitter uses an Arm workstation.

   ```shell
   cd ..
   gcloud auth configure-docker asia-northeast1-docker.pkg.dev
   docker buildx build --platform=linux/amd64 --push \
     --file=apps/backend/Dockerfile \
     --tag=asia-northeast1-docker.pkg.dev/aaizawa-sandbox-505606/brickr-staging/backend:staging \
     .
   docker buildx build --platform=linux/amd64 --push \
     --file=apps/frontend/Dockerfile \
     --tag=asia-northeast1-docker.pkg.dev/aaizawa-sandbox-505606/brickr-staging/frontend:staging \
     .
   cd infra
   ```

   The existing Dockerfiles are development-oriented. Before exposing staging,
   replace them with production images: run the compiled backend without a file
   watcher and serve the frontend's `dist/` from a small HTTP server. The frontend
   build must set `VITE_API_BASE_URL` to an empty string so requests use the same
   load-balancer origin.

3. Set `deploy_services = true`, then plan and apply again.

4. If `dns_managed_zone` is null, create an A record for `domain_name` using the
   `load_balancer_ip` output. Certificate provisioning starts after DNS resolves
   and can take several minutes.

5. Verify the deployment:

   ```shell
   curl -fsS "https://staging.example.com/api/health"
   ```

Replace the hostname with the configured `domain_name`.

## Continuous deployment from GitLab

Terraform creates a Workload Identity Pool and a dedicated GitLab deployer
service account when both `gitlab_namespace_id` and `gitlab_project_id` are set.
GitLab jobs exchange their OIDC ID tokens for short-lived Google credentials;
no service-account key or protected CI variable is required.

The CI configuration is split by purpose under `.gitlab/ci/`:

- Branch pushes run only lint and typecheck for affected components.
- Merge requests run lint, typecheck, tests, builds, and security scans only
  for affected components. A shared-package change checks both applications.
- Infrastructure changes run `terraform fmt`, `terraform init -backend=false`,
  and `terraform validate` without applying anything.
- A `main` pipeline re-tests affected components, then waits at the manual
  `staging:approve` job before building or deploying containers.

After `staging:approve` is selected, the `main` pipeline performs the following
steps:

1. Detect frontend and backend changes independently. Changes to
   `packages/shared`, workspace manifests, the lockfile, or the CI definition
   affect both images.
2. Build only the affected images on GitLab Runner for `linux/amd64`, tag them
   with `CI_COMMIT_SHA`, and push them directly to Google Artifact Registry.
3. Deploy only the affected Cloud Run services. When both changed, deploy the
   backend before the frontend.
4. Verify the affected frontend or backend endpoint.

### Reset the staging database

When an incompatible Prisma schema change cannot be applied to existing
staging data, open a `main` pipeline and run the optional manual job
`staging:database-reset`. GitLab shows a second confirmation before starting
the destructive operation. The job only appears in pipelines whose merge
changes `apps/backend/prisma/schema.prisma` or a file under
`apps/backend/prisma/migrations/`, so unrelated fixes never schedule it.

The job temporarily starts the currently configured backend image with
`prisma db push --force-reset`, recreates the application schema, runs the
normal seed, and then redeploys the backend with its default entrypoint. It
does not delete the Cloud SQL instance or the `postgres` database, but all
application data in the `brickr` database is permanently removed. The job
uses the same `staging` resource group as regular deployments, so it cannot
run concurrently with them. Leaving the job unstarted does not block the
pipeline.

Merge-request pipelines never receive deployment credentials. The Workload
Identity provider also rejects tokens unless their immutable GitLab
namespace/project IDs match and `ref_path` is `refs/heads/main`.

Cloud Run image revisions are owned by GitLab CI. Terraform ignores subsequent
image-only changes while continuing to manage service configuration such as
scaling, environment variables, IAM, and Cloud SQL attachment.

## Secret rotation

LLM keys and the initial admin password are stored as Secret Manager versions
and Terraform state. The admin password is generated by default and can be read
with `terraform output -raw admin_password` after apply. Rotate generated
passwords by replacing the corresponding `random_password` resource and
applying. The database password is also generated by Terraform; replacing it
updates both the Cloud SQL user and `DATABASE_URL` secret.

## Cost and safety notes

- Cloud SQL has deletion protection enabled by default. Set
  `database_deletion_protection = false` and apply before intentionally destroying
  the environment.
- Cloud SQL uses the SLA-excluded `db-f1-micro` shared-core tier, a 10 GB HDD,
  and a zonal topology. Automatic backups, PITR, Query Insights, and automatic
  storage growth are disabled to minimize staging cost.
- Cloud SQL has a public address so Cloud Run can use its managed Auth Proxy,
  but no authorized network is configured for direct TCP access. The proxy
  authenticates with the backend service account's `roles/cloudsql.client` role
  and encrypts the connection to Cloud SQL.
- Both Cloud Run services scale to zero by default and cold-start on the first
  request. Each service scales to at most one instance. A revision rollout can
  temporarily overlap old and new instances.
- Cloud Run services allow unauthenticated invocation at IAM level, but ingress is
  restricted to the external load balancer. Brickr's own authentication still
  protects non-public application routes.
