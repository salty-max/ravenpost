package main

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

// The addon simulation (addon/test/sim.lua) writes the same database twice:
// as JSON and in the game's SavedVariables format. Parsing the second must
// give the first.
func TestParsesTheSimulatedSession(t *testing.T) {
	sv, err := os.ReadFile("testdata/sim.lua")
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile("testdata/sim.json")
	if err != nil {
		t.Fatal(err)
	}
	vars, err := ParseSavedVariables(string(sv))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(roundTrip(t, vars["WowLockerDB"]), roundTrip(t, json.RawMessage(want))) {
		got, _ := json.MarshalIndent(vars["WowLockerDB"], "", " ")
		t.Fatalf("parsed database differs from the simulation's JSON:\n%s", got)
	}
}

// The layout a real client wrote (no "-- [n]" comments, unsorted keys).
func TestParsesTheClientLayout(t *testing.T) {
	src := `
WowLockerDB = {
["characters"] = {
["Player-6113-03D658B8"] = {
["state"] = {
["zone"] = "Darkshore",
["hardcore"] = true,
["y"] = 44.3,
["xpMax"] = 0,
["updatedAt"] = 1790965309,
},
["events"] = {
{
["type"] = "gear",
["name"] = "Buccaneer's Gloves of Spirit",
["slot"] = "HANDS",
["t"] = 1790965071,
["itemId"] = 14168,
},
{
["type"] = "logout",
["t"] = 1790965309,
["level"] = 22,
},
},
["name"] = "Namzie",
},
},
["format"] = 1,
}
`
	vars, err := ParseSavedVariables(src)
	if err != nil {
		t.Fatal(err)
	}
	db := vars["WowLockerDB"].(map[string]any)
	char := db["characters"].(map[string]any)["Player-6113-03D658B8"].(map[string]any)
	events := char["events"].([]any)
	if len(events) != 2 || events[0].(map[string]any)["name"] != "Buccaneer's Gloves of Spirit" {
		t.Fatalf("events: %#v", events)
	}
	if char["state"].(map[string]any)["y"] != 44.3 || db["format"] != 1.0 {
		t.Fatalf("numbers: %#v", char["state"])
	}
}

func TestLuaDetails(t *testing.T) {
	src := `-- a comment
A = {
	"positional", -- [1]
	nil,
	[3] = true,
	[2] = false,
}
B = { [23] = 90000, [24] = 95000 } -- level → played: not an array
C = "quote \" backslash \\ newline \n tab \t byte \65 escaped\
line"
D = [[
long string]]
E = { x = 1, ["y z"] = -2.5e3, 0x1F }
F = {}
--[==[ block
comment ]==]
G = -0.5;
`
	vars, err := ParseSavedVariables(src)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"A": []any{"positional", false, true}, // [2] = false fills the nil hole
		"B": map[string]any{"23": 90000.0, "24": 95000.0},
		"C": "quote \" backslash \\ newline \n tab \t byte A escaped\nline",
		"D": "long string",
		"E": map[string]any{"x": 1.0, "y z": -2500.0, "1": 31.0},
		"F": []any{},
		"G": -0.5,
	}
	for k, w := range want {
		if !reflect.DeepEqual(vars[k], w) {
			t.Errorf("%s = %#v, want %#v", k, vars[k], w)
		}
	}
}

func TestRejectsCode(t *testing.T) {
	for _, src := range []string{
		`A = os.execute("rm -rf /")`,
		`A = { [print] = 1 }`,
		`A = { "unterminated }`,
		`A = ` + strings.Repeat("{", maxDepth+5),
		`A = 1 B`,
	} {
		if _, err := ParseSavedVariables(src); err == nil {
			t.Errorf("accepted %q", src)
		}
	}
}

func roundTrip(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}
