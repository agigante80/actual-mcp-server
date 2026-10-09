// tests/unit/helpers/source-text.js
//
// Shared comment strippers for source-text guard tests (#532). A guard that greps source for
// a call (`queueWriteOperation(`, `dotenv.config(`) must not match one that only appears in a
// comment, and must not lose live code to a sloppy stripper. Import these instead of writing
// another ad hoc regex.
//
// Both functions are pure, never throw, and keep the line structure: for every input,
// `out.split('\n').length === src.split('\n').length`. Positions after a stripped comment
// shift, line numbers do not.
//
// stripTsComments(src): TypeScript / JavaScript.
//   1. Quoted strings ('" and "): backslash escapes honoured. A string ends at its matching
//      quote or at an unescaped newline (resync), so one stray quote cannot swallow the rest
//      of the file. Content is kept verbatim.
//   2. Template literals: backslash escapes honoured, may span lines. `${` enters a
//      substitution scanned as CODE with these same rules (comments removed, nested
//      templates and strings tracked, braces counted) until the balancing `}`.
//   3. Regex literals: a `/` not followed by `/` or `*` starts a regex when the previous
//      significant token is start of input, a punctuator other than `)` and `]`, or one of
//      the keywords return typeof case do else in of new delete void throw yield await
//      instanceof. After an identifier, a number, `)` or `]` it is division. Inside a regex:
//      escapes, a `/` inside a `[...]` class does not end it, it ends at an unescaped `/`
//      outside a class or at a newline (resync); trailing flag letters are kept. This matters
//      on this codebase: `/^http:\/\//i` ends in `\/` plus the closing `/`, which a scanner
//      without regex support reads as `//` and deletes the rest of the line as a comment.
//   4. `//` comments are removed up to but NOT including the next \r or \n.
//   5. Block comments are removed; every \r and \n inside is kept. An unterminated block
//      comment is removed to the end of input.
//   6. Everything else is copied verbatim.
//   Known limitations: a regex directly after `)` (`if (x) /re/.test(y)`) is read as
//   division; JSX is not supported.
//
// stripHashComments(src): shell, YAML, `.env`.
//   1. `#` starts a comment only outside quotes AND at start of input or right after
//      whitespace (`A=a#b`, `key: a#b` and `${#arr}` are not comments). The comment is
//      removed up to but not including the next \r or \n.
//   2. A quote (' or ") opens only at a token boundary: start of input, or right after
//      whitespace, `=`, `:`, `(`, `[` or `,`. So the apostrophe in `msg=don't` is literal.
//      Single quotes have no escapes; double quotes honour backslash escapes. A quote ends
//      at its match or at a newline (resync; multi-line quoted scalars are a limitation).

const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'yield', 'await', 'instanceof',
]);

const isWordChar = (c) => /[A-Za-z0-9_$]/.test(c);
const isNewline = (c) => c === '\n' || c === '\r';

/**
 * Copy a backslash escape starting at src[i] and return the index after it. A backslash
 * before a CRLF consumes both line-ending characters (a line continuation).
 */
function escapeEnd(src, i) {
  if (i + 1 >= src.length) return i + 1;
  if (src[i + 1] === '\r' && src[i + 2] === '\n') return i + 3;
  return i + 2;
}

