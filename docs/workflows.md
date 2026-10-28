# Workflows

A YAML file of steps that send a message, wait, ask the person, then
continue. The steps do not go through a model turn. Routines are unchanged.

```yaml
name: follow-up
steps:
  - send: { bot: bot-a, thread: thread-a, text: Starting }
  - wait: { seconds: 30 }
  - approve: { prompt: Continue?, bot: bot-a, thread: thread-a }
  - send: { bot: bot-a, thread: thread-a, text: Done }
```

```
PUT  /api/me/workflows                 { "yaml": "<the file>" }
POST /api/me/workflows/follow-up/run
POST /api/me/workflows/runs/<id>/answer   { "decision": "yes" }
```

`decision` is `yes` or `no`. Until that answer arrives, the run stays
waiting. A wait stays waiting until its clock passes, including after the
app restarts. The file is stored for that person only. A step may name
only a conversation of a bot they own. No admin right.
