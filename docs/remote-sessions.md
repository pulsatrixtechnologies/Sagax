# Remote sessions

A connected Tailcat session shows up in the bot panel under Sessions à distance and as a card in the chat. The card lists the computer (name, user, rights, support code, end time, serial, model, processor, memory, disk) and short diagnostic hints. The hints send a prompt. They do not run a command by themselves.

Shell opens the existing in-chat terminal on that computer. Send a file and Download move one file through the tunnel. The Computer tab shows a read-only screenshot of the same session. Closing the session asks the end-user script to stop, then marks the card closed.

The tunnel address and the client key stay in the Flow session folder (`$PX_FLOW_HOME/tailcat/<12 hex>/`, default `~/.pulsatrix-flow`). Sagax reads that folder on this host. They are never tool arguments, never API fields, and never shown. If the folder is missing, the card can still show the facts the bot supplied, and shell, files and the screenshot say the tunnel is not on this server.

The bot posts the card with `publish_remote_session` once the end user is connected. A shell request that names no other destination opens the remote terminal at once.
