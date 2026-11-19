/**
 * Turns the Alloy text of an editable tab into the blocks that would write it, as Blockly XML.
 *
 * Covers what the palette can build: quantifiers (all some one lone no) over a set, and / or / implies / iff,
 * not, = and !=, set minus, union and intersection, calls to the predicates the tab offers (k.p[x] or p[k, x]),
 * and names: quantified variables, the enclosing predicate's parameters and the tab's signatures.
 * Several formulas in a row are joined with "and", the way Alloy reads them.
 * Anything else is an error naming the line; the caller leaves the tab's workspace empty.
 */
import { ParseBlock } from "./BlocklyParser";

type Tok = { t: string, line: number };   // t: a name, an operator, or "" at the end

type Value =
	| { k: "var", name: string }		// quantified variable
	| { k: "param", name: string }		// enclosing predicate's parameter
	| { k: "sig", name: string }
	| { k: "setop", op: string, l: Value, r: Value };
type Formula =
	| { k: "quant", op: string, name: string, set: Value, body: Formula }
	| { k: "logic", op: string, l: Formula, r: Formula }
	| { k: "not", f: Formula }
	| { k: "cmp", op: string, l: Value, r: Value }
	| { k: "call", name: string, args: Value[] };

export class AlloyParseError extends Error {
	constructor(message: string, public line: number) { super(message); }
}

const QUANTS = ["all", "some", "one", "lone", "no"];
const OPS = ["<=>", "=>", "!=", "&&", "||", "->", "=", "!", "-", "+", "&", ".", ",", ":", "|", "[", "]", "(", ")", "{", "}", "#", "<", ">", "~", "^", "*", "@", "/"];

