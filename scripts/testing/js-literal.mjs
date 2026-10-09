// Embed a value in JavaScript source that another context evaluates (CDP
// Runtime.evaluate, webContents.executeJavaScript, an agent-browser `eval`,
// a generated module). JSON.stringify alone leaves characters that can end a
// <script> element or a line in older parsers, so they are escaped as well.
// Every escape is inside a string literal, so the evaluated value is unchanged.
const UNSAFE = /[<>\b\f\n\r\t\0\u2028\u2029]/g;
const ESCAPES = {
  "<": "\\u003C",
  ">": "\\u003E",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\0": "\\0",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/** A JavaScript expression that evaluates to `value` (JSON-compatible). */
export function jsLiteral(value) {
  const json = JSON.stringify(value);
  if (json === undefined) return "undefined";
  return json.replace(UNSAFE, (char) => ESCAPES[char]);
}
