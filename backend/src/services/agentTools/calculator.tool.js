/**
 * PR #26 — Safe Calculator Agent Tool
 *
 * Evaluates mathematical expressions using a deterministic recursive-descent parser.
 * STRICT SECURITY BOUNDARY:
 *   - NEVER uses eval()
 *   - NEVER uses Function()
 *   - NEVER invokes child processes or shell commands
 *   - Rejects non-mathematical expressions, identifiers, and syntax errors
 */

export class CalculatorError extends Error {
    constructor(message) {
        super(message);
        this.name = "CalculatorError";
    }
}

const ALLOWED_FUNCTIONS = new Map([
    ["sqrt", Math.sqrt],
    ["abs", Math.abs],
    ["round", Math.round],
    ["floor", Math.floor],
    ["ceil", Math.ceil],
    ["min", Math.min],
    ["max", Math.max],
]);

/**
 * Tokenizes a mathematical expression into numbers, operators, parentheses, and function names.
 *
 * @param {string} expr
 * @returns {Array<{type: string, value: any}>}
 */
function tokenize(expr) {
    if (typeof expr !== "string" || !expr.trim()) {
        throw new CalculatorError("Expression must be a non-empty string");
    }

    const trimmed = expr.trim();
    const tokens = [];
    let i = 0;

    while (i < trimmed.length) {
        const ch = trimmed[i];

        // Skip whitespace
        if (/\s/.test(ch)) {
            i++;
            continue;
        }

        // Numbers (integers & decimals)
        if (/[\d.]/.test(ch)) {
            let numStr = "";
            let dotCount = 0;
            while (i < trimmed.length && /[\d.]/.test(trimmed[i])) {
                if (trimmed[i] === ".") {
                    dotCount++;
                    if (dotCount > 1) {
                        throw new CalculatorError(`Malformed number at position ${i}`);
                    }
                }
                numStr += trimmed[i];
                i++;
            }
            tokens.push({ type: "NUMBER", value: parseFloat(numStr) });
            continue;
        }

        // Identifiers (allowed function names)
        if (/[a-zA-Z]/.test(ch)) {
            let idStr = "";
            while (i < trimmed.length && /[a-zA-Z0-9_]/.test(trimmed[i])) {
                idStr += trimmed[i];
                i++;
            }
            const lower = idStr.toLowerCase();
            if (!ALLOWED_FUNCTIONS.has(lower)) {
                throw new CalculatorError(
                    `Unauthorized identifier '${idStr}'. Only safe math functions are permitted: ${[...ALLOWED_FUNCTIONS.keys()].join(", ")}`
                );
            }
            tokens.push({ type: "FUNCTION", value: lower });
            continue;
        }

        // Two-character operator (** as exponentiation)
        if (ch === "*" && trimmed[i + 1] === "*") {
            tokens.push({ type: "OPERATOR", value: "^" });
            i += 2;
            continue;
        }

        // Single-character operators & delimiters
        if ("+-*/%^(),".includes(ch)) {
            tokens.push({ type: ch === "(" ? "LPAREN" : ch === ")" ? "RPAREN" : ch === "," ? "COMMA" : "OPERATOR", value: ch });
            i++;
            continue;
        }

        throw new CalculatorError(`Illegal character '${ch}' at position ${i}`);
    }

    return tokens;
}

/**
 * Parses and evaluates tokens using standard operator precedence (recursive descent):
 *   Expression  = Term (('+' | '-') Term)*
 *   Term        = Factor (('*' | '/' | '%') Factor)*
 *   Factor      = Power ('^' Factor)?
 *   Power       = ('+' | '-')? Primary
 *   Primary     = NUMBER | FUNCTION '(' ArgumentList ')' | '(' Expression ')'
 */
class Parser {
    constructor(tokens) {
        this.tokens = tokens;
        this.pos = 0;
    }

    peek() {
        return this.tokens[this.pos] || null;
    }

