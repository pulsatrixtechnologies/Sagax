# Remote sessions

A connected Tailcat session shows up in the bot panel under Sessions à distance and as a card in the chat. The card lists the computer (name, user, rights, support code, end time, serial, model, processor, memory, disk) and short diagnostic hints. The hints send a prompt. They do not run a command by themselves.

Shell opens the existing in-chat terminal on that computer. Send a file and Download move one file through the tunnel. The Computer tab shows a read-only screenshot of the same session. Closing the session asks the end-user script to stop, then marks the card closed.

The tunnel address and the client key stay in the Flow session folder (`$PX_FLOW_HOME/tailcat/<12 hex>/`, default `~/.pulsatrix-flow`). Sagax reads that folder on this host. They are never tool arguments, never API fields, and never shown. If the folder is missing, the card can still show the facts the bot supplied, and shell, files and the screenshot say the tunnel is not on this server.

The bot posts the card with `publish_remote_session` once the end user is connected. A shell request that names no other destination opens the remote terminal at once.

Sagax ships tailcat 0.7.0 beside the app and in the server image. It runs that copy, then a copy under its data directory, then Homebrew or `/usr/local/bin`. A tailcat on the default system PATH is not required, and Sagax does not download one at runtime. The server image and the cloud computer image bake the Linux binary into `/usr/local/bin`. A cloud computer that is already running does not see it until that image is rebuilt and published.
