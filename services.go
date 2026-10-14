package main

// The sites Ravenpost carries for, each with its addon's saved file:
//
//   WoWLocker   one file per game account:     WTF/Account/<account>/SavedVariables/WowLocker.lua
//               (WowLockerDB.characters, all of them in one upload)
//   Hearthtale  one file per character:        WTF/Account/<account>/<realm>/<character>/SavedVariables/Hearthtale.lua
//               (HearthtaleChar, its book as written at logout; one upload each)
//
// Each site is linked on its own (its own sign-in, its own upload token).

type Service struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Addon string `json:"addon"` // the addon's folder in Interface/AddOns
	// Per character (Hearthtale) or per game account (WoWLocker).
	PerCharacter bool `json:"perCharacter"`
}

const (
	WoWLocker  = "wowlocker"
	Hearthtale = "hearthtale"
)

var services = []Service{
	{ID: WoWLocker, Name: "WoWLocker", Addon: "WowLocker"},
	{ID: Hearthtale, Name: "Hearthtale", Addon: "Hearthtale", PerCharacter: true},
}

// Set at build time for releases:
// -ldflags "-X main.wowlockerServer=https://wow-locker.app -X main.hearthtaleServer=https://hearthtale.app
// -X main.factsServer=…" (the addons' database: wow-data's facts inbox, shared.go)
var (
	wowlockerServer  = "http://localhost:5174"
	hearthtaleServer = "http://localhost:5175"
	factsServer      = "http://localhost:3003"
)

func defaultServer(id string) string {
	switch id {
	case Hearthtale:
		return hearthtaleServer
	case Shared:
		return factsServer
	}
	return wowlockerServer
}

func serviceByID(id string) (Service, bool) {
	for _, s := range services {
		if s.ID == id {
			return s, true
		}
	}
	return Service{}, false
}
