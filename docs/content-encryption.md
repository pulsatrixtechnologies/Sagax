# Content encryption at rest

Conversations are encrypted in the message database (`DATA_DIR/messages.db`)
with a content key per person, and a key of its own for each confidential
thread. Deleting a person or a confidential thread destroys its key, so what
was sealed under it never opens again (cryptographic erasure). Search and
recall keep working through a blind index: keyed tokens, never text.

Code: `server/content-crypto.ts` (sealing, blind tokens),
`server/content-keys.ts` (keys and their wrapping),
`server/content-key-azure.ts` (Azure Key Vault),
`server/content-encryption-env.ts` (settings), `server/message-sealing.ts`
(row shape, recall terms, snippets), `server/message-db.ts` (reads, writes,
migration, erasure), `server/message-search-query.ts` and the search worker,
`server/content-export.ts` (backups). Tests:
`server/content-encryption.test.ts`. Benchmark:
`node --experimental-strip-types scripts/bench-content-encryption.ts`.

## Settings

All by environment, read at start. Nothing here names a vault, tenant or
organization; the operator supplies their own.

| Variable | Values | Default |
|---|---|---|
| `SAGAX_CONTENT_ENCRYPTION` | `on`, `off` | `on` |
| `SAGAX_CONTENT_KEY_PROVIDER` | `local`, `azure-keyvault` | `local` |
| `SAGAX_CONTENT_KEY_AZURE_KEY_URL` | `https://<vault>.vault.azure.net/keys/<name>[/<version>]` | none |
| `SAGAX_CONTENT_KEY_AZURE_ALG` | `RSA-OAEP-256`, `RSA-OAEP`, `A256KW` | `RSA-OAEP-256` |
| `SAGAX_CONTENT_KEY_AZURE_CLIENT_SECRET` | a client secret (or `AZURE_CLIENT_SECRET`) | none |

**On by default.** A new installation writes sealed rows from the first
message. An existing one migrates in the background (below), reversibly.
`SAGAX_CONTENT_ENCRYPTION=off` is the way back: the migration opens every
sealed row back to plain, a little at a time, and new rows are written plain.

**Key-encryption key (KEK).**

- `local`: the vault key the encrypted MCP sign-in store already uses
  (`resolveVaultKey` in `server/mcp-oauth.ts`): on the desktop the OS
  keychain through Electron safeStorage (`SAGAX_MCP_OAUTH_KEY`), on a
  headless server a 0600 key file in the data folder. A derivation of its
  own (HKDF, `sagax content kek v1`) wraps the content keys (AES-256-GCM).
- `azure-keyvault`: each person's content key is wrapped and opened by Key
  Vault (`wrapKey` / `unwrapKey`, REST API 7.4), so the key that opens the
  transcripts never sits on the server's disk. Credentials, first match
  wins: a client secret (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, the secret
  above); workload identity (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
  `AZURE_FEDERATED_TOKEN_FILE`, `AZURE_AUTHORITY_HOST`, as AKS sets them);
  a managed identity (`IDENTITY_ENDPOINT` + `IDENTITY_HEADER`, else the
  instance metadata service; `AZURE_CLIENT_ID` picks a user-assigned one).
  The identity needs the key permissions `wrapKey` and `unwrapKey` only.
  Keys are unwrapped once at start, before the store reads a transcript; a
  key created later is wrapped asynchronously and the rows written meanwhile
  stay plain until the migration seals them. Switching from `local` to
  `azure-keyvault` (or back) re-wraps the existing keys at the next start;
  the local key keeps opening rows it wrapped until then. A wrapped key
  records the Key Vault key version that wrapped it, so a rotated key keeps
  opening older content keys; a row naming another vault is refused. The
  access token stays in memory; no token, secret or key is ever logged.

A misconfigured provider (an unknown name, Key Vault without a key URL)
stops the server at start with the variable to fix.

## Keys

