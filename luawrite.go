package main

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// WriteLua writes values as a Lua file the game can load: one assignment a
// global, compact (a mailbox is read by the game alone, and thousands of
// entries add up: key=value for keys that are Lua names, ["key"]=value for the
// rest and Lua's keywords, arrays as plain lists, no spaces), and in a form
// ParseSavedVariables reads back unchanged. Maps' keys are sorted: the same
// data always gives the same file. Values: map[string]any, []any, string,
// bool, nil and Go's numbers.
func WriteLua(globals map[string]any) (string, error) {
	names := make([]string, 0, len(globals))
	for name := range globals {
		names = append(names, name)
	}
	sort.Strings(names)
	var b strings.Builder
	for _, name := range names {
		if !isLuaName(name) {
			return "", fmt.Errorf("not a Lua name: %q", name)
		}
		b.WriteString(name)
		b.WriteString(" = ")
		if err := writeValue(&b, globals[name], 0); err != nil {
			return "", fmt.Errorf("%s: %w", name, err)
		}
		b.WriteString("\n")
	}
	return b.String(), nil
}

const maxLuaDepth = 32

func writeValue(b *strings.Builder, v any, depth int) error {
	if depth > maxLuaDepth {
		return fmt.Errorf("nested deeper than %d", maxLuaDepth)
	}
	switch x := v.(type) {
	case nil:
		b.WriteString("nil")
	case bool:
		b.WriteString(strconv.FormatBool(x))
	case string:
		writeLuaString(b, x)
	case int:
		b.WriteString(strconv.Itoa(x))
	case int64:
		b.WriteString(strconv.FormatInt(x, 10))
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return fmt.Errorf("not a number Lua can read: %v", x)
		}
		b.WriteString(strconv.FormatFloat(x, 'g', -1, 64))
	case []any:
		b.WriteString("{")
		for i, item := range x {
			if i > 0 {
				b.WriteString(",")
			}
			if err := writeValue(b, item, depth+1); err != nil {
				return err
			}
		}
		b.WriteString("}")
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		b.WriteString("{")
		for i, k := range keys {
			if i > 0 {
				b.WriteString(",")
			}
			if isLuaName(k) && !luaKeywords[k] {
				b.WriteString(k)
				b.WriteString("=")
			} else {
				b.WriteString("[")
				writeLuaString(b, k)
				b.WriteString("]=")
			}
			if err := writeValue(b, x[k], depth+1); err != nil {
				return err
			}
		}
		b.WriteString("}")
	default:
		return fmt.Errorf("can't write a %T to Lua", v)
	}
	return nil
}

// A Lua 5.1 string literal: quotes, backslashes and control bytes escaped
// (\ddd, Lua's own form: Go's \u escapes would not read).
func writeLuaString(b *strings.Builder, s string) {
	b.WriteByte('"')
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '"' || c == '\\':
			b.WriteByte('\\')
			b.WriteByte(c)
		case c == '\n':
			b.WriteString(`\n`)
		case c < 0x20 || c == 0x7f:
			fmt.Fprintf(b, `\%03d`, c)
		default:
			b.WriteByte(c)
		}
	}
	b.WriteByte('"')
}

// Lua 5.1's reserved words: never a bare key.
var luaKeywords = map[string]bool{
	"and": true, "break": true, "do": true, "else": true, "elseif": true, "end": true,
	"false": true, "for": true, "function": true, "if": true, "in": true, "local": true,
	"nil": true, "not": true, "or": true, "repeat": true, "return": true, "then": true,
	"true": true, "until": true, "while": true,
}

func isLuaName(s string) bool {
	if s == "" || !isIdentStart(s[0]) {
		return false
	}
	for i := 1; i < len(s); i++ {
		if !isIdent(s[i]) {
			return false
		}
	}
	return true
}
