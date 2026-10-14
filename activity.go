package main

import "time"

// Activity is one thing Ravenpost did, as the window's journal tells it: a
// character's file sent (and what the site made of it), a site linked or
// unlinked, an upload that failed. The last ones are kept in the config, so
// the window shows them after a restart.
type Activity struct {
	At      time.Time `json:"at"`
	Kind    string    `json:"kind"` // sent | refused | failed | linked | unlinked | shared
	Service string    `json:"service"`
	// The character (sent, refused), the BattleTag (linked), or the account
	// folder's name (failed).
	Name string `json:"name,omitempty"`
	// The site's answer for a character (saved, synced, unlinked, removed,
	// unknown, invalid), or the error of a failed upload. A shared upload's
	// facts are its Events.
	Detail   string `json:"detail,omitempty"`
	Events   int    `json:"events,omitempty"`
	Chapters int    `json:"chapters,omitempty"`
}

// The journal's length: enough for a long evening's logouts.
const keepActivity = 60

// record puts one entry at the head of the journal. A failure that is the same
// as the last one (a file retried every minute while the site is down) only
// moves that entry's time.
func (s *Syncer) record(a Activity) {
	if a.At.IsZero() {
		a.At = time.Now()
	}
	_ = s.store.Update(func(c *Config) {
		if a.Kind == "failed" && len(c.Activity) > 0 {
			if last := &c.Activity[0]; last.Kind == "failed" && last.Service == a.Service && last.Name == a.Name && last.Detail == a.Detail {
				last.At = a.At
				return
			}
		}
		c.Activity = append([]Activity{a}, c.Activity...)
		if len(c.Activity) > keepActivity {
			c.Activity = c.Activity[:keepActivity]
		}
	})
	s.onChange()
}

// sentOrRefused: a site's answer for one character, as the journal tells it.
func sentOrRefused(service, name, status string, events, chapters int) Activity {
	kind := "refused"
	if status == "synced" || status == "saved" {
		kind = "sent"
	}
	return Activity{Kind: kind, Service: service, Name: name, Detail: status, Events: events, Chapters: chapters}
}
