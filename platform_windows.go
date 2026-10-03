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

// A Windows toast, through PowerShell's WinRT access (no extra module). Title
// and body go in through environment variables, never as script text.
func showNotification(title, body string) error {
	script := `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;` +
		`$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);` +
		`$t = $x.GetElementsByTagName('text');` +
		`$t.Item(0).AppendChild($x.CreateTextNode($env:WL_TITLE)) > $null;` +
		`$t.Item(1).AppendChild($x.CreateTextNode($env:WL_BODY)) > $null;` +
		`$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe';` +
		`[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($x))`
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.Env = append(os.Environ(), "WL_TITLE="+title, "WL_BODY="+body)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Run()
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
