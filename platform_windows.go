package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows/registry"
)

const runKey = `Software\Microsoft\Windows\CurrentVersion\Run`
const runValue = "wow-locker"

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
	if os.Getenv("WOWLOCKER_NO_BROWSER") != "" {
		log.Printf("open %s", url)
		return nil
	}

	return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

// A native folder picker, through PowerShell (no GUI toolkit needed).
func pickFolder() (string, error) {
	script := `Add-Type -AssemblyName System.Windows.Forms;` +
		`$d = New-Object System.Windows.Forms.FolderBrowserDialog;` +
		`$d.Description = 'World of Warcraft folder';` +
		`if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }`
	cmd := exec.Command("powershell", "-NoProfile", "-STA", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	return strings.TrimSpace(string(out)), err
}

func systemLanguage() string {
	buf := make([]uint16, 85)
	proc := syscall.NewLazyDLL("kernel32.dll").NewProc("GetUserDefaultLocaleName")
	if n, _, _ := proc.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf))); n > 0 {
		return syscall.UTF16ToString(buf)
	}
	return ""
}
