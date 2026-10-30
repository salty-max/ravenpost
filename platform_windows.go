package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const runKey = `Software\Microsoft\Windows\CurrentVersion\Run`
const runValue = "ravenpost"

// The WoWLocker companion's (Ravenpost's former self): removed on migration.
const legacyRunValue = "wow-locker"

// removeLegacyLaunch: the old companion no longer starts at login. True if it did.
func removeLegacyLaunch() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	return k.DeleteValue(legacyRunValue) == nil
}

func setLaunchAtLogin(on bool) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	if !on {
		if err := k.DeleteValue(runValue); err != nil && err != registry.ErrNotExist {
			return err
		}
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	// (-background: started at login, the window waits for a click on the tray icon)
	return k.SetStringValue(runValue, fmt.Sprintf(`"%s" -background`, exe))
}

// Where the Battle.net launcher installed the game.
func registryRoots() []string {
	var out []string
	for _, path := range []string{
		`SOFTWARE\WOW6432Node\Blizzard Entertainment\World of Warcraft`,
		`SOFTWARE\Blizzard Entertainment\World of Warcraft`,
	} {
		k, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		if p, _, err := k.GetStringValue("InstallPath"); err == nil && p != "" {
			// e.g. C:\Program Files (x86)\World of Warcraft\_retail_\ → its parent
			out = append(out, filepath.Dir(strings.TrimRight(p, `\`)))
		}
		k.Close()
	}
	return out
}

// Opening a link is a plain Win32 call: no PowerShell, rundll32 or other
// script host (nor Wails' own opener, which runs rundll32). Smart App Control
// judges unsigned programs by what they do, and a hidden PowerShell running a
// script is what malware does (0.1.2's system notifications went through it
// and got the companion blocked).
func openURL(url string) error {
	if os.Getenv("RAVENPOST_NO_BROWSER") != "" {
		log.Printf("open %s", url)
		return nil
	}

	// ShellExecute "open": the default browser, as any app opens a link.
	verb, _ := windows.UTF16PtrFromString("open")
	target, err := windows.UTF16PtrFromString(url)
	if err != nil {
		return err
	}
	return windows.ShellExecute(0, verb, target, nil, nil, windows.SW_SHOWNORMAL)
}

func systemLanguage() string {
	buf := make([]uint16, 85)
	proc := syscall.NewLazyDLL("kernel32.dll").NewProc("GetUserDefaultLocaleName")
	if n, _, _ := proc.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf))); n > 0 {
		return syscall.UTF16ToString(buf)
	}
	return ""
}

// showError: a plain message box (user32, a direct call: no script host), for
// a start that went wrong in a build that has no console.
func showError(title, text string) {
	t, err1 := windows.UTF16PtrFromString(title)
	m, err2 := windows.UTF16PtrFromString(text)
	if err1 != nil || err2 != nil {
		return
	}
	_, _ = windows.MessageBox(0, m, t, windows.MB_OK|windows.MB_ICONWARNING|windows.MB_SETFOREGROUND)
}