    consume(expectedType, expectedValue) {
        const token = this.peek();
        if (!token || token.type !== expectedType || (expectedValue && token.value !== expectedValue)) {
            const exp = expectedValue ? `'${expectedValue}'` : expectedType;
            const got = token ? `'${token.value}'` : "end of input";
            throw new CalculatorError(`Syntax error: expected ${exp}, got ${got}`);
        }
        this.pos++;
        return token;
    }

    parse() {
        const result = this.parseExpression();
        if (this.pos < this.tokens.length) {
            throw new CalculatorError(`Unexpected token '${this.peek().value}' at position ${this.pos}`);
        }
        return result;
    }

    parseExpression() {
        let val = this.parseTerm();
        while (this.peek() && this.peek().type === "OPERATOR" && ["+", "-"].includes(this.peek().value)) {
            const op = this.consume("OPERATOR").value;
            const right = this.parseTerm();
            val = op === "+" ? val + right : val - right;
        }
        return val;
    }

    parseTerm() {
        let val = this.parseFactor();
        while (this.peek() && this.peek().type === "OPERATOR" && ["*", "/", "%"].includes(this.peek().value)) {
            const op = this.consume("OPERATOR").value;
            const right = this.parseFactor();
            if (op === "*") {
                val = val * right;
            } else if (op === "/") {
                if (right === 0) {
                    throw new CalculatorError("Division by zero");
                }
                val = val / right;
            } else if (op === "%") {
                if (right === 0) {
                    throw new CalculatorError("Modulo by zero");
                }
                val = val % right;
            }
        }
        return val;
    }

    parseFactor() {
        let val = this.parseUnary();
        if (this.peek() && this.peek().type === "OPERATOR" && this.peek().value === "^") {
            this.consume("OPERATOR", "^");
            const right = this.parseFactor(); // Right-associative
            val = Math.pow(val, right);
        }
        return val;
    }

    parseUnary() {
        if (this.peek() && this.peek().type === "OPERATOR" && ["+", "-"].includes(this.peek().value)) {
            const op = this.consume("OPERATOR").value;
            const right = this.parseUnary();
            return op === "-" ? -right : right;
        }
        return this.parsePrimary();
    }

    parsePrimary() {
        const token = this.peek();
        if (!token) {
            throw new CalculatorError("Unexpected end of expression");
        }

        if (token.type === "NUMBER") {
            return this.consume("NUMBER").value;
        }

        if (token.type === "FUNCTION") {
            const fnName = this.consume("FUNCTION").value;
            this.consume("LPAREN", "(");
            const args = [];
            if (!this.peek() || this.peek().value !== ")") {
                args.push(this.parseExpression());
                while (this.peek() && this.peek().type === "COMMA") {
                    this.consume("COMMA", ",");
                    args.push(this.parseExpression());
                }
            }
            this.consume("RPAREN", ")");
            const fn = ALLOWED_FUNCTIONS.get(fnName);
            return fn(...args);
        }

        if (token.type === "LPAREN") {
            this.consume("LPAREN", "(");
            const val = this.parseExpression();
            this.consume("RPAREN", ")");
            return val;
        }

        throw new CalculatorError(`Unexpected token '${token.value}'`);
    }
}

/**
 * Safely evaluates a mathematical expression string.
 *
 * @param {object} args
 * @param {string} args.expression - The arithmetic expression to evaluate (e.g. "1250 * 0.08")
 * @returns {Promise<{ expression: string, result: number }>}
 */
export async function executeCalculator(args) {
    if (!args || typeof args !== "object") {
        throw new CalculatorError("Arguments must be an object with an 'expression' field");
    }

    const { expression } = args;
    if (typeof expression !== "string" || !expression.trim()) {
        throw new CalculatorError("expression must be a non-empty string");
    }

    const tokens = tokenize(expression);
    const parser = new Parser(tokens);
    const result = parser.parse();

    if (typeof result !== "number" || !Number.isFinite(result)) {
        throw new CalculatorError("Expression evaluated to non-finite value (NaN / Infinity)");
    }

    // Format float precision if excessive decimals
    const rounded = Math.abs(result - Math.round(result)) < 1e-10 ? Math.round(result) : parseFloat(result.toFixed(6));

    return {
        expression: expression.trim(),
        result: rounded,
    };
}
