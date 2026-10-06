package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
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
	return k.SetStringValue(runValue, fmt.Sprintf(`"%s"`, exe))
}

// The folder picker and opening links are plain Win32 calls: no PowerShell,
// rundll32 or other script host. Smart App Control judges unsigned programs by
// what they do, and a hidden PowerShell running a script is what malware does
// (0.1.2's system notifications went through it and got the companion blocked).

var (
	shell32 = windows.NewLazySystemDLL("shell32.dll")
	ole32   = windows.NewLazySystemDLL("ole32.dll")

	pSHBrowseForFolder   = shell32.NewProc("SHBrowseForFolderW")
	pSHGetPathFromIDList = shell32.NewProc("SHGetPathFromIDListW")
	pCoInitializeEx      = ole32.NewProc("CoInitializeEx")
	pCoUninitialize      = ole32.NewProc("CoUninitialize")
	pCoTaskMemFree       = ole32.NewProc("CoTaskMemFree")
)

// The native "choose a folder" dialog (SHBrowseForFolder, the new style).
func pickFolder() (string, error) {
	const (
		coinitApartmentThreaded = 0x2
		bifReturnOnlyFSDirs     = 0x1
		bifNewDialogStyle       = 0x40
	)
	type browseInfo struct {
		Owner       windows.Handle
		Root        uintptr
		DisplayName *uint16
		Title       *uint16
		Flags       uint32
		Callback    uintptr
		LParam      uintptr
		Image       int32
	}
	// The dialog needs COM in a single-threaded apartment, on one OS thread.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if r, _, _ := pCoInitializeEx.Call(0, coinitApartmentThreaded); int32(r) >= 0 {
		defer pCoUninitialize.Call()
	}
	var display [windows.MAX_PATH]uint16
	title, _ := windows.UTF16PtrFromString("World of Warcraft folder")
	bi := browseInfo{DisplayName: &display[0], Title: title, Flags: bifReturnOnlyFSDirs | bifNewDialogStyle}
	pidl, _, _ := pSHBrowseForFolder.Call(uintptr(unsafe.Pointer(&bi)))
	if pidl == 0 {
		return "", nil // cancelled
	}
	defer pCoTaskMemFree.Call(pidl)
	var path [windows.MAX_PATH]uint16
	if r, _, _ := pSHGetPathFromIDList.Call(pidl, uintptr(unsafe.Pointer(&path[0]))); r == 0 {
		return "", fmt.Errorf("not a folder on disk")
	}
	return windows.UTF16ToString(path[:]), nil
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
