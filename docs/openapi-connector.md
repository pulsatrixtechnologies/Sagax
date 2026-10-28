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

`headers` are stored in `openapi.json` (mode 0600), or under
`principals/<id>/` on an organization server, and are never listed back.
A room does not receive the tools. A shared bot does not offer them to
someone who is not its owner.

The document must be OpenAPI 3 with the operations written inline.
References are not expanded. At most 40 operations. On an organization
server the address has to be on the public internet. A redirect is not
followed. The answer is wrapped as untrusted data.

Routines are not involved. The call is an HTTP request, not a model turn.
