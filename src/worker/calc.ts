// The calculator behind Ask AI. Language models get arithmetic wrong, so the model writes each
// calculation as [[= expression]] and the Worker works it out here. Only numbers, + - * / ^, parentheses
// and % (percent) are allowed; nothing is ever evaluated as code.

const PLACEHOLDER = /\[\[=\s*([^\]]{1,300}?)\s*\]\]/g;

type Token = { kind: 'num'; value: number } | { kind: 'op'; value: string };

/**
 * A number as the model may write it: 17415000, 1.5, 17.415.000 or 17,415,000. In an Indonesian answer
 * a single dot before three digits (20.000) is a thousands separator, not a decimal point.
 */
function parseNumber(text: string, locale: string): number {
  if (locale === 'id-ID' && /^[1-9]\d{0,2}\.\d{3}$/.test(text)) return Number(text.replace('.', ''));
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) return Number(text.replace(/,/g, ''));
  if (/^\d{1,3}(\.\d{3}){2,}$/.test(text)) return Number(text.replace(/\./g, ''));
  if (/^\d+,\d+$/.test(text)) return Number(text.replace(',', '.'));
  return Number(text);
}

function tokenize(expression: string, locale: string): Token[] {
  const tokens: Token[] = [];
  const source = expression.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (/\d/.test(ch) || (ch === '.' && /\d/.test(source[i + 1] ?? ''))) {
      const match = /^[\d.,]*\d/.exec(source.slice(i))!;
      const value = parseNumber(match[0], locale);
      if (!Number.isFinite(value)) throw new Error(`bad number ${match[0]}`);
      tokens.push({ kind: 'num', value });
      i += match[0].length;
    } else if ('+-*/^()%'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch });
      i++;
    } else {
      throw new Error(`unexpected ${ch}`);
    }
  }
  return tokens;
}

/**
 * Works out an arithmetic expression. Precedence, lowest first: + -, then * /, then unary minus, then ^
 * (right to left, so 2^-3 and (1+r)^-n work), then % after a number (10% is 0.1).
 */
export function evaluate(expression: string, locale = 'en-US'): number {
  const tokens = tokenize(expression, locale);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (value: string) => peek()?.kind === 'op' && peek()!.value === value;

  function sum(): number {
    let value = product();
    while (isOp('+') || isOp('-')) {
      const op = (tokens[pos++] as { value: string }).value;
      value = op === '+' ? value + product() : value - product();
    }
    return value;
  }
  function product(): number {
    let value = unary();
    while (isOp('*') || isOp('/')) {
      const op = (tokens[pos++] as { value: string }).value;
      const right = unary();
      if (op === '/' && right === 0) throw new Error('division by zero');
      value = op === '*' ? value * right : value / right;
    }
    return value;
  }
  function unary(): number {
    if (isOp('-')) {
      pos++;
      return -unary();
    }
    if (isOp('+')) {
      pos++;
      return unary();
    }
    return power();
  }
  function power(): number {
    const base = percent();
    if (isOp('^')) {
      pos++;
      return base ** unary();
    }
    return base;
  }
  function percent(): number {
    let value = primary();
    while (isOp('%')) {
      pos++;
      value /= 100;
    }
    return value;
  }
  function primary(): number {
    const token = tokens[pos++];
    if (!token) throw new Error('unexpected end');
    if (token.kind === 'num') return token.value;
    if (token.value === '(') {
      const value = sum();
      if (!isOp(')')) throw new Error('missing )');
      pos++;
      return value;
    }
    throw new Error(`unexpected ${token.value}`);
  }

  const result = sum();
  if (pos !== tokens.length) throw new Error('unexpected input after the expression');
  if (!Number.isFinite(result)) throw new Error('result is not a number');
  return result;
}

/**
 * Replaces each [[= expression]] in an answer with its result, written with the locale's separators and
 * at most two decimals. An expression that cannot be worked out is left as plain text, without brackets.
 */
export function fillCalculations(answer: string, locale: string): string {
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  return answer.replace(PLACEHOLDER, (_, expression: string) => {
    try {
      return format.format(evaluate(expression, locale));
    } catch (error) {
      console.error('ask calc failed', expression, String(error));
      return expression;
    }
  });
}