function tokenize(lines: string[]): Tok[] {
	const toks: Tok[] = [];
	let inBlock = false;
	lines.forEach((raw, line) => {
		let i = 0;
		while (i < raw.length) {
			if (inBlock) { const end = raw.indexOf("*/", i); if (end < 0) { i = raw.length; } else { inBlock = false; i = end + 2; } continue; }
			const rest = raw.slice(i);
			if (rest.startsWith("/*")) { inBlock = true; i += 2; continue; }
			if (rest.startsWith("--") || rest.startsWith("//")) break;
			if (/^\s/.test(rest)) { i++; continue; }
			const id = rest.match(/^[A-Za-z_][\w'"]*/);
			if (id) { toks.push({ t: id[0], line }); i += id[0].length; continue; }
			const num = rest.match(/^\d+/);
			if (num) { toks.push({ t: num[0], line }); i += num[0].length; continue; }
			const op = OPS.find(o => rest.startsWith(o));
			if (!op) throw new AlloyParseError(`unexpected character "${rest[0]}"`, line);
			toks.push({ t: op, line });
			i += op.length;
		}
	});
	toks.push({ t: "", line: Math.max(0, lines.length - 1) });
	return toks;
}

class Parser {
	private pos = 0;
	private scope: string[] = [];	// quantified variables, innermost last
	constructor(private toks: Tok[], private pb: ParseBlock) {}

	private peek(o = 0) { return this.toks[Math.min(this.pos + o, this.toks.length - 1)]; }
	private next() { return this.toks[this.pos++]; }
	private at(...ts: string[]) { return ts.includes(this.peek().t); }
	private fail(msg: string, tok = this.peek()): never { throw new AlloyParseError(msg, tok.line); }
	private expect(t: string) { if (!this.at(t)) this.fail(`expected "${t}" but found ${this.peek().t ? `"${this.peek().t}"` : "the end"}`); return this.next(); }
	private isName(t: string) { return /^[A-Za-z_]/.test(t); }

	/** Every formula up to the end (or a closing brace), joined with "and". */
	formulas(stop = ""): Formula | null {
		let out: Formula | null = null;
		while (!this.at(stop, "")) {
			const f = this.formula();
			out = out ? { k: "logic", op: "and", l: out, r: f } : f;
		}
		return out;
	}

	formula(): Formula { return this.or(); }
	private or(): Formula {
		let l = this.iff();
		while (this.at("or", "||")) { this.next(); l = { k: "logic", op: "or", l, r: this.iff() }; }
		return l;
	}
	private iff(): Formula {
		let l = this.implies();
		while (this.at("iff", "<=>")) { this.next(); l = { k: "logic", op: "iff", l, r: this.implies() }; }
		return l;
	}
	private implies(): Formula {
		const l = this.and();
		if (!this.at("implies", "=>")) return l;
		this.next();
		const r = this.implies();
		if (this.at("else")) this.fail("\"else\" has no block");
		return { k: "logic", op: "implies", l, r };
	}
	private and(): Formula {
		let l = this.unary();
		while (this.at("and", "&&")) { this.next(); l = { k: "logic", op: "and", l, r: this.unary() }; }
		return l;
	}
	private unary(): Formula {
		if (this.at("not", "!")) {
			this.next();
			// "a not in b" style negated comparisons aren't blocks; "not f" is
			return { k: "not", f: this.unary() };
		}
		if (QUANTS.includes(this.peek().t) && this.peek(1).t === "disj") this.fail("\"disj\" has no block");
		if (QUANTS.includes(this.peek().t) && this.isName(this.peek(1).t) && (this.peek(2).t === ":" || this.peek(2).t === ",")) return this.quant();
		if (QUANTS.includes(this.peek().t)) this.fail(`"${this.peek().t}" without a variable (like "${this.peek().t} x: Sig | ...") has no block`);
		if (this.at("let", "disj", "sum")) this.fail(`"${this.peek().t}" has no block`);
		if (this.at("(")) {
			// a bracketed formula, or a bracketed set on the left of a comparison: try the formula first
			const save = this.pos, scope = [...this.scope];
			try {
				this.next();
				const f = this.formula();
				this.expect(")");
				return f;
			} catch (e) {
				this.pos = save; this.scope = scope;
			}
		}
		return this.atom();
	}

	/** all a, b: S, c: T | f   or   all a: S { f g } */
	private quant(): Formula {
		const op = this.next().t;
		const decls: { name: string, set: Value }[] = [];
		const pushed: string[] = [];
		for (;;) {
			const names = [this.name()];
			while (this.at(",")) { this.next(); names.push(this.name()); }
			this.expect(":");
			if (this.at("disj", "set", "one", "lone", "some")) this.fail(`"${this.peek().t}" in a declaration has no block`);
			const set = this.value();
			for (const name of names) { decls.push({ name, set }); this.scope.push(name); pushed.push(name); }
			if (!this.at(",")) break;
			this.next();
		}
		let body: Formula | null;
		if (this.at("|")) { this.next(); body = this.formula(); }
		else if (this.at("{")) { this.next(); body = this.formulas("}"); this.expect("}"); }
		else this.fail("expected \"|\" or \"{\" after the quantifier's declaration");
		if (!body) this.fail("a quantifier needs a formula inside it");
		pushed.forEach(() => this.scope.pop());
		return decls.reduceRight<Formula>((f, d) => ({ k: "quant", op, name: d.name, set: d.set, body: f }), body);
	}

	private name(): string {
		const tok = this.peek();
		if (!this.isName(tok.t) || QUANTS.includes(tok.t)) this.fail(`expected a name but found "${tok.t}"`);
		return this.next().t;
	}

	/** A comparison or a predicate call. */
	private atom(): Formula {
		const tok = this.peek();
		const l = this.valueOrCall();
		if ("args" in l) return l;
		if (this.at("=", "!=")) {
			const op = this.next().t;
			const r = this.valueOrCall();
			if ("args" in r) this.fail(`${r.name} is a predicate, not a value`, tok);
			return { k: "cmp", op, l, r };
		}
		if (this.at("in")) this.fail("\"in\" has no block", tok);
		if (this.at("not") && this.peek(1).t === "in") this.fail("\"not in\" has no block", tok);
		const t = this.peek().t;
		this.fail(t ? `"${t}" has no block` : "expected a formula here, not just a value", t ? this.peek() : tok);
	}

	/** A set expression: names joined by - + &, & binding tighter, brackets allowed. */
	private value(): Value {
		const v = this.valueOrCall();
		if ("args" in v) this.fail(`${v.name} is a predicate, not a value`);
		return v;
	}
	private valueOrCall(): Value | { k: "call", name: string, args: Value[] } {
		let l = this.term();
		while (this.at("-", "+")) {
			if ("args" in l) return l;
			const op = this.next().t;
			const r = this.term();
			if ("args" in r) this.fail(`${r.name} is a predicate, not a value`);
			l = { k: "setop", op, l, r };
		}
		return l;
	}
	private term(): Value | { k: "call", name: string, args: Value[] } {
		let l = this.primary();
		while (this.at("&")) {
			if ("args" in l) return l;
			this.next();
			const r = this.primary();
			if ("args" in r) this.fail(`${r.name} is a predicate, not a value`);
			l = { k: "setop", op: "&", l, r };
		}
		return l;
	}
	private primary(): Value | { k: "call", name: string, args: Value[] } {
		if (this.at("(")) {
			this.next();
			const v = this.value();
			this.expect(")");
			return this.receiver(v);
		}
		const tok = this.peek();
		if (!this.isName(tok.t)) this.fail(tok.t ? `"${tok.t}" has no block` : "the formula ends too soon");
		this.next();
		const name = tok.t;
		if (this.isPred(name) && !this.scope.includes(name) && !(name in this.pb.fixed_var_types)) {
			const args = this.at("[") ? this.args() : [];
			return this.call(name, args, tok);
		}
		return this.receiver(this.named(name, tok));
	}
	/** x.pred[args] is pred[x, args]; any other join has no block. */
	private receiver(v: Value): Value | { k: "call", name: string, args: Value[] } {
		if (!this.at(".")) return v;
		this.next();
		const tok = this.peek();
		const name = this.name();
		if (!this.isPred(name)) this.fail(`"." joins have no block (${name} isn't one of this tab's predicates)`, tok);
		const args = this.at("[") ? this.args() : [];
		return this.call(name, [v, ...args], tok);
	}
	private args(): Value[] {
		this.expect("[");
		const out: Value[] = [];
		if (!this.at("]")) {
			out.push(this.value());
			while (this.at(",")) { this.next(); out.push(this.value()); }
		}
		this.expect("]");
		return out;
	}
	private call(name: string, args: Value[], tok: Tok) {
		const want = (this.pb.fixed_predicates as any)[name] as string[];
		if (args.length !== want.length) this.fail(`${name} takes ${want.length} argument${want.length === 1 ? "" : "s"}, not ${args.length}`, tok);
		if (this.pb.fixed_predicates_inline[name as any] && args.length > 2) this.fail(`${name} has too many arguments for its block`, tok);
		args.forEach(a => { if (a.k === "sig" || a.k === "setop") this.fail(`${name}'s arguments must be variables`, tok); });
		return { k: "call" as const, name, args };
	}
	private isPred(name: string) { return Object.prototype.hasOwnProperty.call(this.pb.fixed_predicates, name); }
	private named(name: string, tok: Tok): Value {
		if (this.scope.includes(name)) return { k: "var", name };
		if (name in this.pb.fixed_var_types) return { k: "param", name };
		if (this.pb.fixed_set_names.includes(name)) return { k: "sig", name };
		if (["none", "univ", "iden", "Int"].includes(name)) this.fail(`"${name}" has no block`, tok);
		return this.fail(`"${name}" isn't a variable, parameter, signature or predicate this tab knows`, tok);
	}
}

// ---------------------------------------------------------------- XML
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const varId = (name: string) => "shakudo_var_" + name;
const field = (name: string, text: string) => `<field name="${name}">${esc(text)}</field>`;
const varField = (name: string, v: string) => `<field name="${name}" id="${esc(varId(v))}" variabletype="bound_var">${esc(v)}</field>`;

function valueXml(v: Value): string {
	switch (v.k) {
		case "var": return `<block type="get_bound_var">${varField("VAR", v.name)}</block>`;
		case "param": return `<block type="fixed_get_predef_var">${field("VAR", v.name)}</block>`;
		case "sig": return `<block type="fixed_get_predef_set">${field("VAR", v.name)}</block>`;
		case "setop": return `<block type="set_op">${field("OP", v.op)}<value name="left_value">${valueXml(v.l)}</value><value name="right_value">${valueXml(v.r)}</value></block>`;
	}
}
function formulaXml(f: Formula, pb: ParseBlock, vars: Set<string>, pos = ""): string {
	switch (f.k) {
		case "quant":
			vars.add(f.name);
			return `<block type="quant"${pos}>${field("OP", f.op)}${varField("NAME", f.name)}<value name="condition">${valueXml(f.set)}</value>` +
				`<statement name="statement">${formulaXml(f.body, pb, vars)}</statement></block>`;
		case "logic":
			return `<block type="logic"${pos}>${field("OP", f.op)}<statement name="left_statement">${formulaXml(f.l, pb, vars)}</statement>` +
				`<statement name="right_statement">${formulaXml(f.r, pb, vars)}</statement></block>`;
		case "not":
			return `<block type="not"${pos}><statement name="statement">${formulaXml(f.f, pb, vars)}</statement></block>`;
		case "cmp":
			return `<block type="compare"${pos}>${field("OP", f.op)}<value name="left_value">${valueXml(f.l)}</value><value name="right_value">${valueXml(f.r)}</value></block>`;
		case "call": {
			const type = `fixed_pred_${pb.fixed_predicates_inline[f.name as any] ? "inline_" : ""}${f.args.length}`;
			return `<block type="${type}"${pos}>${field("VAR", f.name)}${f.args.map((a, i) => `<value name="param_${i}">${valueXml(a)}</value>`).join("")}</block>`;
		}
	}
}
function collectVars(v: Value | Formula, into: Set<string>) {
	if (v.k === "var") into.add(v.name);
	if (v.k === "setop" || v.k === "logic") { collectVars(v.l, into); collectVars(v.r, into); }
	if (v.k === "cmp") { collectVars(v.l, into); collectVars(v.r, into); }
	if (v.k === "quant") { into.add(v.name); collectVars(v.set, into); collectVars(v.body, into); }
	if (v.k === "not") collectVars(v.f, into);
	if (v.k === "call") v.args.forEach(a => collectVars(a, into));
}

/**
 * The blocks for a tab's text, as Blockly XML; null when the text has no code (only comments).
 * Throws AlloyParseError when the text can't be built from blocks. Lines in the error count from 0.
 */
export function alloyToBlocksXml(lines: string[], pb: ParseBlock): string | null {
	const parser = new Parser(tokenize(lines), pb);
	const f = parser.formulas();
	if (!f) return null;
	const vars = new Set<string>();
	collectVars(f, vars);
	const decl = [...vars].map(v => `<variable type="bound_var" id="${esc(varId(v))}">${esc(v)}</variable>`).join("");
	return `<xml xmlns="https://developers.google.com/blockly/xml"><variables>${decl}</variables>${formulaXml(f, pb, vars, ' x="20" y="20"')}</xml>`;
}
