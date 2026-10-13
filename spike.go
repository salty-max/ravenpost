package main

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"time"
)

// The inbox spike (-mailbox-spike): a test of carrying data into the game,
// made before any feature relies on it. It writes RavenpostSpike_Mailbox
// beside the RavenpostSpike test addon (spike/RavenpostSpike) in every game
// folder found, then again every 10 s with a counter, until interrupted. In
// the game, the test addon says what it loaded: a counter that moves on
// /reload means a rewritten file is read then; a mailbox made while the game
// runs tells whether a new addon folder needs a restart. -spike-notes N adds N
// made-up notes, to see a big mailbox load.
var spikeMailbox = Mailbox{Host: "RavenpostSpike", Global: "RavenpostSpikeMailbox"}

func runMailboxSpike(ctx context.Context, store *Store, notes int) {
	made := spikeNotes(notes)
	for counter := 1; ; counter++ {
		now := time.Now()
		data := map[string]any{
			"counter": counter,
			"at":      now.Unix(),
			"written": now.Format("15:04:05"),
			"notes":   made,
		}
		installs := Discover(append(store.Get().Folders, defaultRoots()...))
		wrote := 0
		for _, in := range installs {
			ok, err := spikeMailbox.Write(in, data)
			switch {
			case err != nil:
				log.Printf("spike #%d: %s: %v", counter, in.Path, err)
			case ok:
				wrote++
				log.Printf("spike #%d written (%d notes) for %s", counter, len(made), in.Label)
			}
		}
		if wrote == 0 {
			log.Printf("spike: no game folder with the RavenpostSpike addon (%d folders found); install it in Interface/AddOns", len(installs))
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(10 * time.Second):
		}
	}
}

// Made-up notes, the size and shape Omens would carry: a map, a place, a
// template and a word, its ratings.
func spikeNotes(n int) []any {
	r := rand.New(rand.NewSource(1))
	out := make([]any, n)
	for i := range out {
		out[i] = map[string]any{
			"id": fmt.Sprintf("n%d", i+1),
			"m":  1411 + r.Intn(60),
			"x":  float64(r.Intn(10000)) / 10000,
			"y":  float64(r.Intn(10000)) / 10000,
			"t":  1 + r.Intn(12),
			"w":  1 + r.Intn(60),
			"g":  r.Intn(80),
			"p":  r.Intn(12),
		}
	}
	return out
}
