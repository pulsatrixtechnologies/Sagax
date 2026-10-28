# API document for one person

Paste an OpenAPI 3 document. The bots of that person, in a conversation
with them, receive one tool per operation. Other members do not. There is
no admin switch.

```
PUT /api/me/openapi
{ "spec": "<json or yaml>", "baseUrl": "https://api.example/v1", "headers": { "Authorization": "Bearer …" } }

GET /api/me/openapi
DELETE /api/me/openapi
```

`headers` are sealed with the vault key (AES-256-GCM, mode 0600) in
`openapi.enc`, or under `principals/<id>/` on an organization server.
They are never listed back and they are not part of a workspace backup.
A room does not receive the tools. Since 2026-10-28 a bot shared with a
person offers that person their own operations, never its owner's: a
conversation uses the credentials of who speaks, and a routine those of
its owner. Someone with no document gets no tool, and a stale call is
refused with a sentence that says they have none.

The document must be OpenAPI 3 with the operations written inline.
References are not expanded. At most 40 operations. The host is resolved
once. Every address is checked, and the connection uses that address, so
a later DNS answer cannot move the call. On an organization server the
address has to be on the public internet. Metadata, link-local and
reserved addresses are refused everywhere. A redirect is not followed.
The answer is read up to 64 KB and wrapped as untrusted data.

A GET is a read. POST, PUT, PATCH and DELETE follow the person's approval
level: they are not pre-allowed on the agents server, so Ask shows a card.
`openapi_*` is an `own` permission, the same tier as `vault_http_request`,
so the MCP guard does not refuse the call as an unknown tool.

Routines are not involved. The call is an HTTP request, not a model turn.
