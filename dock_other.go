//go:build !darwin

package main

// setDockVisible: Windows shows the window in the taskbar on its own.
func setDockVisible(bool) {}