| Key | Owner | Wrapped by |
|---|---|---|
| owner key | a person (`principals.json` id); the workspace (`@workspace`) for rooms, unowned threads and receipts | the KEK |
| thread key | one confidential thread | its owner's key (AES-256-GCM) |

A thread's owner is its recorded person (`ownerPrincipalId`), else on an
organization server the bot's owner, else the workspace (a solo or desktop
install has one person, so one key in practice). A thread keeps the key its
rows were sealed with (`thread_keys`); turning it confidential or giving it
an owner (`assignTaskOwners`) gives it its new key at once, and the migration
re-seals its older rows. Keys live wrapped in `content_keys` in
`messages.db`; unwrapped, they stay in the server's memory only.

## Row format

A sealed row keeps its columns (`thread_id`, `id`, `at`, `role`, `kind`)
and adds:

- `sealed`: version byte `0x01`, 12-byte IV, 16-byte tag, then AES-256-GCM
  of the whole message JSON (text included). The additional data is
  `sagax-content:v1 \0 key id \0 owner \0 thread id \0 message id`: a
  blob copied to another row, thread or person does not open (the row reads
  as absent, and one line, without content, says so);
- `key_id`: the content key;
- `text`: empty;
- `json`: a cleartext projection with only what the server's own SQL filters
  on: `id`, `at`, `role`, `kind`, `sealed: 1`, `hasText`, `from.name` and
  `from.botId`, `peerAsk.name`, `relayed`, `sendId`, `webhookPost`,
  `goalRun.status`, the open-card flags (`card.requestType`, `requestId`,
  `answered`, `dismissed`, `expired`) and `refs` (stored attachment names
  the message points at, for `threadsReferencing`).

A plain row has `sealed` and `key_id` empty: a database never encrypted
reads exactly as before, and every read accepts both. Receipts
(`command_receipts.result`) and queued follow-ups (`chat_followups.payload`)
are sealed as text fields (`sagax-sealed:v1:<key id>:<base64>`, additional
data naming the field, its key and its id).

A row whose key was destroyed is skipped by every read (erased, never
wrong). A key that exists but cannot be unwrapped on this launch (the
keychain unreadable, Key Vault unreachable) makes a read fail
(`ContentKeyUnavailable`) rather than show an empty or partial transcript,
and new rows are written plain until the key is back.

## Search and recall

Nothing is reduced: substring search (`/api/search`, the sidebar), ranked
recall (`session_search`, automatic recall, `recentMessages`,
`readMessageText`, `latestSaidByBot`) and the attachment checks work on
sealed and plain rows alike, mixed during a migration.

