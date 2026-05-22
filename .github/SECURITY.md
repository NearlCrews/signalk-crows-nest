# Security Policy

## Supported Versions

We actively support the following versions with security updates:

| Version | Supported |
| ------- | --------- |
| 1.2.x   | Yes       |
| < 1.2   | No        |

## Reporting a Vulnerability

We take the security of Signal K ActiveCaptain Resources seriously. If you
discover a security vulnerability, please follow these guidelines.

### How to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via one of these methods:

1. **GitHub Security Advisory**: Use the [GitHub Security Advisory](https://github.com/KvotheBloodless/signalk-activecaptain-resources/security/advisories/new) feature (preferred).
2. **GitHub Issues**: For non-sensitive security concerns, open an [issue](https://github.com/KvotheBloodless/signalk-activecaptain-resources/issues).

### What to Include

Please include the following information in your report:

- **Description** of the vulnerability
- **Steps to reproduce** the issue
- **Potential impact** of the vulnerability
- **Suggested fix** (if you have one)
- **Your contact information** for follow-up

### Response Timeline

- **Initial Response**: within 48 hours of report
- **Status Update**: within 7 days with a preliminary assessment
- **Fix Timeline**: depends on severity, typically within 30 days

## Security Best Practices

When using this plugin:

1. **Keep Updated**: always use the latest version.
2. **Review Dependencies**: regularly update dependencies.
3. **Network Security**: ensure your Signal K server is properly secured.
4. **Access Control**: limit access to your Signal K admin interface. The
   plugin's status API is admin-gated and should stay that way.
5. **Monitor Logs**: watch for unusual activity in the Signal K logs.

## Dependency Security

This project uses:

- `npm audit` for vulnerability scanning
- Automated dependency updates via Dependabot for security patches

Run a security audit:

```bash
npm audit
```

## Data Handling

This plugin talks to the unauthenticated Garmin ActiveCaptain community API. It
sends only bounding-box coordinates and point-of-interest ids; it sends no
personal data, no credentials, and no Garmin account login. It does not store
or transmit user identifiers. See [docs/garmin-api.md](../docs/garmin-api.md)
for the full API research notes.

## Signal K Security

This plugin operates within the Signal K server environment. Please also refer
to the [Signal K documentation](https://signalk.org/documentation/) and Signal
K server security best practices.

## Marine Safety Notice

This plugin is designed for marine navigation systems. While we strive for
security and reliability:

- **Not for Safety-Critical Use**: this software should not be relied upon as
  the sole means of navigation.
- **Professional Equipment**: always maintain certified navigation equipment.
- **Regular Verification**: ActiveCaptain content is community-contributed and
  provided "as is"; verify all navigation data against official sources.
- **Test Thoroughly**: test in non-critical conditions before relying on this
  plugin.

## Disclosure Policy

- We will coordinate disclosure timing with the reporter.
- Public disclosure will occur after a fix is available.
- Credit will be given to reporters (if desired).
- A security advisory will be published on GitHub.
