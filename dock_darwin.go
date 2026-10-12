package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>

static void ravenpostSetDock(int visible) {
	if (visible) {
		[NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
		[NSApp activateIgnoringOtherApps:YES];
	} else {
		[NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
	}
}
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

// setDockVisible: with its window open, Ravenpost is an app like any other (in
// the Dock and ⌘-Tab); hidden, it is back to the menu bar alone.
func setDockVisible(visible bool) {
	v := C.int(0)
	if visible {
		v = 1
	}
	application.InvokeSync(func() { C.ravenpostSetDock(v) })
}
