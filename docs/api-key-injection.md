# API keys Sagax sends itself, and command variables

Since 2026-10-26 an API key saved in Settings > Credentials has two optional uses
beside filling a web page.

## Sent by Sagax on a bot's request (the bot never sees the key)

On the key's form, "How Sagax sends it" picks one mode:

| mode | what the API receives |
|---|---|
| Bearer | `Authorization: Bearer <key>` |
| Named header | `<header>: <key>`, the person names the header (`X-Api-Key`) |
| Basic | `Authorization: Basic base64(<user name>:<key>)` |
| Query parameter | `?<param>=<key>`, the person names the parameter (`api_key`) |

The key's **Sites** are its origins (`api.example.com`, `api.example.com:8443`,
`*.example.com`), and an optional **Base path** (`/v1`) keeps requests under it.

A bot allowed on the key (the vault's grants: Always from Settings, or a request
card) gets the agents tool `vault_http_request` (`server/drivers/agents-vault-http-tools.ts`,
listed only when `SAGAX_VAULT_HTTP=1`, that is when the bot may send at least one key
here). It passes the key's handle (`cred_...`, from `request_login`), a method, an
https URL, optional headers and an optional body. The server
(`server/routes/credential-vault-internal.ts`, `POST /api/internal/credentials/http`):

1. checks the grant, that the key is set to be sent, the URL's sites and base path
   (`CredentialVault.resolveForRequest`);
2. resolves the host and refuses it when any address is not public: loopback, this
   computer, private network, link-local, cloud metadata or reserved
   (`server/browser/egress/policy.ts` `addressClass`); the connection goes to the
   checked address, never through a second lookup;
3. adds the key as chosen; the bot may not set `Authorization`, the key's own header,
   `Cookie`, `Host` or the transport's headers;
4. follows a redirect only on the same origin, on the key's sites and under its base
   path (adding the key again); a redirect to another origin is refused and never
   followed;
5. stops after 30 s, cuts the answer at 1 MB, drops `Set-Cookie`, and removes the key
   from the body, the headers, the final URL and any error text, with its encodings
   (base64 padded or not, URL-safe, hex, URL and form encodings, JSON, HTML, the Basic
   pair; `server/credential-fill.ts` `variants`).

The audit hook receives the bot, host, method and status (or the refusal code), never
the key, the path or the query. The item's "last used" line is updated. There is no
administrator approval: the person decides with the grant.

Code: `server/credential-http.ts`. Tests: `server/credential-http.test.ts` (a local HTTP
server stands for the API; the resolver and the address classes are injected).

## Command variable (the person's choice: the bot can read it)

"Command variable" is off by default. When the person turns it on and names it
(`EXAMPLE_API_KEY`), the bots allowed on the key get it in the environment of their
commands, read again for every command (a revoke holds at the next one):

- the person's server environment on an organization server (`run_command`): the
  values ride `SAGAX_CMDVAR_<n>` (the sandbox takes only `SAGAX_*`) and a prelude made
  of the names exports them (`server/credential-command-env.ts` `withCommandVariables`);
  the value is never on the command line;
- the engine's own shell on this computer (Claude Code's Bash): the turn's
  `commandEnvironment` joins the engine process's environment
  (`server/drivers/claude.ts`); a change starts a fresh process (the contract keeps a
  digest).

The key's row says it in one line ("Readable by your allowed bots in their shell as
$NAME"). Names a shell or the engines need are refused (`PATH`, `HOME`, `LD_*`,
`SAGAX_*`, `ANTHROPIC_*`...: `shared/credential-vault.ts` `parseCommandVariable`).
1Password keys are not exposed as variables (their value is read only at use).
Tests: `server/credential-command-env.test.ts`.

Not yet: other engines' own shells (Codex, Grok Build, ACP engines) and the Local VM's
`vm_exec` do not get the variables; the iOS app has no vault.
