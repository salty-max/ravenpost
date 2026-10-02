package main

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// ParseSavedVariables reads a SavedVariables file as the game writes it:
//
//	WowLockerDB = {
//	["characters"] = {
//	...
//	},
//	["format"] = 1,
//	}
//
// It is a small subset of Lua (assignments of tables, strings, numbers,
// booleans and nil, plus comments), so this is a dedicated parser, not a Lua
// interpreter: nothing in the file is ever executed. Tables become
// []any when their keys are exactly 1..n (Lua arrays), map[string]any
// otherwise, so the result marshals straight to the JSON the API expects.
func ParseSavedVariables(src string) (map[string]any, error) {
	p := &parser{src: src}
	out := map[string]any{}
	for {
		p.skip()
		if p.eof() {
			return out, nil
		}
		name := p.ident()
		if name == "" {
			return nil, p.errorf("expected a variable name")
		}
		p.skip()
		if !p.consume('=') {
			return nil, p.errorf("expected '=' after %s", name)
		}
		v, err := p.value(0)
		if err != nil {
			return nil, err
		}
		out[name] = v
		p.skip()
		p.consume(';')
	}
}

type parser struct {
	src string
	pos int
}

// Deep enough for any real addon data, low enough that a corrupt file can't
// blow the stack.
const maxDepth = 64

func (p *parser) eof() bool { return p.pos >= len(p.src) }

func (p *parser) errorf(format string, args ...any) error {
	line := 1 + strings.Count(p.src[:min(p.pos, len(p.src))], "\n")
	return fmt.Errorf("SavedVariables line %d: %s", line, fmt.Sprintf(format, args...))
}

// skip whitespace and comments (-- line, --[[ block ]], --[==[ block ]==]).
func (p *parser) skip() {
	for !p.eof() {
		c := p.src[p.pos]
		switch {
		case c == ' ' || c == '\t' || c == '\n' || c == '\r':
			p.pos++
		case strings.HasPrefix(p.src[p.pos:], "--"):
			p.pos += 2
			if level, ok := p.longBracket(); ok {
				end := "]" + strings.Repeat("=", level) + "]"
				if i := strings.Index(p.src[p.pos:], end); i >= 0 {
					p.pos += i + len(end)
				} else {
					p.pos = len(p.src)
				}
				continue
			}
			if i := strings.IndexByte(p.src[p.pos:], '\n'); i >= 0 {
				p.pos += i + 1
			} else {
				p.pos = len(p.src)
			}
		default:
			return
		}
	}
}

// longBracket consumes "[[" or "[==[" and returns its level.
func (p *parser) longBracket() (int, bool) {
	if p.eof() || p.src[p.pos] != '[' {
		return 0, false
	}
	i := p.pos + 1
	for i < len(p.src) && p.src[i] == '=' {
		i++
	}
	if i < len(p.src) && p.src[i] == '[' {
		level := i - p.pos - 1
		p.pos = i + 1
		return level, true
	}
	return 0, false
}

func (p *parser) consume(c byte) bool {
	if !p.eof() && p.src[p.pos] == c {
		p.pos++
		return true
	}
	return false
}