- **Substring search**: every sealed text row (and activity chip, by its
  tool name) has a keyed Bloom filter of its three-character windows
  (`message_index.bloom`: one bit per window, AES-256 of the window under
  the key's index key, twice as many bits as windows, 256 at least). The
  search worker, given the unwrapped keys in memory, keeps the rows whose
  filter holds every window of the needle, opens them newest first and
  confirms the substring on the text (same snippet and highlight). A
  needle under three characters opens the sealed rows newest first until
  it has its hits.
- **Recall**: the keyed words of text and digest rows (and their first four
  letters, for a prefix stem) are in a contentless FTS5 table
  (`messages_sealed_fts`, `detail=column`), so bm25 ranks them as before;
  the candidates are opened, checked against the query and snippeted
  (matched words in brackets) from the text.
- Tokens are written just after the row, in slices of a few milliseconds
  (a streamed reply is indexed once, not per patch), and always before a
  search, a recall or a backup reads them.
- Deleting a row (or re-sealing it) removes its index rows (triggers);
  destroying its key leaves any token that remains in an FTS segment
  meaningless.

**What the index still reveals** to someone holding the database file
without the keys: per row, which keyed words recur and how often, which
rows share a word or a four-letter prefix (with one owner's key), and how
long a row's text is (its filter size). Not the words themselves, and
nothing across two people's keys.

## Migration

A background loop on timers, about 4 ms of work then a 20 ms pause (a
sixth of one core while it runs). `on`: plain rows are sealed (each batch
checks that the sealed copy opens to the same message before it replaces
it) and rows under an older key are re-sealed under their thread's key.
`off`: sealed rows are opened back to plain. Receipts and follow-ups follow.
A pass runs at start and after any key change; reads accept both states
throughout. While rows are sealed, `PRAGMA secure_delete` is on, so the
plain cells they replace are zeroed.

After a pass that sealed plain rows, the next start (before the server
serves anything) rebuilds the plain full-text index (`messages_fts`, whose
segments could still hold words of the rows just sealed) and runs one
`VACUUM` (free pages written before the pass can still hold old text), then
checkpoints the write-ahead log (`vacuumAfterSealing`; skipped above 1 GB,
retried at the next start).

## Erasure

- **A person** (`DELETE /api/me`, the provider's purge, `erasePersonDataNow`
  in `server/index.ts`): after their threads go, `eraseContentOwner`
  re-seals any thread still bound to their key that now belongs to someone
  else (a bot that changed hands), then deletes the rows still sealed under
  their keys and destroys their owner key and every confidential-thread key
  under it.
- **A confidential thread** (`deleteThread`): its rows go, and its own key
  is destroyed with them.
- **Any thread**: its rows, receipts and key binding go (`deleteThread`).

A key is destroyed by deleting its row with `secure_delete` on, then
truncating the write-ahead log. This erases within the live database: a
copy made before (a disk snapshot, a copy of the data folder) still holds
the wrapped key of that time and opens with the key-encryption key, which an
erasure does not change. The workspace backup is in the clear by design
(above) and follows its own retention.

## Backups

The workspace backup (`server/workspace-backup.ts`) exports the message
database in the clear, inside the archive it already encrypts with the
backup password, as before this change: the server hands its unwrapped keys
to the backup worker in memory (`contentKeysForExport`), the snapshot copy
is opened (`unsealDatabaseCopy`), and keys, bindings and blind index are
dropped from the copy. A key the server cannot open at that moment fails the
backup instead of leaving conversations out. A restore brings plain rows,
which the destination's own migration seals under its own keys, so an
archive restores on any machine. A raw copy of `messages.db` made outside
Sagax is sealed, and opens only with that installation's KEK.

## Performance

`scripts/bench-content-encryption.ts`, synthetic text (about 1 KB a message,
25,000 rows), medians, macOS arm64, Node 26 (2026-10-26, on a shared host:
compare columns, not absolute values):

| Measure | Off | On |
|---|---:|---:|
| append (row + branch head), p50 / p95 | 0.11-0.16 / 0.40-0.50 ms | 0.09-0.10 / 0.12-0.17 ms |
| blind index, background, per row | none | about 0.2 ms, in 6 ms slices |
| streamed patch, p50 | 0.30-0.38 ms | 0.20-0.21 ms |
| read a 5,000-message thread (cold) | 15-20 ms | 29-30 ms |
| read the newest 100 | 0.3-0.5 ms | 0.6-0.7 ms |
| substring search, word present / absent | 54-71 / 49-57 ms | 57-77 / 35-42 ms |
| substring search, two characters | 88-102 ms | 38-40 ms |
| search through the worker | 49-56 ms | 37-46 ms |
| recall (any terms) | 4-5 ms | 7-9 ms |

Writes are faster sealed: the plain full-text index tokenizes every write in
the transaction, the blind index runs just after it. Opening costs about
2.5 µs a message, seen only on a cold read of a whole long thread (the
store keeps it in memory after). Migrating 15,000 rows took 6-13 s on a quiet
host (40 s on a saturated one) in steps of 6-11 ms (p95 about 20 ms; a WAL
checkpoint or FTS5 merge now and then makes a step of 100-300 ms), and the
next start's rebuild and VACUUM took 0.2-0.5 s (0.8 s saturated). `off`
took 6-12 s, with steps up to a few hundred milliseconds (1.3 s once on a saturated host) when FTS5 merges
the plain index it refills.
