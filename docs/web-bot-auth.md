# Signed bot visits

The bot's own browser attaches a signature to the pages it opens, so a site
that wants to can check the visit came from that bot. This is not a login
and not a way around one. Sagax never reads the signature as a session, and
the headers are never `Authorization` or `Cookie`. A saved login still uses
the existing login card. The person's own browser (attached from outside)
is not signed.

The signature is on unless that person turns it off.

```
GET /api/me/web-bot-auth
PUT /api/me/web-bot-auth    { "enabled": false }
```

A missing choice means on. On an organization server each person has their
own key and their own switch. Another member cannot turn it off or read the
private key. The answer is the public key id and a one-key directory. The
private key stays in `web-bot-auth-key.json` (mode 0600) under the data
directory, or under `principals/<id>/` on an organization server.

## What a site checks

Each page open refreshes three headers:

- `Signature-Agent`: `data:application/json,` plus the public JWK
  (`kty` OKP, `crv` Ed25519, `x` and `kid` are the same base64url value).
- `Signature-Input`: `sig1=("signature-agent");created=<unix>;expires=<unix>;keyid="<x>";alg="ed25519"`.
- `Signature`: `sig1=:<base64>:`.

The signed bytes are the two lines below, each ending in a newline. `<agent>`
is the exact `Signature-Agent` value. `<params>` is the `Signature-Input`
value after `sig1=`.

```
"signature-agent": <agent>
"@signature-params": <params>
```

Verify with Ed25519 over those bytes and the JWK. Reject a signature whose
`expires` is in the past. The browser keeps the same headers until the next
page open, including for other requests in that session, so the signature
identifies the bot. It does not cover the path and it grants nothing.

The engine command is `set headers` with the JSON object, no shell.