func isIdentStart(c byte) bool { return c == '_' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' }
func isIdent(c byte) bool      { return isIdentStart(c) || c >= '0' && c <= '9' }

func (p *parser) ident() string {
	start := p.pos
	if p.eof() || !isIdentStart(p.src[p.pos]) {
		return ""
	}
	for !p.eof() && isIdent(p.src[p.pos]) {
		p.pos++
	}
	return p.src[start:p.pos]
}

func (p *parser) value(depth int) (any, error) {
	p.skip()
	if p.eof() {
		return nil, p.errorf("unexpected end of file")
	}
	switch c := p.src[p.pos]; {
	case c == '{':
		if depth >= maxDepth {
			return nil, p.errorf("tables nested too deep")
		}
		return p.table(depth + 1)
	case c == '"' || c == '\'':
		return p.str()
	case c == '[':
		level, _ := p.longBracket()
		return p.longString(level)
	case c == '-' || c == '.' || c >= '0' && c <= '9':
		return p.number()
	default:
		switch word := p.ident(); word {
		case "true":
			return true, nil
		case "false":
			return false, nil
		case "nil":
			return nil, nil
		case "":
			return nil, p.errorf("unexpected %q", c)
		default:
			return nil, p.errorf("unexpected %q (not data)", word)
		}
	}
}

func (p *parser) table(depth int) (any, error) {
	p.pos++ // {
	type entry struct {
		key string
		idx int // > 0: an integer key
		val any
	}
	var entries []entry
	next := 1 // the implicit index of the next positional value
	for {
		p.skip()
		if p.consume('}') {
			break
		}
		var e entry
		if !p.eof() && p.src[p.pos] == '[' && !strings.HasPrefix(p.src[p.pos:], "[[") && !strings.HasPrefix(p.src[p.pos:], "[=") {
			// [key] = value
			p.pos++
			k, err := p.value(depth)
			if err != nil {
				return nil, err
			}
			p.skip()
			if !p.consume(']') {
				return nil, p.errorf("expected ']'")
			}
			p.skip()
			if !p.consume('=') {
				return nil, p.errorf("expected '='")
			}
			switch k := k.(type) {
			case string:
				e.key = k
			case float64:
				if k == math.Trunc(k) && k >= 1 && k <= 1<<31 {
					e.idx = int(k)
				}
				e.key = strconv.FormatFloat(k, 'f', -1, 64)
			case bool:
				e.key = strconv.FormatBool(k)
			default:
				return nil, p.errorf("unsupported table key")
			}
		} else if save := p.pos; isIdentStart(p.src[p.pos]) {
			// name = value, or a bare true/false/nil value
			name := p.ident()
			p.skip()
			if p.consume('=') {
				e.key = name
			} else {
				p.pos = save
				e.idx, e.key = next, strconv.Itoa(next)
				next++
			}
		} else {
			e.idx, e.key = next, strconv.Itoa(next)
			next++
		}
		v, err := p.value(depth)
		if err != nil {
			return nil, err
		}
		e.val = v
		if v != nil { // nil entries don't exist in Lua
			entries = append(entries, e)
		}
		p.skip()
		if !p.consume(',') && !p.consume(';') {
			p.skip()
			if !p.consume('}') {
				return nil, p.errorf("expected ',' or '}'")
			}
			break
		}
	}

	// An array when the keys are exactly 1..n (in any order).
	isArray := len(entries) > 0
	seen := make([]bool, len(entries)+1)
	for _, e := range entries {
		if e.idx < 1 || e.idx > len(entries) || seen[e.idx] {
			isArray = false
			break
		}
		seen[e.idx] = true
	}
	if isArray {
		arr := make([]any, len(entries))
		for _, e := range entries {
			arr[e.idx-1] = e.val
		}
		return arr, nil
	}
	if len(entries) == 0 {
		return []any{}, nil
	}
	obj := make(map[string]any, len(entries))
	for _, e := range entries {
		obj[e.key] = e.val
	}
	return obj, nil
}

func (p *parser) str() (string, error) {
	quote := p.src[p.pos]
	p.pos++
	var b strings.Builder
	for {
		if p.eof() {
			return "", p.errorf("unterminated string")
		}
		c := p.src[p.pos]
		p.pos++
		switch {
		case c == quote:
			return b.String(), nil
		case c == '\n':
			return "", p.errorf("newline in string")
		case c != '\\':
			b.WriteByte(c)
		default:
			if p.eof() {
				return "", p.errorf("unterminated string")
			}
			e := p.src[p.pos]
			p.pos++
			switch e {
			case 'n':
				b.WriteByte('\n')
			case 't':
				b.WriteByte('\t')
			case 'r':
				b.WriteByte('\r')
			case 'a':
				b.WriteByte('\a')
			case 'b':
				b.WriteByte('\b')
			case 'f':
				b.WriteByte('\f')
			case 'v':
				b.WriteByte('\v')
			case '\n': // escaped newline
				b.WriteByte('\n')
			case '\\', '"', '\'':
				b.WriteByte(e)
			default:
				if e >= '0' && e <= '9' { // \ddd, a decimal byte
					n := int(e - '0')
					for i := 0; i < 2 && !p.eof() && p.src[p.pos] >= '0' && p.src[p.pos] <= '9'; i++ {
						n = n*10 + int(p.src[p.pos]-'0')
						p.pos++
					}
					if n > 255 {
						return "", p.errorf("bad escape \\%d", n)
					}
					b.WriteByte(byte(n))
				} else {
					return "", p.errorf("bad escape \\%c", e)
				}
			}
		}
	}
}

func (p *parser) longString(level int) (string, error) {
	end := "]" + strings.Repeat("=", level) + "]"
	i := strings.Index(p.src[p.pos:], end)
	if i < 0 {
		return "", p.errorf("unterminated long string")
	}
	s := p.src[p.pos : p.pos+i]
	p.pos += i + len(end)
	return strings.TrimPrefix(s, "\n"), nil // Lua drops a newline right after [[
}

func (p *parser) number() (float64, error) {
	start := p.pos
	if p.consume('-') {
		p.skip()
	}
	for !p.eof() {
		c := p.src[p.pos]
		if c >= '0' && c <= '9' || c == '.' || c == 'e' || c == 'E' || c == 'x' || c == 'X' ||
			c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F' ||
			(c == '+' || c == '-') && (p.src[p.pos-1] == 'e' || p.src[p.pos-1] == 'E') {
			p.pos++
			continue
		}
		break
	}
	lit := strings.ReplaceAll(p.src[start:p.pos], " ", "")
	neg := strings.HasPrefix(lit, "-")
	digits := strings.TrimPrefix(lit, "-")
	var n float64
	var err error
	if strings.HasPrefix(digits, "0x") || strings.HasPrefix(digits, "0X") {
		var u uint64
		u, err = strconv.ParseUint(digits[2:], 16, 64)
		n = float64(u)
	} else {
		switch strings.ToLower(digits) {
		case "inf", "1.#inf":
			n = math.Inf(1)
		default:
			n, err = strconv.ParseFloat(digits, 64)
		}
	}
	if err != nil {
		return 0, p.errorf("bad number %q", lit)
	}
	if math.IsInf(n, 0) || math.IsNaN(n) {
		n = 0 // JSON has neither; never meaningful in our data
	}
	if neg {
		n = -n
	}
	return n, nil
}
