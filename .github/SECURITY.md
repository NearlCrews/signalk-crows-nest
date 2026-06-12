# Security Policy

## Supported Versions

We actively support the following versions with security updates:

| Version | Supported |
| ------- | --------- |
| 0.8.x   | Yes       |
| < 0.8   | No        |

## Reporting a Vulnerability

We take the security of Crow's Nest seriously. If you discover a security
vulnerability, please follow these guidelines.

### How to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via one of these methods:

1. **GitHub Security Advisory**: Use the [GitHub Security Advisory](https://github.com/NearlCrews/signalk-crows-nest/security/advisories/new) feature (preferred).
2. **GitHub Issues**: For non-sensitive security concerns, open an [issue](https://github.com/NearlCrews/signalk-crows-nest/issues).

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

This plugin talks to four unauthenticated read-only APIs: the Garmin
ActiveCaptain community API, the OpenStreetMap Overpass API the OpenSeaMap
source queries, the USCG NAVCEN Maritime Safety Information feed, and the
NOAA ENC Direct ArcGIS service. The requests carry only chart coordinates
(bounding boxes), point-of-interest ids, and standard HTTP cache headers;
the plugin sends no personal data, no credentials, and no account login of
any kind. It does not store or transmit user identifiers. See
[docs/garmin-api.md](../docs/garmin-api.md) for the full ActiveCaptain API
research notes.

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
- **Regular Verification**: the imported content is community-contributed or
  periodically published government data, provided "as is"; verify all
  navigation data against official charts and notices to mariners.
- **Test Thoroughly**: test in non-critical conditions before relying on this
  plugin.

## Disclosure Policy

- We will coordinate disclosure timing with the reporter.
- Public disclosure will occur after a fix is available.
- Credit will be given to reporters (if desired).
- A security advisory will be published on GitHub.
