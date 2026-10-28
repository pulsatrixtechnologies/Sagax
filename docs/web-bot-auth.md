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
private key stays sealed with the vault key in `web-bot-auth-key.json`
(mode 0600) under the data directory, or under `principals/<id>/` on an
organization server. A workspace backup does not include that file. A
plaintext key from an older build is sealed the next time it is read.

## What a site checks

A navigation that changes the host or the path, or whose signature is about
to expire, refreshes three headers:

- `Signature-Agent`: `data:application/json,` plus the public JWK
  (`kty` OKP, `crv` Ed25519, `x` and `kid` are the same base64url value).
- `Signature-Input`: `sig1=("@authority" "@path" "signature-agent");created=<unix>;expires=<unix>;keyid="<x>";alg="ed25519"`.
- `Signature`: `sig1=:<base64>:`.

The signed bytes are the lines below, each ending in a newline. `<authority>`
is the host of the page (with a non-default port). `<path>` is the path of
that page. `<agent>` is the exact `Signature-Agent` value. `<params>` is the
`Signature-Input` value after `sig1=`.

```
"@authority": <authority>
"@path": <path>
"signature-agent": <agent>
"@signature-params": <params>
```

Verify with Ed25519 over those bytes and the JWK, using the authority and
the path of the request being checked. A signature for one host or one path
does not verify on another, so a site that received it cannot replay it
elsewhere. Reject a signature whose `expires` is in the past. The same
headers stay for that host and path until they are about to expire. A
different path is signed again. If signing fails, the page still opens and
the failure is logged once. The signature grants nothing. The engine's
`set headers` still applies to the session; only this host and path verify.

The engine command is `set headers` with the JSON object, no shell.
