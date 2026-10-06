# Security

## Reporting

Use GitHub's private vulnerability reporting on this repository (Security tab, Report a vulnerability). Do not open a public issue for a vulnerability.

## Scope and assumptions

- API keys are entered by the user and stored in the browser. They are sent only to the provider the user selects. Any script injection on the origin could read them, so do not paste keys into untrusted deployments.
- User content (notes, screenshots, prompts) is processed in the browser. The README lists what is sent to a model provider.
- Model output is validated and rendered as text, never as HTML.
