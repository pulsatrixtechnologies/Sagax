// Every pod under ./pods/ registers itself on import. A new pod is a new
// file there: nothing else to list.
import.meta.glob("./pods/*.tsx", { eager: true });
