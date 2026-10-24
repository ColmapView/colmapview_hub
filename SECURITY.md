# Security

Report suspected vulnerabilities privately to **info@opsiclear.com**. Include the
affected route or file, a minimal reproduction and expected impact. Do not post
credentials, private dataset links, management keys or personal information in a
public issue. Security fixes target the current production release and `main`.

## Production boundaries

The source, validation rules and tests can be public. Production authority stays
with the deployed Worker, its bindings and trusted maintainers:

- `HUB_KEY`, `HUB_TURNSTILE_SECRET`, any `VERIFIED_BOT_TOKEN` and deployment
  credentials stay outside Git. Use Cloudflare secret bindings. Public OAuth
  client IDs, the Turnstile site key and Cloudflare account/resource identifiers
  are configuration identifiers; they do not grant deployment or storage access.
- Keep the R2 bucket private. Runtime records, pending submissions and private
  dictionaries are not repository inputs or public build assets. The public feed
  returns only explicitly listed, server-verified metadata. Management keys are
  checked against stored hashes; they are not included in public records.
- Drive/Hugging Face tokens and bucket credentials stay in the viewer tab. The
  Worker does not store user login credentials. Preserve the retired server-auth
  routes and migration when deploying or rolling back.
- Publication requires bounded input, explicit consent, a server-validated
  Turnstile response and a creation quota. Source checks establish their stated
  format/access evidence; they do not prove ownership or license rights. Other
  sources remain pending operator review. Origin/CORS checks alone do not
  authenticate callers, and Turnstile is not an ownership check.
- Operator review uses the operator's Cloudflare credentials. Copying or forking
  the source grants no access to the production bucket or deployment account.

See [publication](docs/publication.md) for checks and review, and
[operations](docs/operations.md) for secrets and deployment.

## Repository checks

CI runs with read-only repository permissions, without production credentials or
persisted checkout credentials. Its pinned Gitleaks binary is checksum-verified
before scanning all fetched Git history, including compressed evidence. Findings
are redacted. `.gitleaks.toml` retains the default detectors and narrowly excludes
public catalog SHA-256 fields and a public OAuth client-ID field; it does not
exclude entire directories, files or commits.

Before publishing repository history, scan every branch/tag and inspect retained
Actions logs and artifacts. `.gitignore` does not remove historical content.
Review repository permissions and enable GitHub secret scanning and push
protection where available. Deployment credentials must never be available to
pull-request code. Review dependency and workflow changes before deploying.