export function stripTsComments(src) {
  const n = src.length;
  let out = '';
  let i = 0;
  // Previous significant token: '' at start of input, else its last character, plus the
  // whole word when it was an identifier/number (to recognise regex-introducing keywords).
  let prev = '';
  let prevWord = '';
  let depth = 0; // open `{` count in code, including template substitutions
  const subDepths = []; // value of `depth` to return to for each open `${`

  // Scan template text from i (just after a backtick or a closing substitution brace).
  // Returns true when it stopped at a `${` (entered a substitution), false when the
  // template closed or the input ended.
  const scanTemplateText = () => {
    while (i < n) {
      const c = src[i];
      if (c === '\\') {
        const e = escapeEnd(src, i);
        out += src.slice(i, e);
        i = e;
      } else if (c === '`') {
        out += c;
        i++;
        return false;
      } else if (c === '$' && src[i + 1] === '{') {
        out += '${';
        i += 2;
        return true;
      } else {
        out += c;
        i++;
      }
    }
    return false;
  };

  const afterTemplateText = (enteredSub) => {
    if (enteredSub) {
      subDepths.push(depth);
      depth++;
      prev = '{';
    } else {
      prev = '`';
    }
    prevWord = '';
  };

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];

    if (c === "'" || c === '"') {
      out += c;
      i++;
      while (i < n) {
        const e = src[i];
        if (e === '\\') {
          const end = escapeEnd(src, i);
          out += src.slice(i, end);
          i = end;
          continue;
        }
        if (isNewline(e)) break;
        out += e;
        i++;
        if (e === c) break;
      }
      prev = c;
      prevWord = '';
      continue;
    }

    if (c === '`') {
      out += c;
      i++;
      afterTemplateText(scanTemplateText());
      continue;
    }

    if (c === '/' && d === '/') {
      while (i < n && !isNewline(src[i])) i++;
      continue;
    }

    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (isNewline(src[i])) out += src[i];
        i++;
      }
      i += 2;
      continue;
    }

    if (c === '/') {
      const regexAllowed =
        prev === '' ||
        (isWordChar(prev) ? REGEX_KEYWORDS.has(prevWord) : prev !== ')' && prev !== ']');
      if (regexAllowed) {
        out += c;
        i++;
        let inClass = false;
        while (i < n) {
          const e = src[i];
          if (e === '\\') {
            const end = escapeEnd(src, i);
            out += src.slice(i, end);
            i = end;
            continue;
          }
          if (isNewline(e)) break;
          out += e;
          i++;
          if (e === '[') inClass = true;
          else if (e === ']') inClass = false;
          else if (e === '/' && !inClass) break;
        }
        while (i < n && /[A-Za-z]/.test(src[i])) out += src[i++];
        prev = 'x'; // a regex is a value: a following `/` is division
        prevWord = '';
        continue;
      }
    }

    if (c === '}' && subDepths.length > 0 && subDepths[subDepths.length - 1] === depth - 1) {
      subDepths.pop();
      depth--;
      out += c;
      i++;
      afterTemplateText(scanTemplateText());
      continue;
    }

    if (isWordChar(c)) {
      let j = i;
      while (j < n && isWordChar(src[j])) j++;
      prevWord = src.slice(i, j);
      prev = c; // any word char marks "identifier or number"
      out += prevWord;
      i = j;
      continue;
    }

    if (c === '{') depth++;
    else if (c === '}') depth--;
    if (!/\s/.test(c)) {
      prev = c;
      prevWord = '';
    }
    out += c;
    i++;
  }
  return out;
}

export function stripHashComments(src) {
  const n = src.length;
  const QUOTE_LEAD = new Set([' ', '\t', '\n', '\r', '=', ':', '(', '[', ',']);
  let out = '';
  let i = 0;
  while (i < n) {
    const c = src[i];
    const before = i === 0 ? '\n' : src[i - 1];

    if ((c === "'" || c === '"') && QUOTE_LEAD.has(before)) {
      out += c;
      i++;
      while (i < n) {
        const e = src[i];
        if (c === '"' && e === '\\') {
          const end = isNewline(src[i + 1] ?? '') ? i + 1 : escapeEnd(src, i);
          out += src.slice(i, end);
          i = end;
          continue;
        }
        if (isNewline(e)) break;
        out += e;
        i++;
        if (e === c) break;
      }
      continue;
    }

    if (c === '#' && /\s/.test(before)) {
      while (i < n && !isNewline(src[i])) i++;
      continue;
    }

    out += c;
    i++;
  }
  return out;
}
